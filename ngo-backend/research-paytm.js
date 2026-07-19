require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');

mongoose.connect(process.env.MONGODB_URL)
.then(async () => {
  const { chromium } = require('playwright');
  const { decrypt } = require('./src/utils/encryption');
  const Account = require('./src/models/Account');

  const account = await Account.findById(
    '6a4e7ce9e889fc673773be48'
  );

  const email = decrypt(account.encryptedLoginEmail);
  const password = decrypt(account.encryptedLoginPassword);

  const results = {
    loginIframe: null,
    otpIframe: null,
    homeUrl: null,
    transactionsUrl: null,
    transactionDetailUrl: null,
    apiCalls: [],
    transactionData: null,
    cookies: null,
    allUrls: []
  };

  const browser = await chromium.launch({
    headless: false,
    slowMo: 50
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0;' +
      ' Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0' +
      ' Safari/537.36'
  });

  const page = await context.newPage();

  // Capture ALL API responses
  page.on('response', async response => {
    const url = response.url();
    const status = response.status();

    if (
      url.includes('paytm.com') &&
      !url.includes('.js') &&
      !url.includes('.css') &&
      !url.includes('.png') &&
      !url.includes('.svg') &&
      !url.includes('.webp') &&
      !url.includes('.gif') &&
      !url.includes('facebook') &&
      !url.includes('google') &&
      !url.includes('akamai') &&
      !url.includes('akam') &&
      !url.includes('analytics')
    ) {
      results.allUrls.push({
        status,
        url,
        method: response.request().method()
      });

      if (
        url.includes('txn') ||
        url.includes('transaction') ||
        url.includes('payment') ||
        url.includes('report') ||
        url.includes('order') ||
        url.includes('settlement')
      ) {
        try {
          const text = await response.text();
          results.apiCalls.push({
            url,
            status,
            body: text.slice(0, 2000)
          });
          console.log(`\n📡 API FOUND [${status}]: ${url}`);
          console.log('DATA:', text.slice(0, 300));

          if (text.includes('amount') ||
              text.includes('txnId') ||
              text.includes('transaction')) {
            results.transactionData = {
              url,
              data: text.slice(0, 3000)
            };
            console.log('✅ TRANSACTION DATA FOUND!');
          }
        } catch(e) {}
      }
    }
  });

  // STEP 1 - Login
  console.log('\n=== STEP 1: LOGIN ===');
  await page.goto(
    'https://dashboard.paytm.com/login',
    { waitUntil: 'domcontentloaded', timeout: 30000 }
  );
  await page.waitForTimeout(6000);

  // Find login iframe
  const frames = page.frames();
  let loginFrame = null;
  for (const frame of frames) {
    if (frame.url().includes('accounts.paytm.com')) {
      loginFrame = frame;
      results.loginIframe = {
        url: frame.url(),
        inputIds: ['email_mobile_login', 'password_login']
      };
      console.log('✅ Login iframe:', frame.url());
      break;
    }
  }

  if (!loginFrame) {
    console.log('❌ Login iframe not found!');
    await page.waitForTimeout(60000);
    await browser.close();
    process.exit();
  }

  // Fill credentials
  await loginFrame.waitForSelector('#email_mobile_login');
  await loginFrame.click('#email_mobile_login');
  await page.waitForTimeout(800);
  await loginFrame.type('#email_mobile_login', email, { delay: 120 });
  await page.waitForTimeout(1500);

  await loginFrame.click('#password_login');
  await page.waitForTimeout(800);
  await loginFrame.type('#password_login', password, { delay: 100 });
  await page.waitForTimeout(1500);

  const signInBtn = await loginFrame.$(
    'button:has-text("Sign in Securely")'
  );
  if (signInBtn) {
    await signInBtn.click();
    console.log('✅ Clicked Sign in Securely');
  }
  await page.waitForTimeout(5000);

  // STEP 2 - Check OTP
  console.log('\n=== STEP 2: CHECK OTP ===');
  const frames2 = page.frames();
  let otpNeeded = false;

  for (const frame of frames2) {
    try {
      const content = await frame.content();
      if (
        content.includes('Enter OTP') ||
        content.includes('Sent to your mobile')
      ) {
        otpNeeded = true;
        results.otpIframe = {
          url: frame.url(),
          inputSelector: 'input[placeholder*="OTP"]',
          buttonSelector: 'button:has-text("Verify")'
        };
        console.log('⚠️ OTP Required!');
        console.log('OTP iframe:', frame.url());
        console.log('Check your phone for OTP!');
        break;
      }
    } catch(e) {}
  }

  if (otpNeeded) {
    console.log('Waiting 3 minutes for OTP entry...');
    await page.waitForTimeout(180000);
  }

  // STEP 3 - Home page
  console.log('\n=== STEP 3: HOME PAGE ===');
  await page.waitForTimeout(3000);
  results.homeUrl = page.url();
  console.log('Home URL:', results.homeUrl);

  // Close location popup if exists
  try {
    const denyBtn = await page.$(
      'button:has-text("Deny")'
    );
    if (denyBtn) {
      await denyBtn.click();
      console.log('✅ Closed location popup');
      await page.waitForTimeout(1000);
    }
  } catch(e) {}

  // Save cookies
  results.cookies = await context.cookies();
  console.log('✅ Cookies saved:', results.cookies.length);

  // STEP 4 - Transactions page
  console.log('\n=== STEP 4: TRANSACTIONS PAGE ===');
  await page.goto(
    'https://dashboard.paytm.com/next/transactions',
    { waitUntil: 'domcontentloaded', timeout: 15000 }
  );
  await page.waitForTimeout(5000);
  results.transactionsUrl = page.url();
  console.log('Transactions URL:', results.transactionsUrl);

  // STEP 5 - Try clicking first transaction
  console.log('\n=== STEP 5: TRANSACTION DETAIL ===');
  try {
    const txnRow = await page.$(
      'tr:nth-child(2), .txn-row, [class*="transaction-row"]'
    );
    if (txnRow) {
      await txnRow.click();
      await page.waitForTimeout(3000);
      results.transactionDetailUrl = page.url();
      console.log('Transaction Detail URL:', results.transactionDetailUrl);
    } else {
      console.log('No transaction rows found to click');
    }
  } catch(e) {
    console.log('Could not click transaction:', e.message);
  }

  // STEP 6 - Try Reports page
  console.log('\n=== STEP 6: REPORTS PAGE ===');
  await page.goto(
    'https://dashboard.paytm.com/next/reports',
    { waitUntil: 'domcontentloaded', timeout: 15000 }
  ).catch(() => {});
  await page.waitForTimeout(3000);
  console.log('Reports URL:', page.url());

  // STEP 7 - Try Payments page
  console.log('\n=== STEP 7: PAYMENTS PAGE ===');
  await page.goto(
    'https://dashboard.paytm.com/next/payments',
    { waitUntil: 'domcontentloaded', timeout: 15000 }
  ).catch(() => {});
  await page.waitForTimeout(3000);
  console.log('Payments URL:', page.url());

  // Save all results
  const output = JSON.stringify(results, null, 2);
  fs.writeFileSync('paytm-research.json', output);
  console.log('\n✅ Results saved to paytm-research.json');

  console.log('\n=== SUMMARY ===');
  console.log('Login iframe:', results.loginIframe?.url);
  console.log('OTP iframe:', results.otpIframe?.url);
  console.log('Home URL:', results.homeUrl);
  console.log('Transactions URL:', results.transactionsUrl);
  console.log('API calls found:', results.apiCalls.length);
  console.log('Transaction data:', results.transactionData ? 'YES!' : 'No');
  console.log('Cookies:', results.cookies?.length);

  console.log('\nBrowser stays open 3 minutes');
  console.log('Click around to find more APIs!');
  await page.waitForTimeout(180000);

  await browser.close();

  // Save final results
  fs.writeFileSync(
    'paytm-research.json',
    JSON.stringify(results, null, 2)
  );
  console.log('Final results saved!');
  process.exit();
});