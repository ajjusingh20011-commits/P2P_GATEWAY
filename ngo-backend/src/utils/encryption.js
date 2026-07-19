const CryptoJS = require('crypto-js');

/**
 * Symmetric AES encryption helpers backed by ENCRYPTION_KEY from the env.
 * Used to store sensitive payment-account credentials at rest.
 */

function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY is not set in the environment');
  }
  return key;
}

/**
 * Encrypts a plaintext string with AES. Returns an empty string for empty input.
 * @param {string} text
 * @returns {string} AES ciphertext (Base64)
 */
function encrypt(text) {
  if (text === undefined || text === null || text === '') {
    return '';
  }
  return CryptoJS.AES.encrypt(String(text), getKey()).toString();
}

/**
 * Decrypts an AES ciphertext produced by {@link encrypt}.
 * Returns an empty string for empty input.
 * @param {string} cipherText
 * @returns {string} the original plaintext
 */
function decrypt(cipherText) {
  if (cipherText === undefined || cipherText === null || cipherText === '') {
    return '';
  }
  const bytes = CryptoJS.AES.decrypt(String(cipherText), getKey());
  return bytes.toString(CryptoJS.enc.Utf8);
}

module.exports = { encrypt, decrypt };
