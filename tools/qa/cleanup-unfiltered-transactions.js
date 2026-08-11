#!/usr/bin/env node
/**
 * One-off cleanup for the debug Transactions created while
 * TEMP_SKIP_PAYMENT_FILTER was on (2026-08-09 → 2026-08-11).
 *
 * While that flag was set, ngo-backend/src/routes/apk.js recorded EVERY
 * captured notification as a Transaction — promotional offers, OTPs, loan
 * spam — instead of only real payments. Those rows were deliberately tagged
 * with a '-unfiltered' platform suffix so they could be found again. The flag
 * and the suffix are both gone from the code now; this removes the rows it
 * left behind.
 *
 * Local Mongo had zero such rows at the time this was written — they exist on
 * the deployed VPS database, which is where this is meant to run.
 *
 * Usage (from the repo root, on the machine with the target Mongo):
 *   node tools/qa/cleanup-unfiltered-transactions.js            # dry run
 *   node tools/qa/cleanup-unfiltered-transactions.js --confirm  # delete
 *
 * Dry run by default and on purpose: it prints what it would delete, and
 * refuses to touch anything until you pass --confirm.
 */

const path = require('path');
const NGO = path.resolve(__dirname, '..', '..', 'ngo-backend');

require(path.join(NGO, 'node_modules', 'dotenv')).config({
  path: process.env.NGO_ENV_FILE || path.join(NGO, '.env'),
});
const mongoose = require(path.join(NGO, 'node_modules', 'mongoose'));

const CONFIRM = process.argv.includes('--confirm');
const FILTER = { platform: /-unfiltered$/ };

(async () => {
  const url = process.env.MONGODB_URL;
  if (!url) throw new Error('MONGODB_URL is not set (check ngo-backend/.env, or set NGO_ENV_FILE)');
  await mongoose.connect(url);
  const Transaction = require(path.join(NGO, 'src', 'models', 'Transaction'));

  const total = await Transaction.countDocuments({});
  const doomed = await Transaction.countDocuments(FILTER);
  console.log(`Transactions in this database : ${total}`);
  console.log(`matching /-unfiltered$/        : ${doomed}`);

  if (!doomed) {
    console.log('\nNothing to clean up.');
    await mongoose.disconnect();
    return;
  }

  // A row that actually settled a real order is NOT debug noise, whatever its
  // platform tag says — surface it loudly rather than deleting it silently.
  const settled = await Transaction.countDocuments({ ...FILTER, matched: true });
  if (settled) {
    console.log(`\n!! ${settled} of these are marked matched:true (they settled a real order).`);
    console.log('   Review these before deleting — this script will SKIP them.');
  }

  const sample = await Transaction.find(FILTER).limit(10).lean();
  console.log('\nsample of what matches:');
  sample.forEach((t) => console.log(
    `  ${String(t.platform).padEnd(22)} ₹${String(t.amount).padEnd(10)} ${(t.payerName || '').slice(0, 60)}`
  ));

  const target = { ...FILTER, matched: { $ne: true } };
  const deletable = await Transaction.countDocuments(target);

  if (!CONFIRM) {
    console.log(`\nDRY RUN — would delete ${deletable} row(s) (keeping ${settled} matched).`);
    console.log('Re-run with --confirm to actually delete.');
    await mongoose.disconnect();
    return;
  }

  const res = await Transaction.deleteMany(target);
  const left = await Transaction.countDocuments(FILTER);
  console.log(`\nDeleted ${res.deletedCount} row(s). Remaining -unfiltered rows: ${left} (matched ones kept).`);
  await mongoose.disconnect();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
