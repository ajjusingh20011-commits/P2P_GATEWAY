const CryptoJS = require('crypto-js');
const { GENESIS_HASH } = require('../config/constants');

/**
 * Tamper-evident hash chain for ledger entries. Each entry's hash is derived
 * from the previous entry's hash plus a deterministic serialization of the
 * entry data, so any retroactive edit breaks every subsequent link.
 */

/**
 * Generates the SHA256 hash for a ledger entry.
 * @param {Object} data     the ledger payload to hash
 * @param {string} prevHash the hash of the previous ledger entry
 * @returns {string} hex-encoded SHA256 digest
 */
function generateHash(data, prevHash) {
  const safePrev = prevHash || GENESIS_HASH;
  const payload = safePrev + JSON.stringify(data);
  return CryptoJS.SHA256(payload).toString(CryptoJS.enc.Hex);
}

/**
 * Fetches the hash of the most recent ledger entry, or the genesis hash
 * ("0000000000") if no entries exist yet.
 *
 * Lazily requires the Ledger model to avoid a circular dependency
 * (Ledger -> hashChain -> Ledger).
 * @returns {Promise<string>}
 */
async function getLastHash() {
  // eslint-disable-next-line global-require
  const Ledger = require('../models/Ledger');
  const last = await Ledger.findOne().sort({ createdAt: -1 }).select('hash').lean();
  return last && last.hash ? last.hash : GENESIS_HASH;
}

module.exports = { generateHash, getLastHash, GENESIS_HASH };
