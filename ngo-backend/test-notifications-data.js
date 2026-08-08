/**
 * Test data generator for Notifications page redesign.
 * Creates sample transactions with all three capture types:
 * 1. APK-sourced SMS capture (with RawEvent.type = 'SMS')
 * 2. APK-sourced Notification capture (with RawEvent.type = 'NOTIFICATION')
 * 3. Web-scraper-sourced transaction (no RawEvent, rawEventId = null)
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

    // 1. Create or get a test Device
    console.log('\n📱 Creating test device...');
    const device = await Device.findOneAndUpdate(
      { deviceId: DEVICE_ID },
      {
        deviceId: DEVICE_ID,
        traderId: TRADER_ID,
        deviceName: 'Test Phone (SMS Capture)',
        deviceModel: 'Test Model',
        androidVersion: '12',
        appVersion: '1.0.0',
        status: 'active',
      },
      { upsert: true, new: true }
    );
    console.log(`  Device created: ${device.deviceId} (${device.deviceName})`);

    // 2. Create APK-SMS RawEvent + Transaction (SMS capture)
    console.log('\n📨 Creating APK-SMS capture...');
    const smsRawEvent = await RawEvent.create({
      deviceId: DEVICE_ID,
      traderId: TRADER_ID,
      type: 'SMS',
      sender: 'HDFC-HDFCBK-T',
      body: 'A/c ending 1234 debited by INR 500. Your ref no. is UPI123456789. Available balance: INR 45,000. For queries contact HDFC Bank.',
      category: 'PAYMENT',
      amount: '500',
      utr: 'UPI123456789',
      utcTimestamp: new Date().toISOString(),
      processed: false,
    });
    const smsTxn = await Transaction.create({
      traderId: TRADER_ID,
      accountId: ACCOUNT_ID,
      platform: 'paytm',
      amount: '500',
      payerName: 'Customer SMS',
      payerUpiId: 'customer@hdfc',
      utr: 'UPI123456789',
      txnId: 'SMS-' + Date.now(),
      status: 'PENDING',
      matched: false,
      rawEventId: smsRawEvent._id,
      scrapedAt: new Date(),
    });
    console.log(`  SMS Transaction: ${smsTxn._id}`);
    console.log(`  - Capture type: SMS`);
    console.log(`  - Status: Process (not matched)`);
    console.log(`  - Original text: "${smsRawEvent.body}"`);

    // 3. Create APK-Notification RawEvent + Transaction (Notification capture)
    console.log('\n🔔 Creating APK-Notification capture...');
    const notifRawEvent = await RawEvent.create({
      deviceId: DEVICE_ID,
      traderId: TRADER_ID,
      type: 'NOTIFICATION',
      sender: 'com.paytm',
      body: 'Payment received from Raj Kumar for ₹1,200. UPI Ref: 1234567890123456. Tap to view details.',
      category: 'PAYMENT',
      amount: '1200',
      utr: '1234567890123456',
      utcTimestamp: new Date().toISOString(),
      processed: false,
    });
    const notifTxn = await Transaction.create({
      traderId: TRADER_ID,
      accountId: ACCOUNT_ID,
      platform: 'phonepe',
      amount: '1200',
      payerName: 'Raj Kumar',
      payerUpiId: 'raj@phonepe',
      utr: '1234567890123456',
      txnId: 'NOTIF-' + Date.now(),
      status: 'SUCCESS',
      matched: true,  // Mark as linked/matched
      rawEventId: notifRawEvent._id,
      scrapedAt: new Date(),
    });
    console.log(`  Notification Transaction: ${notifTxn._id}`);
    console.log(`  - Capture type: Notification`);
    console.log(`  - Status: Linked (matched to an order)`);
    console.log(`  - Original text: "${notifRawEvent.body}"`);

    // 4. Create web-scraper Transaction (no RawEvent)
    console.log('\n🕷️  Creating web-scraper capture...');
    const scraperTxn = await Transaction.create({
      traderId: TRADER_ID,
      accountId: ACCOUNT_ID,
      platform: 'paytm',
      amount: '777',
      payerName: 'Paytm Web Login',
      payerUpiId: 'webaccount@paytm',
      utr: 'RRN9876543210',
      txnId: 'SCRAPER-' + Date.now(),
      status: 'SUCCESS',
      matched: false,
      // rawEventId: null (web scraper, no associated RawEvent)
      rawEventId: null,
      scrapedAt: new Date(),
    });
    console.log(`  Web Scraper Transaction: ${scraperTxn._id}`);
    console.log(`  - Capture type: Web scraper`);
    console.log(`  - Status: Process (not matched)`);
    console.log(`  - Original text: "Payment from Paytm Web Login (webaccount@paytm)"`);

    console.log('\n✅ Test data created successfully!');
    console.log('\nTo test the Notifications page:');
    console.log('1. Start ngo-backend: cd ngo-backend && npm start');
    console.log('2. Start trader frontend: cd frontend/trader && npm run dev');
    console.log('3. Navigate to http://localhost:5173 and go to Notifications');
    console.log('4. You should see three transactions:');
    console.log('   - SMS capture (source: "Test Phone (SMS Capture)", type: SMS, status: Process)');
    console.log('   - Notification capture (source: "Test Phone (SMS Capture)", type: Notification, status: Linked)');
    console.log('   - Web scraper (source: "web", type: Web scraper, status: Process)');
    console.log('\n5. Check browser console for any errors');
    console.log('6. Verify the table displays correctly and info icons reveal IDs on hover');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

main();
