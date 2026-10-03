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
  test('GET /health returns 200 OK', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
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
});
