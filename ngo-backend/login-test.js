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

  console.log('Email:', email);

  const browser = await chromium.launch({
    headless: false,
    slowMo: 50
  });

  const page = await browser.newPage();

  console.log('Opening login page...');
  await page.goto(
    'https://dashboard.paytm.com/login',
    {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    }
  );

  // Wait for iframe to load
  console.log('Waiting for iframe...');
  await page.waitForTimeout(6000);

  // Get the login iframe
  const frames = page.frames();
  let loginFrame = null;

  for (const frame of frames) {
    if (frame.url().includes('accounts.paytm.com')) {
      loginFrame = frame;
      console.log('Found login iframe!', frame.url());
      break;
    }
  }

  if (!loginFrame) {
    console.log('Login iframe not found!');
    await page.waitForTimeout(30000);
    await browser.close();
    process.exit();
  }

  // Fill email in iframe
  console.log('Filling email...');
  await loginFrame.waitForSelector(
    '#email_mobile_login',
    { timeout: 10000 }
  );
  await loginFrame.click('#email_mobile_login');
  await page.waitForTimeout(1000);
  await loginFrame.type(
    '#email_mobile_login',
    email,
    { delay: 150 }
  );
  console.log('Email typed!');
  await page.waitForTimeout(2000);

  // Fill password in iframe
  console.log('Filling password...');
  await loginFrame.click('#password_login');
  await page.waitForTimeout(1000);
  await loginFrame.type(
    '#password_login',
    password,
    { delay: 120 }
  );
  console.log('Password typed!');
  await page.waitForTimeout(2000);

  // Click Sign in Securely in iframe
  console.log('Clicking Sign in Securely...');
  const signInBtn = await loginFrame.$(
    'button:has-text("Sign in Securely")'
  );

  if (signInBtn) {
    await signInBtn.click();
    console.log('Clicked!');
  } else {
    await loginFrame.press(
      '#password_login', 'Enter'
    );
    console.log('Pressed Enter!');
  }

  await page.waitForTimeout(6000);
  console.log('After login URL:', page.url());

  // Check for OTP
  const frames2 = page.frames();
  for (const frame of frames2) {
    try {
      const bodyText = await frame.innerText('body');
      if (
        bodyText.toLowerCase().includes('otp') ||
        bodyText.toLowerCase().includes('one time')
      ) {
        console.log('⚠️ OTP REQUIRED!');
        console.log('Check your phone for OTP!');
        console.log('Waiting 3 minutes...');
        await page.waitForTimeout(180000);
        break;
      }
    } catch(e) {}
  }

  const finalUrl = page.url();
  console.log('Final URL:', finalUrl);

  if (!finalUrl.includes('login')) {
    console.log('✅ LOGGED IN SUCCESSFULLY!');
    await page.waitForTimeout(3000);

    // Try transactions page
    await page.goto(
      'https://dashboard.paytm.com/next/transactions',
      {
        waitUntil: 'domcontentloaded',
        timeout: 15000
      }
    );
    await page.waitForTimeout(3000);
    console.log('Transactions URL:', page.url());
  }

  console.log('Browser open 2 minutes...');
  await page.waitForTimeout(120000);

  await browser.close();
  process.exit();
});