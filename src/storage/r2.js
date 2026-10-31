/**
 * LinkVault - Cloudflare R2 Object Storage Adapter
 * Offloads binary storage to Cloudflare R2 (S3-compatible API) with ZERO egress fees.
 * Handles generation of short-lived presigned PUT and GET URLs.
 */

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

let s3ClientInstance = null;

function isR2Configured() {
  return Boolean(
    process.env.R2_BUCKET_NAME &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    (process.env.R2_ACCOUNT_ID || process.env.R2_ENDPOINT)
  );
}

function getStorageProviderName() {
  if (!isR2Configured()) return 'local-disk';
  const endpoint = process.env.R2_ENDPOINT || '';
  if (endpoint.includes('supabase.co')) {
    return 'supabase-s3';
  }
  if (process.env.R2_ACCOUNT_ID || endpoint.includes('r2.cloudflarestorage.com')) {
    return 'cloudflare-r2';
  }
  if (endpoint.includes('localhost') || endpoint.includes('127.0.0.1') || endpoint.includes(':9000')) {
    return 'minio-s3';
  }
  return 's3-compatible';
}

function resetS3Client() {
  s3ClientInstance = null;
}

function getS3Client() {
  if (s3ClientInstance) return s3ClientInstance;

  // 1. Explicit endpoint (e.g. Supabase Storage S3, MinIO, or custom edge CDN)
  // 2. Or dynamically derived Cloudflare R2 endpoint from Account ID
  const endpoint = process.env.R2_ENDPOINT ||
    (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);

  s3ClientInstance = new S3Client({
    region: process.env.R2_REGION || 'auto',
    endpoint: endpoint,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || ''
    },
    // Force path style if using Supabase, MinIO, or custom S3 emulator
    forcePathStyle: Boolean(process.env.R2_FORCE_PATH_STYLE === 'true')
  });

  return s3ClientInstance;
}

/**
 * Generates a short-lived presigned PUT URL for browser direct-to-R2 upload.
 *
 * @param {object} params
 * @param {string} params.key - Unique object key in R2
 * @param {string} params.mimeType - MIME content type
 * @param {number} [params.expiresIn=120] - TTL in seconds (default 2 minutes)
 * @returns {Promise<string>} Signed PUT URL
 */
async function getPresignedUploadUrl({ key, mimeType, expiresIn = 120 }) {
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    ContentType: mimeType || 'application/octet-stream'
  });

  return getSignedUrl(client, command, { expiresIn });
}

/**
 * Generates a short-lived presigned GET URL for atomic direct download.
 *
 * @param {object} params
 * @param {string} params.key - Object key in R2
 * @param {string} params.filename - Original filename for Content-Disposition
 * @param {string} [params.mimeType] - Optional MIME type override
 * @param {number} [params.expiresIn=60] - TTL in seconds (default 60 seconds)
 * @returns {Promise<string>} Signed GET URL
 */
async function getPresignedDownloadUrl({ key, filename, mimeType, expiresIn = 60 }) {
  const client = getS3Client();
  const encodedFilename = encodeURIComponent(filename);

  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`,
    ResponseContentType: mimeType || 'application/octet-stream'
  });

  return getSignedUrl(client, command, { expiresIn });
}

/**
 * Deletes a single object from Cloudflare R2.
 */
async function deleteR2Object(key) {
  try {
    const client = getS3Client();
    await client.send(new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key
    }));
    return true;
  } catch (err) {
    console.error(`[R2] Failed to delete object ${key}:`, err.message);
    return false;
  }
}

/**
 * Batch deletes multiple objects from Cloudflare R2.
 */
async function deleteR2Objects(keys = []) {
  if (!keys.length) return true;
  try {
    const client = getS3Client();
    const objects = keys.map(k => ({ Key: k }));
    await client.send(new DeleteObjectsCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Delete: { Objects: objects }
    }));
    return true;
  } catch (err) {
    console.error(`[R2] Failed to batch delete ${keys.length} objects:`, err.message);
    return false;
  }
}

module.exports = {
  isR2Configured,
  getStorageProviderName,
  resetS3Client,
  getS3Client,
  getPresignedUploadUrl,
  getPresignedDownloadUrl,
  deleteR2Object,
  deleteR2Objects
};
