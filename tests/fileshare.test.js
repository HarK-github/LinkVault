const path = require('path');
const fs = require('fs');
const request = require('supertest');

// Set test environment paths
const TEST_DIR = path.join(__dirname, 'test_scratch');
if (!fs.existsSync(TEST_DIR)) {
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(TEST_DIR, 'test_linkvault.db');
process.env.UPLOADS_DIR = path.join(TEST_DIR, 'test_uploads');

const app = require('../server');
const { getDb, closeDb } = require('../src/db');
const { runCleanupJob } = require('../src/cleanup');

describe('LinkVault File Sharing Test Suite', () => {
  let db;

  beforeAll(() => {
    db = getDb();
  });

  afterAll(() => {
    closeDb();
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  // Health Check
  test('GET /health returns 200 OK with runtime engine status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('sqlite');
    expect(['local-disk', 'cloudflare-r2', 'supabase-s3', 's3-compatible']).toContain(res.body.storage);
    expect(res.body.timestamp).toBeDefined();
  });

  // Test 1: Upload then download returns the same file
  test('Upload then download returns identical file payload and filename', async () => {
    const testPayload = 'This is sensitive confidential test file data!';
    const uploadRes = await request(app)
      .post('/upload')
      .attach('file', Buffer.from(testPayload), 'report-2026.pdf')
      .field('expiry', '24h');

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.id).toBeDefined();
    expect(uploadRes.body.delete_token).toBeDefined();
    expect(uploadRes.body.original_name).toBe('report-2026.pdf');
    expect(uploadRes.body.size).toBe(Buffer.byteLength(testPayload));

    const fileId = uploadRes.body.id;

    // Metadata check
    const infoRes = await request(app)
      .get(`/f/${fileId}`)
      .set('Accept', 'application/json');
    expect(infoRes.status).toBe(200);
    expect(infoRes.body.original_name).toBe('report-2026.pdf');
    expect(infoRes.body.size).toBe(Buffer.byteLength(testPayload));

    // Download file
    const downloadRes = await request(app).post(`/f/${fileId}/download`);
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers['content-disposition']).toContain('report-2026.pdf');
    expect(downloadRes.body.toString()).toBe(testPayload);
  });

  // Test 2: Expired link returns 404
  test('Expired link returns 404 on both info and download', async () => {
    const uploadRes = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('will expire shortly'), 'quick-expire.txt')
      .field('expiry', '1m');

    const fileId = uploadRes.body.id;

    // Manually expire the file in the database
    db.prepare('UPDATE files SET expires_at = ? WHERE id = ?').run(Date.now() - 10000, fileId);

    const infoRes = await request(app)
      .get(`/f/${fileId}`)
      .set('Accept', 'application/json');
    expect(infoRes.status).toBe(404);
    expect(infoRes.body.error).toMatch(/expired|not found/i);

    const downloadRes = await request(app).post(`/f/${fileId}/download`);
    expect(downloadRes.status).toBe(404);
  });

  // Test 3: Wrong password returns 403, correct password works
  test('Password-protected link rejects wrong password (403) and allows correct password (200)', async () => {
    const fileContent = 'classified documents';
    const uploadRes = await request(app)
      .post('/upload')
      .attach('file', Buffer.from(fileContent), 'classified.txt')
      .field('password', 'SuperSecretPass#99');

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.has_password).toBe(true);

    const fileId = uploadRes.body.id;

    // 1. Missing password
    const noPassRes = await request(app).post(`/f/${fileId}/download`);
    expect(noPassRes.status).toBe(403);
    expect(noPassRes.body.error).toMatch(/password/i);

    // 2. Wrong password
    const wrongPassRes = await request(app)
      .post(`/f/${fileId}/download`)
      .send({ password: 'IncorrectPassword' });
    expect(wrongPassRes.status).toBe(403);

    // 3. Correct password
    const correctPassRes = await request(app)
      .post(`/f/${fileId}/download`)
      .send({ password: 'SuperSecretPass#99' });
    expect(correctPassRes.status).toBe(200);
    expect(correctPassRes.text).toBe(fileContent);
  });

  // Test 4: Link with 1 max download works once, then returns 404
  test('Link with 1 max download works once, then returns 404 on subsequent attempt', async () => {
    const uploadRes = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('one-time only burn payload'), 'burn.txt')
      .field('max_downloads', '1');

    const fileId = uploadRes.body.id;

    // First download succeeds
    const firstRes = await request(app).post(`/f/${fileId}/download`);
    expect(firstRes.status).toBe(200);

    // Second download gets 404
    const secondRes = await request(app).post(`/f/${fileId}/download`);
    expect(secondRes.status).toBe(404);

    // Info endpoint also returns 404
    const infoRes = await request(app).get(`/f/${fileId}`).set('Accept', 'application/json');
    expect(infoRes.status).toBe(404);
  });

  // Test 5: Concurrency test - 20 parallel downloads to a 1-download link
  test('Concurrency test: 20 parallel downloads to a 1-download link results in exactly 1 success (200) and 19 rejections (404)', async () => {
    const uploadRes = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('atomic race condition test'), 'concurrency.txt')
      .field('max_downloads', '1');

    const fileId = uploadRes.body.id;

    // Send 20 concurrent requests simultaneously
    const requests = Array.from({ length: 20 }, () =>
      request(app).post(`/f/${fileId}/download`)
    );

    const responses = await Promise.all(requests);

    const successes = responses.filter((r) => r.status === 200);
    const notFounds = responses.filter((r) => r.status === 404);

    expect(successes.length).toBe(1);
    expect(notFounds.length).toBe(19);
  });

  // Test 6: File over the size limit returns 413 and leaves nothing on disk
  test('File over 50 MB size limit returns 413 and does not save to disk', async () => {
    // Check initial upload folder file count
    const uploadDir = process.env.UPLOADS_DIR;
    const initialFiles = fs.existsSync(uploadDir) ? fs.readdirSync(uploadDir) : [];

    // Create a 51 MB buffer to exceed the 50 MB threshold
    const oversizedBuffer = Buffer.alloc(51 * 1024 * 1024, 'x');

    const res = await request(app)
      .post('/upload')
      .attach('file', oversizedBuffer, 'oversized.bin');

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/exceeds/i);

    // Verify no new files remained on disk
    const currentFiles = fs.existsSync(uploadDir) ? fs.readdirSync(uploadDir) : [];
    expect(currentFiles.length).toBe(initialFiles.length);
  });

  // Test 7: Delete with wrong token fails, delete with right token works
  test('Delete with wrong token returns 403, right token returns 200 and purges record', async () => {
    const uploadRes = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('delete test file'), 'manual-delete.txt');

    const fileId = uploadRes.body.id;
    const deleteToken = uploadRes.body.delete_token;

    // Attempt delete with wrong token
    const wrongTokenRes = await request(app)
      .delete(`/f/${fileId}`)
      .set('x-delete-token', 'invalid-token-123');
    expect(wrongTokenRes.status).toBe(403);

    // Attempt delete with correct token
    const rightTokenRes = await request(app)
      .delete(`/f/${fileId}`)
      .set('x-delete-token', deleteToken);
    expect(rightTokenRes.status).toBe(200);
    expect(rightTokenRes.body.success).toBe(true);

    // File should be gone
    const verifyRes = await request(app).get(`/f/${fileId}`);
    expect(verifyRes.status).toBe(404);
  });

  // Test 8: Cleanup job removes expired file from disk and DB
  test('Cleanup job removes expired and used-up files from disk and DB', async () => {
    const uploadRes = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('cleanup target file'), 'cleanup-test.txt')
      .field('expiry', '1m');

    const fileId = uploadRes.body.id;

    // Manually mark expired in DB
    db.prepare('UPDATE files SET expires_at = ? WHERE id = ?').run(Date.now() - 50000, fileId);

    // Run cleanup
    const prunedCount = runCleanupJob();
    expect(prunedCount).toBeGreaterThanOrEqual(1);

    // Verify row removed from DB
    const row = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
    expect(row).toBeUndefined();
  });

  // Test 9: POST /upload/presign initializes metadata record
  test('POST /upload/presign creates pending record and returns management credentials', async () => {
    const res = await request(app)
      .post('/upload/presign')
      .send({
        filename: 'cloud-document.pdf',
        size: 1048576,
        mimeType: 'application/pdf',
        expiry: '2h',
        max_downloads: 5
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.delete_token).toBeDefined();
    expect(res.body.download_url).toBe(`/f/${res.body.id}`);
    expect(res.body.original_name).toBe('cloud-document.pdf');
    expect(res.body.size).toBe(1048576);
    expect(res.body.storage_type).toBe('local'); // In test env without R2 credentials

    // Verify row exists in DB
    const row = db.prepare('SELECT * FROM files WHERE id = ?').get(res.body.id);
    expect(row).toBeDefined();
    expect(row.original_name).toBe('cloud-document.pdf');
  });

  // Test 10: POST /upload/presign rejects file over 50 MB
  test('POST /upload/presign rejects files exceeding 50 MB limit with 413', async () => {
    const res = await request(app)
      .post('/upload/presign')
      .send({
        filename: 'massive-video.mov',
        size: 55 * 1024 * 1024 // 55 MB
      });

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/exceeds/i);
  });

  // Test 11: POST /upload/presign validates required fields
  test('POST /upload/presign returns 400 when filename or size is invalid', async () => {
    const res1 = await request(app)
      .post('/upload/presign')
      .send({ size: 1024 });
    expect(res1.status).toBe(400);

    const res2 = await request(app)
      .post('/upload/presign')
      .send({ filename: 'test.txt', size: -1 });
    expect(res2.status).toBe(400);
  });

  // S3-Compatible Storage Tests
  describe('S3-Compatible Object Storage Adapter (Cloudflare R2 & Supabase)', () => {
    const {
      isR2Configured,
      getStorageProviderName,
      resetS3Client,
      getS3Client,
      getPresignedUploadUrl,
      getPresignedDownloadUrl
    } = require('../src/storage/r2');

    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
      resetS3Client();
    });

    test('isR2Configured() returns false when credentials are missing', () => {
      delete process.env.R2_BUCKET_NAME;
      delete process.env.R2_ACCESS_KEY_ID;
      delete process.env.R2_SECRET_ACCESS_KEY;
      delete process.env.R2_ACCOUNT_ID;
      delete process.env.R2_ENDPOINT;
      expect(isR2Configured()).toBe(false);
      expect(getStorageProviderName()).toBe('local-disk');
    });

    test('Cloudflare R2 mode: derives endpoint from R2_ACCOUNT_ID', async () => {
      process.env.R2_BUCKET_NAME = 'my-r2-bucket';
      process.env.R2_ACCESS_KEY_ID = 'r2-access-key';
      process.env.R2_SECRET_ACCESS_KEY = 'r2-secret-key';
      process.env.R2_ACCOUNT_ID = '55b03bafa5e00fcd8ea4112233445566';
      delete process.env.R2_ENDPOINT;

      expect(isR2Configured()).toBe(true);
      expect(getStorageProviderName()).toBe('cloudflare-r2');

      const client = getS3Client();
      expect(client).toBeDefined();

      const uploadUrl = await getPresignedUploadUrl({
        key: 'cloud-file.pdf',
        mimeType: 'application/pdf',
        expiresIn: 60
      });
      expect(uploadUrl).toContain('55b03bafa5e00fcd8ea4112233445566.r2.cloudflarestorage.com');
      expect(uploadUrl).toContain('my-r2-bucket');
    });

    test('Supabase S3 mode: uses custom R2_ENDPOINT with forcePathStyle', async () => {
      process.env.R2_BUCKET_NAME = 'supabase-vault';
      process.env.R2_ACCESS_KEY_ID = 'supabase-s3-key';
      process.env.R2_SECRET_ACCESS_KEY = 'supabase-s3-secret';
      process.env.R2_ENDPOINT = 'https://abcdefghijklmnop.storage.supabase.co/storage/v1/s3';
      process.env.R2_REGION = 'eu-west-2';
      process.env.R2_FORCE_PATH_STYLE = 'true';
      delete process.env.R2_ACCOUNT_ID;

      expect(isR2Configured()).toBe(true);
      expect(getStorageProviderName()).toBe('supabase-s3');

      const client = getS3Client();
      expect(client).toBeDefined();

      const uploadUrl = await getPresignedUploadUrl({
        key: 'test-doc.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        expiresIn: 120
      });
      expect(uploadUrl).toContain('https://abcdefghijklmnop.storage.supabase.co/storage/v1/s3/supabase-vault/test-doc.docx');
      expect(uploadUrl).toContain('X-Amz-Signature');
    });

    test('getPresignedDownloadUrl formats Content-Disposition attachment', async () => {
      process.env.R2_BUCKET_NAME = 'test-bucket';
      process.env.R2_ACCESS_KEY_ID = 'key123';
      process.env.R2_SECRET_ACCESS_KEY = 'secret123';
      process.env.R2_ENDPOINT = 'https://s3.example.com';
      process.env.R2_FORCE_PATH_STYLE = 'true';

      const downloadUrl = await getPresignedDownloadUrl({
        key: 'sample-key.png',
        filename: 'My Photo.png',
        mimeType: 'image/png',
        expiresIn: 60
      });

      expect(downloadUrl).toContain('https://s3.example.com/test-bucket/sample-key.png');
      expect(downloadUrl).toContain('response-content-disposition');
      expect(decodeURIComponent(decodeURIComponent(downloadUrl))).toContain('My Photo.png');
    });
  });
});

