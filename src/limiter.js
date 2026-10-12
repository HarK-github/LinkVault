const isTestEnvironment = process.env.NODE_ENV === 'test' && !process.env.ENABLE_RATE_LIMIT_IN_TEST;

function createLimiter(windowMs, max, message) {
  const requests = new Map();

  return function rateLimitMiddleware(req, res, next) {
    if (isTestEnvironment) return next();

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const timestamps = (requests.get(ip) || []).filter((t) => now - t < windowMs);

    if (timestamps.length >= max) {
      return res.status(429).json({ error: message });
    }

    timestamps.push(now);
    requests.set(ip, timestamps);
    next();
  };
}

const uploadLimiter = createLimiter(
  60 * 60 * 1000,
  20,
  'Upload rate limit exceeded. Please try again in an hour.'
);

const downloadLimiter = createLimiter(
  15 * 60 * 1000,
  100,
  'Download rate limit exceeded. Please try again shortly.'
);

module.exports = {
  uploadLimiter,
  downloadLimiter
};

