/**
 * LinkVault - API Rate Limiting Middleware
 *
 * Why Rate Limiting?
 * Rate limiting protects our server against Denial-of-Service (DoS) attacks and abuse:
 * - Upload limiter: Prevents malicious actors or buggy scripts from filling up the server's hard drive.
 * - Download limiter: Prevents brute-force password guessing and server bandwidth exhaustion.
 */

const rateLimit = require('express-rate-limit');

// In automated test runs, we disable rate limits by default so tests run fast without 429 errors.
const isTestEnvironment = process.env.NODE_ENV === 'test' && !process.env.ENABLE_RATE_LIMIT_IN_TEST;

/**
 * Upload Rate Limiter:
 * Allows a maximum of 20 file uploads per IP address per hour.
 */
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour time window in milliseconds
  max: 20,                  // Max 20 uploads allowed per window
  standardHeaders: true,    // Send standard RateLimit-* headers in the response
  legacyHeaders: false,     // Disable obsolete X-RateLimit-* headers
  skip: function () {
    return isTestEnvironment;
  },
  message: {
    error: 'Upload rate limit exceeded. Please try again in an hour.'
  },
  statusCode: 429           // HTTP 429 Too Many Requests
});

/**
 * Download Rate Limiter:
 * Allows a maximum of 100 download requests per IP address per 15 minutes.
 */
const downloadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minute time window in milliseconds
  max: 100,                 // Max 100 downloads allowed per window
  standardHeaders: true,
  legacyHeaders: false,
  skip: function () {
    return isTestEnvironment;
  },
  message: {
    error: 'Download rate limit exceeded. Please try again shortly.'
  },
  statusCode: 429
});

module.exports = {
  uploadLimiter,
  downloadLimiter
};
