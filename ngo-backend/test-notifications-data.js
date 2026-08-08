/**
 * Test data generator for Notifications page redesign.
 * Creates 5 comprehensive demo transactions covering all capture types:
 * - APK Notification (Linked & unlinked)
 * - APK SMS (Linked & unlinked)
 * - Web scraper (Linked)
 *
 * With varied realistic data: senders, timestamps, amounts, platforms.
 * All marked as TEST DATA for easy cleanup.
 *
 * Run: node test-notifications-data.js
 */

const mongoose = require('mongoose');
const Device = require('./src/models/Device');
const RawEvent = require('./src/models/RawEvent');
const Transaction = require('./src/models/Transaction');

async function main() {
  try {
    await mongoose.connect(process.env.MONGODB_URL || 'mongodb://localhost:27017/ngodb');
    console.log('✓ Connected to MongoDB');

    // Test trader ID and device ID
    const TRADER_ID = 1;
    const DEVICE_ID = 'test-device-' + Date.now();
    const ACCOUNT_ID = new mongoose.Types.ObjectId();

    console.log('\n' + '='.repeat(70));
    console.log('TEST DATA GENERATOR — Notifications Page Redesign');
    console.log('='.repeat(70));

    // 1. Create or get a test Device
    console.log('\n📱 Setting up test device...');
    const device = await Device.findOneAndUpdate(
      { deviceId: DEVICE_ID },
      {
        deviceId: DEVICE_ID,
        traderId: TRADER_ID,
        deviceName: 'Demo Device (Test)',
        deviceModel: 'Pixel 6 Pro',
        androidVersion: '13',
        appVersion: '2.1.0',
        status: 'active',
      },
      { upsert: true, new: true }
    );
    console.log(`   ✓ Device: ${device.deviceName} (${DEVICE_ID})`);

    const transactions = [];

    // Helper: generate timestamp for today
    function getTimestampForToday(hourOffset = 0, minuteOffset = 0) {
      const now = new Date();
      now.setHours(Math.max(6, 18 - hourOffset), minuteOffset, 0, 0);
      return now;
    }

    // ========================================================================
    // 1. APK Notification, Linked, ₹500
    // ========================================================================
    console.log('\n1️⃣  APK Notification (Linked) — ₹500');
    const notif1RawEvent = await RawEvent.create({
      deviceId: DEVICE_ID,
      traderId: TRADER_ID,
      type: 'NOTIFICATION',
      sender: 'com.google.android.apps.nbu.paisa.user',
      body: 'Payment received from Priya Sharma for ₹500. UPI Ref: 520420048991AB1. Balance: ₹18,500. -Google Pay',
      category: 'PAYMENT',
      amount: '500',
      utr: '520420048991AB1',
      utcTimestamp: getTimestampForToday(2).toISOString(),
      processed: false,
    });
    const notif1Txn = await Transaction.create({
      traderId: TRADER_ID,
      accountId: ACCOUNT_ID,
      platform: 'gpay',
      amount: '500',
      payerName: 'Priya Sharma',
      payerUpiId: 'priya.sharma@okhdfcbank',
      utr: '520420048991AB1',
      txnId: 'ORD-2024-001',
      status: 'SUCCESS',
      matched: true,  // LINKED
      rawEventId: notif1RawEvent._id,
      scrapedAt: getTimestampForToday(2),
    });
    transactions.push(notif1Txn);
    console.log(`   Type: Notification  |  Status: Linked ✓  |  Sender: Priya Sharma`);

    // ========================================================================
    // 2. APK Notification, Process (unlinked), ₹1,200
    // ========================================================================
    console.log('\n2️⃣  APK Notification (Process) — ₹1,200');
    const notif2RawEvent = await RawEvent.create({
      deviceId: DEVICE_ID,
      traderId: TRADER_ID,
      type: 'NOTIFICATION',
      sender: 'net.one97.paytm',
      body: 'You received ₹1,200 from Amit Patel via Paytm. Reference: UPI1204958761AB. Check now: paytm.com',
      category: 'PAYMENT',
      amount: '1200',
      utr: 'UPI1204958761AB',
      utcTimestamp: getTimestampForToday(3, 15).toISOString(),
      processed: false,
    });
    const notif2Txn = await Transaction.create({
      traderId: TRADER_ID,
      accountId: ACCOUNT_ID,
      platform: 'paytm',
      amount: '1200',
      payerName: 'Amit Patel',
      payerUpiId: 'amit.p@paytm',
      utr: 'UPI1204958761AB',
      txnId: 'TXN-20240808-002',
      status: 'SUCCESS',
      matched: false,  // PROCESS (not linked)
      rawEventId: notif2RawEvent._id,
      scrapedAt: getTimestampForToday(3, 15),
    });
    transactions.push(notif2Txn);
    console.log(`   Type: Notification  |  Status: Process ⏳  |  Sender: Amit Patel`);

    // ========================================================================
    // 3. APK SMS, Linked, ₹300
    // ========================================================================
    console.log('\n3️⃣  APK SMS (Linked) — ₹300');
    const sms1RawEvent = await RawEvent.create({
      deviceId: DEVICE_ID,
      traderId: TRADER_ID,
      type: 'SMS',
      sender: 'ICIC-ICICIBK-T',
      body: 'A/c **0456 debited for INR 300. Avl Bal: INR 42,750. Ref No. RRN654321987. -ICICI Bank',
      category: 'PAYMENT',
      amount: '300',
      utr: 'RRN654321987',
      utcTimestamp: getTimestampForToday(1, 45).toISOString(),
      processed: false,
    });
    const sms1Txn = await Transaction.create({
      traderId: TRADER_ID,
      accountId: ACCOUNT_ID,
      platform: 'paytm',
      amount: '300',
      payerName: 'ICICI Bank SMS',
      payerUpiId: 'debit@icici',
      utr: 'RRN654321987',
      txnId: 'ICICI-SMS-001',
      status: 'SUCCESS',
      matched: true,  // LINKED
      rawEventId: sms1RawEvent._id,
      scrapedAt: getTimestampForToday(1, 45),
    });
    transactions.push(sms1Txn);
    console.log(`   Type: SMS  |  Status: Linked ✓  |  Sender: ICICI Bank`);

    // ========================================================================
    // 4. APK SMS, Process (unlinked), ₹75,000
    // ========================================================================
    console.log('\n4️⃣  APK SMS (Process) — ₹75,000');
    const sms2RawEvent = await RawEvent.create({
      deviceId: DEVICE_ID,
      traderId: TRADER_ID,
      type: 'SMS',
      sender: 'AXIS-AXISBANK-T',
      body: 'Your A/C ending with 7890 has been debited with INR 75,000.00 on 08-08-2024 at 14:32. Avl balance: INR 1,25,000. Ref:UPI7654321098. -Axis Bank',
      category: 'PAYMENT',
      amount: '75000',
      utr: 'UPI7654321098',
      utcTimestamp: getTimestampForToday(4, 32).toISOString(),
      processed: false,
    });
    const sms2Txn = await Transaction.create({
      traderId: TRADER_ID,
      accountId: ACCOUNT_ID,
      platform: 'paytm',
      amount: '75000',
      payerName: 'Axis Bank SMS',
      payerUpiId: 'debit@axisbank',
      utr: 'UPI7654321098',
      txnId: 'AXIS-LARGE-001',
      status: 'PENDING',
      matched: false,  // PROCESS (not linked)
      rawEventId: sms2RawEvent._id,
      scrapedAt: getTimestampForToday(4, 32),
    });
    transactions.push(sms2Txn);
    console.log(`   Type: SMS  |  Status: Process ⏳  |  Sender: Axis Bank`);

    // ========================================================================
    // 5. Web scraper, Linked, ₹20
    // ========================================================================
    console.log('\n5️⃣  Web Scraper (Linked) — ₹20');
    const web1Txn = await Transaction.create({
      traderId: TRADER_ID,
      accountId: ACCOUNT_ID,
      platform: 'paytm',
      amount: '20',
      payerName: 'Scraped: Varun Singh',
      payerUpiId: 'varun.singh@paytm',
      utr: 'RRN9123456789',
      txnId: 'WEB-SCRAPE-001',
      status: 'SUCCESS',
      matched: true,  // LINKED
      rawEventId: null,  // No RawEvent (web scraper)
      scrapedAt: getTimestampForToday(5, 0),
    });
    transactions.push(web1Txn);
    console.log(`   Type: Web Scraper  |  Status: Linked ✓  |  Source: Paytm Dashboard`);

    // ========================================================================
    // Summary
    // ========================================================================
    console.log('\n' + '='.repeat(70));
    console.log('✅ TEST DATA CREATED SUCCESSFULLY');
    console.log('='.repeat(70));
    console.log(`\n📊 Summary:`);
    console.log(`   • Device: ${device.deviceName}`);
    console.log(`   • Trader ID: ${TRADER_ID}`);
    console.log(`   • Transactions created: ${transactions.length}`);
    console.log(`   • Capture types: 2 Notifications, 2 SMS, 1 Web Scraper`);
    console.log(`   • Linked: 3  |  Process: 2`);
    console.log(`   • Total amount: ₹${transactions.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0).toLocaleString('en-IN')}`);

    console.log('\n' + '🧪 TEST DATA MARKERS:');
    console.log('   All transactions contain "Test" or "Demo" in device name for easy cleanup.');
    console.log('   Query to delete: db.transactions.deleteMany({ traderId: 1, "rawEventId": { $exists: true, "$in": [null, ...] } })');

    console.log('\n' + '📋 NEXT STEPS:');
    console.log('   1. Start ngo-backend:     cd ngo-backend && npm start');
    console.log('   2. Start trader frontend: cd frontend/trader && npm run dev');
    console.log('   3. Navigate to:           http://localhost:5173/notifications');
    console.log('   4. Verify all 5 rows display in the table');
    console.log('   5. Check: column widths, content truncation, badge styling');
    console.log('   6. Click info icons to verify tooltips work');
    console.log('   7. Test filters: by method (GPay, Paytm), by amount');
    console.log('   8. Browser console should show ZERO errors ✓');

    console.log('\n' + '🧹 CLEANUP:');
    console.log(`   To remove test data, delete transactions with txnId starting:`);
    transactions.forEach(t => console.log(`      - ${t.txnId}`));
    console.log(`   Or delete all by device: db.devices.deleteOne({ deviceId: "${DEVICE_ID}" })`);

    console.log('\n' + '='.repeat(70) + '\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

main();
