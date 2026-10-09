/**
 * LinkVault - Authentication & Password Utilities
 *
 * This file handles hashing and verifying file passwords using bcrypt.
 * We use bcrypt because it is a one-way mathematical function with a "salt"
 * (random data) added to each password, protecting stored passwords even if
 * the database is leaked.
 */

const bcrypt = require('bcryptjs');

// The number of hashing rounds. 10 rounds is the industry standard balance
// between security and CPU calculation speed (~100ms per hash).
const SALT_ROUNDS = 10;

/**
 * Hash a plain-text password using bcrypt.
 *
 * @param {string} password - The raw password entered by the user
 * @returns {string|null} - The resulting bcrypt hash string, or null if no password was given
 */
function hashPassword(password) {
  // If the user didn't enter a password, return null (meaning file is not password-protected)
  if (!password) {
    return null;
  }

  if (typeof password !== 'string') {
    return null;
  }

  const cleanPassword = password.trim();
  if (cleanPassword.length === 0) {
    return null;
  }

  // Generate a secure hash with a random salt
  return bcrypt.hashSync(cleanPassword, SALT_ROUNDS);
}

/**
 * Compare a plain-text password against a stored bcrypt hash.
 *
 * @param {string} password - The password attempt entered by the downloader
 * @param {string|null} storedHash - The hash saved in our database (or null if unprotected)
 * @returns {boolean} - True if password is correct or not required; false if incorrect
 */
function verifyPassword(password, storedHash) {
  // If the file doesn't have a password set, access is granted automatically
  if (!storedHash) {
    return true;
  }

  // If a password is required but none was provided, reject immediately
  if (!password || typeof password !== 'string') {
    return false;
  }

  const cleanPassword = password.trim();

  // bcrypt.compareSync safely checks the password against the stored hash
  return bcrypt.compareSync(cleanPassword, storedHash);
}

module.exports = {
  hashPassword,
  verifyPassword
};
