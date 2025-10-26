const crypto = require('crypto');

let bcrypt = null;
try {
  bcrypt = require('bcryptjs');
} catch (error) {
  bcrypt = null;
}

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;
const HASH_PREFIX = 'scrypt$';

function hashWithScrypt(password) {
  const salt = crypto.randomBytes(SALT_LENGTH).toString('hex');
  const derived = crypto.scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${HASH_PREFIX}${salt}$${derived}`;
}

function verifyWithScrypt(password, storedHash) {
  if (!storedHash.startsWith(HASH_PREFIX)) {
    return false;
  }

  const [, salt, derived] = storedHash.split('$');
  if (!salt || !derived) {
    return false;
  }

  const computed = crypto.scryptSync(password, salt, KEY_LENGTH).toString('hex');
  const storedBuffer = Buffer.from(derived, 'hex');
  const computedBuffer = Buffer.from(computed, 'hex');

  if (storedBuffer.length !== computedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(storedBuffer, computedBuffer);
}

function hashPassword(password) {
  if (bcrypt) {
    return bcrypt.hashSync(password, 10);
  }

  return hashWithScrypt(password);
}

function verifyPassword(password, storedHash) {
  if (!storedHash) {
    return false;
  }

  if (storedHash.startsWith(HASH_PREFIX)) {
    return verifyWithScrypt(password, storedHash);
  }

  if (bcrypt) {
    return bcrypt.compareSync(password, storedHash);
  }

  return false;
}

module.exports = {
  hashPassword,
  verifyPassword,
  HASH_PREFIX,
  hashWithScrypt,
  verifyWithScrypt,
};
