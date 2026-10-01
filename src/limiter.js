const rateLimit = require('express-rate-limit');

// By default in test environment, skip limiting unless specifically enabled
const isTest = process.env.NODE_ENV === 'test' && !process.env.ENABLE_RATE_LIMIT_IN_TEST;

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // Limit each IP to 20 uploads per hour
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: {
    error: 'Upload rate limit exceeded. Please try again in an hour.'
  },
  statusCode: 429
});

const downloadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 download requests per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: {
    error: 'Download rate limit exceeded. Please try again shortly.'
  },
  statusCode: 429
});

module.exports = {
  uploadLimiter,
  downloadLimiter
};
