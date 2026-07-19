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
    headless: true
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
  });

  const saved = JSON.parse(
    fs.readFileSync('./paytm-session.json', 'utf8')
  );
  await context.addCookies(saved.cookies);

  const page = await context.newPage();

  await page.goto(
    'https://dashboard.paytm.com/next/transactions',
    { waitUntil: 'domcontentloaded', timeout: 15000 }
  );
  await page.waitForTimeout(3000);

  // Try many different formats and endpoints
  const result = await page.evaluate(async () => {
    const results = {};

    // Get XSRF token
    const xsrfToken = document.cookie
      .split(';')
      .map(c => c.trim())
      .find(c => c.startsWith('XSRF-TOKEN='))
      ?.split('=').slice(1).join('=') || '';

    const token = decodeURIComponent(xsrfToken);
    results.token = token ? 'found' : 'missing';
    results.allCookies = document.cookie
      .split(';')
      .map(c => c.trim().split('=')[0]);

    // Date formats to try
    const now = new Date();
    const week = new Date(Date.now() - 7*24*60*60*1000);

    const formats = {
      f1: {
        start: week.toLocaleDateString('en-CA') + ' 00:00:00',
        end: now.toLocaleDateString('en-CA') + ' 23:59:59'
      },
      f2: {
        start: week.getFullYear() + '-' + 
          String(week.getMonth()+1).padStart(2,'0') + '-' +
          String(week.getDate()).padStart(2,'0') + ' 00:00:00',
        end: now.getFullYear() + '-' +
          String(now.getMonth()+1).padStart(2,'0') + '-' +
          String(now.getDate()).padStart(2,'0') + ' 23:59:59'
      }
    };

    results.format1 = formats.f1;
    results.format2 = formats.f2;

    // Try endpoint with format 2
    try {
      const res = await fetch(
        'https://dashboard.paytm.com/api/v3/order/list',
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-XSRF-TOKEN': token,
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: JSON.stringify({
            pageSize: 20,
            pageNum: 1,
            orderCreatedStartTime: formats.f2.start,
            orderCreatedEndTime: formats.f2.end
          })
        }
      );
      results.status2 = res.status;
      results.response2 = await res.text();
    } catch(e) {
      results.error2 = e.message;
    }

    // Try without dates
    try {
      const res = await fetch(
        'https://dashboard.paytm.com/api/v3/order/list',
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-XSRF-TOKEN': token,
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: JSON.stringify({
            pageSize: 20,
            pageNum: 1,
            txnType: 'SALE'
          })
        }
      );
      results.statusNoDate = res.status;
      results.responseNoDate = await res.text();
    } catch(e) {
      results.errorNoDate = e.message;
    }

    // Try v1 endpoint
    try {
      const res = await fetch(
        'https://dashboard.paytm.com/api/v1/txn/list',
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-XSRF-TOKEN': token
          },
          body: JSON.stringify({
            pageSize: 20,
            pageNum: 1
          })
        }
      );
      results.statusV1 = res.status;
      results.responseV1 = await res.text();
    } catch(e) {
      results.errorV1 = e.message;
    }

    return results;
  });

  console.log('Token:', result.token);
  console.log('All cookies:', result.allCookies);
  console.log('\nFormat 1:', result.format1);
  console.log('Format 2:', result.format2);
  console.log('\n--- With dates (format 2) ---');
  console.log('Status:', result.status2);
  console.log('Response:', result.response2?.slice(0, 300));
  console.log('\n--- Without dates ---');
  console.log('Status:', result.statusNoDate);
  console.log('Response:', result.responseNoDate?.slice(0, 300));
  console.log('\n--- V1 endpoint ---');
  console.log('Status:', result.statusV1);
  console.log('Response:', result.responseV1?.slice(0, 300));

  fs.writeFileSync(
    'api-test-results.txt',
    JSON.stringify(result, null, 2)
  );
  console.log('\nSaved to api-test-results.txt');

  await browser.close();
  process.exit();
});
