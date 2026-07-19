const fs = require('fs');

const newCode = `const { chromium } = require('playwright');
const { decrypt } = require('../utils/encryption');
const SessionStore = require('./SessionStore');
const Transaction = require('../models/Transaction');
const Account = require('../models/Account');
const path = require('path');

async function initiateLogin(account, io) {
  const accountId = account._id.toString();
  const ngoId = account.ngoId.toString();

  try {
    const email = decrypt(account.encryptedLoginEmail);
    const password = decrypt(account.encryptedLoginPassword);

    SessionStore.setSession(accountId, { status: 'connecting' });
    emitStatus(io, ngoId, accountId, 'connecting', 'Connecting...');

    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });

    // Load saved session if exists
    const sessionFile = path.join(__dirname, '../../paytm-session.json');
    if (require('fs').existsSync(sessionFile)) {
      const saved = JSON.parse(require('fs').readFileSync(sessionFile, 'utf8'));
      await context.addCookies(saved.cookies);
      console.log('Loaded saved session cookies:', saved.cookies.length);
    }

    const page = await context.newPage();

    // Test if session works
    await page.goto('https://dashboard.paytm.com/next/transactions', {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });
    await page.waitForTimeout(3000);

    const url = page.url();

    // Check for lock screen
    const content = await page.content();
    const isLocked = content.includes('Dashboard Locked') || 
                     content.includes('logged out due to inactivity');

    if (isLocked) {
      console.log('Dashboard locked, unlocking...');
      const loginBtn = await page.$('button:has-text("Login again")');
      if (loginBtn) {
        await loginBtn.click();
        await page.waitForTimeout(3000);
      }
      // Find password field in iframe
      const frames = page.frames();
      for (const frame of frames) {
        if (frame.url().includes('accounts.paytm.com')) {
          const passField = await frame.$('#password_login');
          if (passField) {
            await passField.fill(password);
            await page.waitForTimeout(500);
            await frame.click('button:has-text("Sign in Securely")');
            await page.waitForTimeout(3000);
          }
          break;
        }
      }
    }

    if (!url.includes('login') && !isLocked) {
      // Already logged in!
      await onLoginSuccess(accountId, account, browser, page, context, io);
      return { success: true, needsOTP: false, message: 'Connected!' };
    }

    if (url.includes('login')) {
      // Need fresh login
      await page.goto('https://dashboard.paytm.com/login', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      await page.waitForTimeout(6000);

      const frames = page.frames();
      let loginFrame = null;
      for (const frame of frames) {
        if (frame.url().includes('accounts.paytm.com')) {
          loginFrame = frame;
          break;
        }
      }

      if (!loginFrame) throw new Error('Login iframe not found');

      await loginFrame.waitForSelector('#email_mobile_login');
      await loginFrame.click('#email_mobile_login');
      await page.waitForTimeout(800);
      await loginFrame.type('#email_mobile_login', email, { delay: 120 });
      await page.waitForTimeout(1500);

      await loginFrame.click('#password_login');
      await page.waitForTimeout(800);
      await loginFrame.type('#password_login', password, { delay: 100 });
      await page.waitForTimeout(1500);

      const signInBtn = await loginFrame.$('button:has-text("Sign in Securely")');
      if (signInBtn) await signInBtn.click();
      await page.waitForTimeout(5000);

      // Check OTP
      const frames2 = page.frames();
      for (const frame of frames2) {
        try {
          const c = await frame.content();
          if (c.includes('Enter OTP')) {
            SessionStore.setSession(accountId, { browser, page, context, status: 'otp_required' });
            emitStatus(io, ngoId, accountId, 'otp_required', 'OTP sent to your phone.');
            await Account.findByIdAndUpdate(accountId, { status: 'paused' });
            return { success: true, needsOTP: true, message: 'OTP sent to phone' };
          }
        } catch(e) {}
      }

      const finalUrl = page.url();
      if (!finalUrl.includes('login')) {
        await onLoginSuccess(accountId, account, browser, page, context, io);
        return { success: true, needsOTP: false, message: 'Connected!' };
      }

      throw new Error('Login failed');
    }

    // After unlock success
    await onLoginSuccess(accountId, account, browser, page, context, io);
    return { success: true, needsOTP: false, message: 'Connected!' };

  } catch (err) {
    SessionStore.removeSession(accountId);
    emitStatus(io, ngoId, accountId, 'error', err.message);
    throw err;
  }
}

async function submitOTP(account, otp, io) {
  const accountId = account._id.toString();
  const ngoId = account.ngoId.toString();
  const session = SessionStore.getSession(accountId);

  if (!session || session.status !== 'otp_required') {
    throw new Error('No pending OTP session. Please reconnect.');
  }

  const { browser, page, context } = session;

  try {
    const frames = page.frames();
    let otpFrame = page;

    for (const frame of frames) {
      try {
        const c = await frame.content();
        if (c.includes('Enter OTP')) {
          otpFrame = frame;
          break;
        }
      } catch(e) {}
    }

    const otpInput = await otpFrame.waitForSelector(
      'input[placeholder*="OTP"], input[placeholder*="otp"]',
      { timeout: 5000 }
    );
    await otpInput.fill(otp.toString());
    await page.waitForTimeout(500);

    const verifyBtn = await otpFrame.$('button:has-text("Verify")');
    if (verifyBtn) await verifyBtn.click();
    else await otpInput.press('Enter');

    await page.waitForTimeout(5000);

    const url = page.url();
    if (!url.includes('login')) {
      await onLoginSuccess(accountId, account, browser, page, context, io);
      return { success: true, message: 'Connected!' };
    }

    throw new Error('Invalid OTP. Try again.');
  } catch (err) {
    emitStatus(io, ngoId, accountId, 'otp_error', err.message);
    throw err;
  }
}

async function onLoginSuccess(accountId, account, browser, page, context, io) {
  const ngoId = account.ngoId.toString();

  // Close location popup
  try {
    const denyBtn = await page.$('button:has-text("Deny")');
    if (denyBtn) await denyBtn.click();
  } catch(e) {}

  // Save cookies
  const cookies = await context.cookies();
  const sessionFile = require('path').join(__dirname, '../../paytm-session.json');
  require('fs').writeFileSync(sessionFile, JSON.stringify({ cookies, savedAt: new Date().toISOString() }, null, 2));
  console.log('Session cookies saved:', cookies.length);

  SessionStore.setSession(accountId, {
    browser, page, context, status: 'active', loginTime: new Date()
  });

  await Account.findByIdAndUpdate(accountId, {
    status: 'live',
    lastSyncTime: new Date()
  });

  emitStatus(io, ngoId, accountId, 'active', 'Connected! Monitoring...');

  await fetchAndSaveTransactions(account, page, io);
  startMonitoring(accountId, account, io);
  console.log('Active:', account.displayName);
}

async function fetchAndSaveTransactions(account, page, io) {
  try {
    console.log('Fetching transactions...');

    // Navigate to transactions page
    await page.goto('https://dashboard.paytm.com/next/transactions', {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });
    await page.waitForTimeout(3000);

    // Use the real API endpoint we discovered!
    const transactions = await page.evaluate(async () => {
      try {
        const res = await fetch(
          'https://dashboard.paytm.com/api/v3/order/list',
          {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify({
              pageSize: 20,
              pageNumber: 1
            })
          }
        );
        const data = await res.json();
        console.log('API response:', JSON.stringify(data).slice(0, 200));
        return data;
      } catch(e) {
        return { error: e.message };
      }
    });

    console.log('Transactions response:', 
      JSON.stringify(transactions).slice(0, 500)
    );

    // Parse transactions
    const txnList = transactions.orderList || 
                    transactions.orders || 
                    transactions.data || 
                    transactions.list || 
                    [];

    console.log('Transactions found:', txnList.length);

    let newCount = 0;
    for (const txn of txnList) {
      const amount = (txn.txnAmount || txn.amount || txn.totalAmount || '0').toString();
      const utr = (txn.bankTxnId || txn.utr || txn.rrn || txn.referenceNo || '').toString();
      const txnId = (txn.orderId || txn.txnId || txn.transactionId || '').toString();
      const status = (txn.txnStatus === 'TXN_SUCCESS' || 
                     txn.txnStatus === 'SUCCESS' ||
                     txn.status === 'SUCCESS') ? 'SUCCESS' : 'PENDING';
      const payerName = txn.customerName || txn.payerName || txn.name || 'Unknown';
      const upiId = txn.payerVpa || txn.upiId || txn.vpa || '';

      if (utr) {
        const exists = await Transaction.findOne({ utr, ngoId: account.ngoId });
        if (exists) continue;
      }

      await Transaction.create({
        ngoId: account.ngoId,
        accountId: account._id,
        platform: account.platform,
        amount, utr, txnId, status,
        payerName, payerUpiId: upiId,
        paymentMode: txn.paymentMode || 'UPI',
        scrapedAt: new Date()
      });

      newCount++;
      console.log('New: Rs.' + amount + ' from ' + payerName);
    }

    await Account.findByIdAndUpdate(account._id, { lastSyncTime: new Date() });

    if (newCount > 0 && io) {
      io.to(account.ngoId.toString()).emit('new-transactions', { count: newCount });
    }

    return newCount;
  } catch(err) {
    console.error('Fetch error:', err.message);
    return 0;
  }
}

function startMonitoring(accountId, account, io) {
  const interval = setInterval(async () => {
    try {
      const alive = await SessionStore.isSessionAlive(accountId);
      if (!alive) {
        clearInterval(interval);
        SessionStore.removeSession(accountId);
        await Account.findByIdAndUpdate(accountId, { status: 'paused' });
        emitStatus(io, account.ngoId.toString(), accountId, 'session_expired', 'Session expired. Please reconnect.');
        return;
      }
      const session = SessionStore.getSession(accountId);
      if (session && session.page) {
        await fetchAndSaveTransactions(account, session.page, io);
      }
    } catch(err) { console.error('Monitor error:', err.message); }
  }, 60000);

  const session = SessionStore.getSession(accountId);
  if (session) {
    session.monitorInterval = interval;
    SessionStore.setSession(accountId, session);
  }
}

function emitStatus(io, ngoId, accountId, status, message) {
  if (io) { io.to(ngoId).emit('account-status', { accountId, status, message }); }
  console.log('[' + status + '] ' + message);
}

module.exports = { initiateLogin, submitOTP, fetchAndSaveTransactions };
`;

fs.writeFileSync('./src/services/webScraper.js', newCode);
console.log('webScraper.js updated!');
console.log('Functions check:');
delete require.cache[require.resolve('./src/services/webScraper')];
const w = require('./src/services/webScraper');
console.log('Exported:', Object.keys(w));