const crypto = require('crypto');

/**
 * Hash a plain-text password using native scrypt.
 * Returns salt:hash or null if unprotected.
 */
function hashPassword(password) {
  if (!password || typeof password !== 'string') return null;
  const clean = password.trim();
  if (!clean) return null;
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(clean, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Compare password against stored hash using constant-time comparison.
 */
function verifyPassword(password, storedHash) {
  if (!storedHash) return true;
  if (!password || typeof password !== 'string') return false;
  const clean = password.trim();
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const attempt = crypto.scryptSync(clean, salt, 32);
  const target = Buffer.from(hash, 'hex');
  return attempt.length === target.length && crypto.timingSafeEqual(attempt, target);
}

module.exports = { hashPassword, verifyPassword };

