const Ledger = require('../models/Ledger');
const NGO = require('../models/NGO');
const { generateHash, getLastHash, GENESIS_HASH } = require('../utils/hashChain');

/**
 * Append-only, hash-chained public ledger of verified donations.
 */

// Only these stable fields participate in the hash so the chain is
// reproducible and independently verifiable later.
function hashableView(entry) {
  return {
    ngoId: entry.ngoId ? String(entry.ngoId) : '',
    donorName: entry.donorName || '',
    amount: entry.amount || '',
    utr: entry.utr || '',
    txnId: entry.txnId || '',
    upiId: entry.upiId || '',
    platform: entry.platform || '',
    purpose: entry.purpose || '',
    verifiedAt: entry.verifiedAt
      ? new Date(entry.verifiedAt).toISOString()
      : new Date().toISOString(),
  };
}

/**
 * Creates a new ledger entry, linking it into the hash chain.
 *  - reads the previous hash via getLastHash()
 *  - computes this entry's hash via generateHash(data, prevHash)
 *  - persists and returns the saved entry
 * @param {Object} data ledger fields (ngoId, donorName, amount, utr, …)
 * @returns {Promise<Object>} the saved Ledger document
 */
async function createEntry(data) {
  const prevHash = await getLastHash();
  const view = hashableView(data);
  const hash = generateHash(view, prevHash);

  const entry = await Ledger.create({
    ...data,
    verifiedAt: view.verifiedAt,
    prevHash,
    hash,
  });

  // Keep the NGO running total in sync for quick reads.
  const amountNum = parseFloat(String(data.amount || '').replace(/,/g, ''));
  if (!Number.isNaN(amountNum) && data.ngoId) {
    await NGO.findByIdAndUpdate(data.ngoId, { $inc: { totalDonations: amountNum } });
  }

  return entry;
}

/**
 * Returns ledger entries (newest first). Pass isPublic:true in filter to
 * restrict to public entries.
 */
async function getLedger(filter = {}, { skip = 0, limit = 0 } = {}) {
  let q = Ledger.find(filter).sort({ createdAt: -1 });
  if (skip) q = q.skip(skip);
  if (limit) q = q.limit(limit);
  return q;
}

/**
 * Verifies the whole chain in creation order.
 * @returns {Promise<{valid: boolean, brokenAt: number|null}>}
 *   brokenAt is the 0-based index of the first broken entry, or null if valid.
 */
async function verifyChain() {
  const entries = await Ledger.find().sort({ createdAt: 1 }).lean();
  let prevHash = GENESIS_HASH;

  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    const expected = generateHash(hashableView(e), prevHash);
    if (e.prevHash !== prevHash || e.hash !== expected) {
      return { valid: false, brokenAt: i };
    }
    prevHash = e.hash;
  }

  return { valid: true, brokenAt: null };
}

module.exports = { createEntry, getLedger, getPublicLedger: getLedger, verifyChain };
