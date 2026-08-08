/**
 * Verify test data was created correctly in MongoDB
 */

const mongoose = require('mongoose');
const Transaction = require('./src/models/Transaction');

async function main() {
  try {
    await mongoose.connect(process.env.MONGODB_URL || 'mongodb://localhost:27017/ngodb');
    console.log('✓ Connected to MongoDB\n');

    // Find all transactions for trader 1
    const txns = await Transaction.find({ traderId: 1 })
      .populate('rawEventId', ['type', 'body', 'deviceId'])
      .sort({ scrapedAt: -1 })
      .limit(20);

    console.log(`📊 Found ${txns.length} transactions for trader 1\n`);

    // Show the 5 test transactions
    const testTxns = txns.filter(t => 
      ['ORD-2024-001', 'TXN-20240808-002', 'ICICI-SMS-001', 'AXIS-LARGE-001', 'WEB-SCRAPE-001'].includes(t.txnId)
    );

    if (testTxns.length === 0) {
      console.log('⚠️  No test transactions found! Did the generator run successfully?');
      process.exit(1);
    }

    console.log(`✅ Found ${testTxns.length} test transactions:\n`);

    testTxns.forEach((t, i) => {
      const rawEvent = t.rawEventId;
      const captureType = rawEvent ? rawEvent.type : 'Web scraper';
      const source = rawEvent ? '(has rawEventId)' : '(no rawEventId)';

      console.log(`${i + 1}. ${t.txnId}`);
      console.log(`   Amount: ₹${t.amount}  |  Platform: ${t.platform}  |  Matched: ${t.matched}`);
      console.log(`   Capture: ${captureType} ${source}`);
      console.log(`   Payer: ${t.payerName}`);
      if (rawEvent) {
        console.log(`   Body (first 80 chars): ${rawEvent.body.substring(0, 80)}...`);
      }
      console.log();
    });

    console.log('\n✅ All test data verified! Ready to test Notifications page.');
    console.log('\n📋 Next: Start the dev servers and navigate to Notifications page.');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

main();
