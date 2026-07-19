require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URL)
.then(async () => {
  const { chromium } = require('playwright');
  const { decrypt } = require('./src/utils/encryption');
  const Account = require('./src/models/Account');

  const account = await Account.findById(
    '6a4e7ce9e889fc673773be48'
  );

  const email = decrypt(account.encryptedLoginEmail);
  const password = decrypt(
    account.encryptedLoginPassword
  );

  console.log('Account:', account.displayName);
  console.log('Starting human-like login...');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 100
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0;' +
      ' Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0' +
      ' Safari/537.36'
  });

  const page = await context.newPage();

  // STEP 1 - Open login page
  console.log('Opening login page...');
  await page.goto(
    'https://dashboard.paytm.com/login',
    { waitUntil: 'domcontentloaded', timeout: 30000 }
  );

  // Wait like human reads the page
  await page.waitForTimeout(2000);
  console.log('Page loaded:', page.url());

  // STEP 2 - Click on email field
  console.log('Clicking email field...');
  const emailInput = await page.waitForSelector(
    'input[placeholder*="Mobile"],' +
    'input[placeholder*="Email"],' +
    'input[type="text"]',
    { timeout: 10000 }
  );
  await emailInput.click();
  await page.waitForTimeout(500);

  // Type email like human - one char at a time
  console.log('Typing email...');
  await emailInput.type(email, { delay: 120 });

  // Human pause after typing email
  await page.waitForTimeout(1500);

  // STEP 3 - Click password field
  console.log('Clicking password field...');
  const passInput = await page.waitForSelector(
    'input[type="password"]',
    { timeout: 10000 }
  );
  await passInput.click();
  await page.waitForTimeout(500);

  // Type password like human
  console.log('Typing password...');
  await passInput.type(password, { delay: 100 });

  // Human pause before clicking button
  await page.waitForTimeout(2000);

  // STEP 4 - Click Sign in Securely button
  console.log('Clicking Sign in Securely...');
  const signInBtn = await page.waitForSelector(
    'button:has-text("Sign in Securely")',
    { timeout: 10000 }
  );
  await signInBtn.click();

  // Wait for page to respond
  await page.waitForTimeout(5000);

  console.log('After click URL:', page.url());

  // STEP 5 - Check what happened
  const currentUrl = page.url();
  const bodyText = await page.innerText('body')
    .catch(() => '');

  if (
    bodyText.toLowerCase().includes('otp') ||
    bodyText.toLowerCase().includes('one time') ||
    bodyText.toLowerCase().includes('verify')
  ) {
    console.log('\n⚠️ OTP PAGE DETECTED!');
    console.log('Check your phone for OTP SMS!');
    console.log('Browser staying open...');
    console.log('We will handle OTP next step.');
    await page.waitForTimeout(120000);
  } else if (
    currentUrl.includes('next') ||
    currentUrl.includes('home') ||
    !currentUrl.includes('login')
  ) {
    console.log('\n✅ LOGIN SUCCESSFUL!');
    console.log('Dashboard URL:', currentUrl);
    await page.waitForTimeout(3000);

    // Now find transactions
    console.log('\nLooking for transactions...');
    await page.goto(
      'https://dashboard.paytm.com/next/transactions',
      { waitUntil: 'domcontentloaded', timeout: 15000 }
    );
    await page.waitForTimeout(3000);
    console.log('Transactions URL:', page.url());
  } else {
    console.log('\nStill on:', currentUrl);
    console.log('Page text:', bodyText.slice(0, 300));
  }

  console.log('\nBrowser open for 2 minutes.');
  console.log('Explore the dashboard manually!');
  await page.waitForTimeout(120000);

  await browser.close();
  process.exit();
});
