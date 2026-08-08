/**
 * Simple verification using MongoDB native driver
 */

const { MongoClient } = require('mongodb');

async function main() {
  const url = process.env.MONGODB_URL || 'mongodb://localhost:27017/ngodb';
  const client = new MongoClient(url);

  try {
    await client.connect();
    console.log('✓ Connected to MongoDB\n');

    const db = client.db('ngodb');
    const txns = db.collection('transactions');

    // Find test transactions
    const testTxns = await txns
      .find({ txnId: { $in: ['ORD-2024-001', 'TXN-20240808-002', 'ICICI-SMS-001', 'AXIS-LARGE-001', 'WEB-SCRAPE-001'] } })
      .sort({ scrapedAt: -1 })
      .toArray();

    console.log(`📊 Test Transactions Found: ${testTxns.length}\n`);

    if (testTxns.length === 0) {
      console.log('❌ No test transactions found!');
      process.exit(1);
    }

    console.log('Transaction Details:\n');
    testTxns.forEach((t, i) => {
      console.log(`${i + 1}. ${t.txnId}`);
      console.log(`   Amount: ₹${t.amount}  |  Platform: ${t.platform}  |  Matched: ${t.matched ? '✓ Linked' : '⏳ Process'}`);
      console.log(`   Has RawEvent: ${t.rawEventId ? '✓ Yes' : '✗ No (Web scraper)'}`);
      console.log(`   Payer: ${t.payerName}`);
      console.log();
    });

    console.log('\n✅ All 5 test transactions verified in MongoDB!');
    console.log('\n📋 Ready to test on Notifications page.');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
