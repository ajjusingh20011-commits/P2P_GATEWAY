require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');

mongoose.connect(process.env.MONGODB_URL)
.then(async () => {
  const { chromium } = require('playwright');
  const Account = require('./src/models/Account');

  const account = await Account.findById(
    '6a4e7ce9e889fc673773be48'
  );

  const browser = await chromium.launch({
    headless: false
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
  });

  // Load saved cookies
  const sessionFile = './paytm-session.json';
  if (fs.existsSync(sessionFile)) {
    const saved = JSON.parse(
      fs.readFileSync(sessionFile, 'utf8')
    );
    await context.addCookies(saved.cookies);
  }

  const page = await context.newPage();

  // Intercept ALL requests to find date format
  page.on('request', request => {
    const url = request.url();
    if (url.includes('order/list') || 
        url.includes('txn/list') ||
        url.includes('transaction')) {
      console.log('\n🔍 REQUEST FOUND!');
      console.log('URL:', url);
      console.log('Method:', request.method());
      try {
        const body = request.postData();
        if (body) {
          console.log('BODY:', body);
        }
      } catch(e) {}
    }
  });

  page.on('response', async response => {
    const url = response.url();
    if (url.includes('order/list') || 
        url.includes('txn/list') ||
        url.includes('transaction')) {
      console.log('\n✅ RESPONSE FOUND!');
      console.log('URL:', url);
      try {
        const text = await response.text();
        console.log('DATA:', text.slice(0, 1000));
        fs.writeFileSync('paytm-api-response.txt', 
          url + '\n' + text
        );
      } catch(e) {}
    }
  });

  await page.goto(
    'https://dashboard.paytm.com/next/transactions',
    { waitUntil: 'domcontentloaded', timeout: 15000 }
  );
  await page.waitForTimeout(5000);

  console.log('URL:', page.url());
  console.log('\nWaiting for page to load...');
  console.log('Watch for REQUEST FOUND and RESPONSE FOUND!');
  console.log('Browser open 3 minutes...');

  await page.waitForTimeout(180000);
  await browser.close();
  process.exit();
});