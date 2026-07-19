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
  const password = decrypt(
    account.encryptedLoginPassword
  );

  const browser = await chromium.launch({
    headless: false
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0;' +
      ' Win64; x64) AppleWebKit/537.36'
  });

  const page = await context.newPage();

  // Check if saved session exists
  const sessionFile = './paytm-session.json';
  
  if (fs.existsSync(sessionFile)) {
    console.log('Found saved session! Trying...');
    const saved = JSON.parse(
      fs.readFileSync(sessionFile, 'utf8')
    );
    await context.addCookies(saved.cookies);
    
    // Test if session still works
    await page.goto(
      'https://dashboard.paytm.com/next/home',
      { waitUntil: 'domcontentloaded', timeout: 15000 }
    );
    await page.waitForTimeout(3000);
    
    if (!page.url().includes('login')) {
      console.log('✅ Session restored!');
      console.log('URL:', page.url());
      
      // Capture network calls
      page.on('response', async response => {
        const url = response.url();
        if (
          url.includes('paytm.com') &&
          !url.includes('.js') &&
          !url.includes('.css') &&
          !url.includes('.png') &&
          !url.includes('.svg') &&
          !url.includes('.gif') &&
          !url.includes('facebook') &&
          !url.includes('google') &&
          !url.includes('akam')
        ) {
          console.log('[' + response.status() + ']', url);
          if (
            url.includes('txn') ||
            url.includes('transaction') ||
            url.includes('payment') ||
            url.includes('report')
          ) {
            try {
              const text = await response.text();
              console.log('DATA:', text.slice(0, 500));
              fs.appendFileSync(
                'api-responses.txt',
                url + '\n' + text + '\n\n'
              );
            } catch(e) {}
          }
        }
      });

      console.log('\nBrowser open 5 minutes');
      console.log('Click Payments in sidebar!');
      console.log('Watch terminal for API calls!');
      await page.waitForTimeout(300000);
      await browser.close();
      process.exit();
    }
    
    console.log('Session expired, logging in again...');
  }

  // Fresh login
  console.log('Logging in fresh...');
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
      break;
    }
  }

  if (!loginFrame) {
    console.log('Login iframe not found!');
    await page.waitForTimeout(60000);
    await browser.close();
    process.exit();
  }

  // Fill credentials
  await loginFrame.waitForSelector(
    '#email_mobile_login'
  );
  await loginFrame.click('#email_mobile_login');
  await page.waitForTimeout(800);
  await loginFrame.type(
    '#email_mobile_login', email, { delay: 120 }
  );
  await page.waitForTimeout(1500);

  await loginFrame.click('#password_login');
  await page.waitForTimeout(800);
  await loginFrame.type(
    '#password_login', password, { delay: 100 }
  );
  await page.waitForTimeout(1500);

  const signInBtn = await loginFrame.$(
    'button:has-text("Sign in Securely")'
  );
  if (signInBtn) await signInBtn.click();
  
  await page.waitForTimeout(5000);

  // Check OTP
  const frames2 = page.frames();
  for (const frame of frames2) {
    try {
      const content = await frame.content();
      if (content.includes('Enter OTP')) {
        console.log('⚠️ OTP Required!');
        console.log('Enter OTP in browser!');
        console.log('Waiting 3 minutes...');
        await page.waitForTimeout(180000);
        break;
      }
    } catch(e) {}
  }

  // Close location popup
  try {
    const denyBtn = await page.$(
      'button:has-text("Deny")'
    );
    if (denyBtn) {
      await denyBtn.click();
      await page.waitForTimeout(1000);
    }
  } catch(e) {}

  const finalUrl = page.url();
  console.log('Final URL:', finalUrl);

  if (!finalUrl.includes('login')) {
    console.log('✅ Logged in successfully!');

    // Save session cookies
    const cookies = await context.cookies();
    const sessionData = {
      cookies,
      savedAt: new Date().toISOString(),
      accountId: account._id.toString(),
      email: email
    };
    fs.writeFileSync(
      sessionFile,
      JSON.stringify(sessionData, null, 2)
    );
    console.log('✅ Session saved to paytm-session.json!');
    console.log('Cookies saved:', cookies.length);

    // Now capture network calls
    page.on('response', async response => {
      const url = response.url();
      if (
        url.includes('paytm.com') &&
        !url.includes('.js') &&
        !url.includes('.css') &&
        !url.includes('.png') &&
        !url.includes('.svg') &&
        !url.includes('.gif') &&
        !url.includes('facebook') &&
        !url.includes('google') &&
        !url.includes('akam')
      ) {
        console.log('[' + response.status() + ']', url);
        if (
          url.includes('txn') ||
          url.includes('transaction') ||
          url.includes('payment') ||
          url.includes('report')
        ) {
          try {
            const text = await response.text();
            console.log('DATA:', text.slice(0, 500));
            fs.appendFileSync(
              'api-responses.txt',
              url + '\n' + text + '\n\n'
            );
          } catch(e) {}
        }
      }
    });

    console.log('\n=== NOW DO THIS ===');
    console.log('1. Click "Payments" in left sidebar');
    console.log('2. Click any transaction row');
    console.log('3. Watch terminal for API calls!');
    console.log('Browser open 5 minutes...');
    await page.waitForTimeout(300000);
  }

  await browser.close();
  process.exit();
});