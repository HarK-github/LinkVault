const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;

function hashPassword(password) {
  if (!password || typeof password !== 'string' || password.trim().length === 0) {
    return null;
  }
  return bcrypt.hashSync(password.trim(), SALT_ROUNDS);
}

function verifyPassword(password, hash) {
  if (!hash) {
    return true;
  }
  if (!password || typeof password !== 'string') {
    return false;
  }
  return bcrypt.compareSync(password.trim(), hash);
}

module.exports = {
  hashPassword,
  verifyPassword
};
