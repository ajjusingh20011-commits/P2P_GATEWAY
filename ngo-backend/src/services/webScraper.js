const { chromium } = require('playwright');
const { decrypt } = require('../utils/encryption');
const SessionStore = require('./SessionStore');
const Transaction = require('../models/Transaction');
const Account = require('../models/Account');
const path = require('path');
const fs = require('fs');

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
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const sessionFile = path.join(
      __dirname, '../../paytm-session.json'
    );
    if (fs.existsSync(sessionFile)) {
      const saved = JSON.parse(
        fs.readFileSync(sessionFile, 'utf8')
      );
      await context.addCookies(saved.cookies);
      console.log('Loaded saved session cookies:',
        saved.cookies.length);
    }
    const page = await context.newPage();
    await page.goto(
      'https://dashboard.paytm.com/next/transactions',
      { waitUntil: 'domcontentloaded', timeout: 15000 }
    );
    await page.waitForTimeout(3000);
    const url = page.url();
    const content = await page.content();
    const isLocked =
      content.includes('Dashboard Locked') ||
      content.includes('logged out due to inactivity');
    if (isLocked) {
      console.log('Dashboard locked, unlocking...');
      try {
        const loginBtn = await page.$(
          'button:has-text("Login again")'
        );
        if (loginBtn) {
          await loginBtn.click();
          await page.waitForTimeout(6000);
        }
        const frames = page.frames();
        for (const frame of frames) {
          if (frame.url().includes('accounts.paytm.com')) {
            const passField = await frame.$('#password_login');
            if (passField) {
              await passField.fill(password);
              await page.waitForTimeout(500);
              const btn = await frame.$(
                'button:has-text("Sign in Securely")'
              );
              if (btn) await btn.click();
              await page.waitForTimeout(3000);
            }
            break;
          }
        }
      } catch(e) {
        console.log('Unlock error:', e.message);
      }
      const newUrl = page.url();
      if (!newUrl.includes('login')) {
        await onLoginSuccess(
          accountId, account, browser, page, context, io
        );
        return {
          success: true,
          needsOTP: false,
          message: 'Unlocked!'
        };
      }
    }
    if (!url.includes('login') && !isLocked) {
      console.log('Session still valid!');
      await onLoginSuccess(
        accountId, account, browser, page, context, io
      );
      return {
        success: true,
        needsOTP: false,
        message: 'Connected!'
      };
    }
    console.log('Starting fresh login...');
    await page.goto(
      'https://dashboard.paytm.com/login',
      { waitUntil: 'domcontentloaded', timeout: 30000 }
    );
    await page.waitForTimeout(10000);
    const frames = page.frames();
    let loginFrame = null;
    for (const frame of frames) {
      if (frame.url().includes('accounts.paytm.com')) {
        loginFrame = frame;
        break;
      }
    }
    if (!loginFrame) {
      throw new Error('Login iframe not found.');
    }
    await loginFrame.waitForSelector(
      '#email_mobile_login', { timeout: 10000 }
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
    else await loginFrame.press('#password_login', 'Enter');
    await page.waitForTimeout(5000);
    const frames2 = page.frames();
    for (const frame of frames2) {
      try {
        const c = await frame.content();
        if (
          c.includes('Enter OTP') ||
          c.includes('Sent to your mobile')
        ) {
          SessionStore.setSession(accountId, {
            browser, page, context,
            status: 'otp_required'
          });
          emitStatus(io, ngoId, accountId,
            'otp_required',
            'OTP sent to your phone.'
          );
          await Account.findByIdAndUpdate(
            accountId, { status: 'paused' }
          );
          return {
            success: true,
            needsOTP: true,
            message: 'OTP sent to phone'
          };
        }
      } catch(e) {}
    }
    const finalUrl = page.url();
    if (!finalUrl.includes('login')) {
      await onLoginSuccess(
        accountId, account, browser, page, context, io
      );
      return {
        success: true,
        needsOTP: false,
        message: 'Connected!'
      };
    }
    throw new Error('Login failed. Check credentials.');
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
    throw new Error(
      'No pending OTP session. Please reconnect.'
    );
  }
  const { browser, page, context } = session;
  try {
    const frames = page.frames();
    let otpFrame = null;
    for (const frame of frames) {
      try {
        const c = await frame.content();
        if (
          c.includes('Enter OTP') ||
          c.includes('Sent to your mobile')
        ) {
          otpFrame = frame;
          break;
        }
      } catch(e) {}
    }
    const targetFrame = otpFrame || page;
    const otpInput = await targetFrame.waitForSelector(
      'input[placeholder*="OTP"], input[maxlength="6"]',
      { timeout: 10000 }
    );
    await otpInput.fill(otp.toString());
    await page.waitForTimeout(500);
    const verifyBtn = await targetFrame.$(
      'button:has-text("Verify"), button:has-text("Submit")'
    );
    if (verifyBtn) await verifyBtn.click();
    else await otpInput.press('Enter');
    await page.waitForTimeout(5000);
    const url = page.url();
    if (!url.includes('login')) {
      await onLoginSuccess(
        accountId, account, browser, page, context, io
      );
      return { success: true, message: 'Connected!' };
    }
    throw new Error('Invalid OTP. Try again.');
  } catch (err) {
    emitStatus(io, ngoId, accountId,
      'otp_error', err.message);
    throw err;
  }
}

async function onLoginSuccess(
  accountId, account, browser, page, context, io
) {
  const ngoId = account.ngoId.toString();
  try {
    await page.waitForTimeout(1000);
    const denyBtn = await page.$('button:has-text("Deny")');
    if (denyBtn) {
      await denyBtn.click();
      await page.waitForTimeout(500);
    }
  } catch(e) {}
  const cookies = await context.cookies();
  const sessionFile = path.join(
    __dirname, '../../paytm-session.json'
  );
  fs.writeFileSync(sessionFile, JSON.stringify({
    cookies,
    savedAt: new Date().toISOString(),
    accountId
  }, null, 2));
  console.log('Session cookies saved:', cookies.length);
  SessionStore.setSession(accountId, {
    browser, page, context,
    status: 'active',
    loginTime: new Date()
  });
  await Account.findByIdAndUpdate(accountId, {
    status: 'live',
    lastSyncTime: new Date()
  });
  emitStatus(io, ngoId, accountId,
    'active', 'Connected! Monitoring transactions...');
  await fetchAndSaveTransactions(account, page, io);
  startMonitoring(accountId, account, io);
  console.log('Active:', account.displayName);
}

async function fetchAndSaveTransactions(account, page, io) {
  try {
    console.log('Fetching transactions...');
    await page.goto(
      'https://dashboard.paytm.com/next/transactions',
      { waitUntil: 'domcontentloaded', timeout: 15000 }
    );
    await page.waitForTimeout(3000);

    const now = new Date();
    const weekAgo = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000
    );
    const toIST = (d) => {
      const ist = new Date(
        d.getTime() + (5.5 * 60 * 60 * 1000)
      );
      return ist.toISOString().slice(0, 19) + '+05:30';
    };

    const startTime = toIST(weekAgo);
    const endTime = toIST(now);

    const result = await page.evaluate(async (params) => {
      const startTime = params.startTime;
      const endTime = params.endTime;
      const cookies = document.cookie.split(';');
      let xsrfToken = '';
      for (const cookie of cookies) {
        const trimmed = cookie.trim();
        if (trimmed.startsWith('XSRF-TOKEN=')) {
          xsrfToken = decodeURIComponent(
            trimmed.split('=').slice(1).join('=')
          );
          break;
        }
      }
      try {
        const res = await fetch(
          'https://dashboard.paytm.com/api/v3/order/list',
          {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'X-XSRF-TOKEN': xsrfToken,
              'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({
              bizTypeList: [
                'ACQUIRING',
                'CASHBACK',
                'SPLIT_PAYMENT'
              ],
              pageSize: 20,
              pageNum: 1,
              isSort: true,
              orderCreatedStartTime: startTime,
              orderCreatedEndTime: endTime,
              orderStatusList: [
                'SUCCESS',
                'PENDING',
                'FAILURE'
              ]
            })
          }
        );
        const text = await res.text();
        return {
          status: res.status,
          text,
          xsrf: xsrfToken
        };
      } catch(e) {
        return { error: e.message };
      }
    }, { startTime, endTime });

    const capturedXsrf = result.xsrf || '';
    console.log('API Status:', result.status);
    console.log('XSRF Token:', capturedXsrf ? 'found' : 'missing');
    console.log('Response:', result.text?.slice(0, 200));

    let txnList = [];
    try {
      const data = JSON.parse(result.text || '{}');
      txnList = data.orderList ||
        data.orders ||
        data.data ||
        data.list || [];
      console.log('Transactions found:', txnList.length);
    } catch(e) {
      console.log('Parse error:', e.message);
    }

    let newCount = 0;
    for (const txn of txnList) {
      const amountRaw = (
        txn.payMoneyAmount?.value ||
        txn.txnAmount ||
        txn.amount ||
        '0'
      ).toString();
      const amountInRupees = (
        parseFloat(amountRaw) / 100
      ).toFixed(2);
      const additionalInfo = txn.additionalInfo || {};
      const bizOrderId = txn.bizOrderId || '';
      const txnId = txn.merchantTransId ||
        txn.bizOrderId || '';
      const status = (
        txn.orderStatus === 'SUCCESS' ||
        txn.txnStatus === 'TXN_SUCCESS'
      ) ? 'SUCCESS' : 'PENDING';
      const payerName = additionalInfo.customerName ||
        txn.nickName || 'Unknown';
      const upiId = additionalInfo.virtualPaymentAddr ||
        txn.payerVpa || '';

      if (bizOrderId) {
        const exists = await Transaction.findOne({
          txnId: bizOrderId,
          ngoId: account.ngoId
        });
        if (exists) continue;
      }

      // Get RRN from detail API
      let rrn = '';
      try {
        const detailResult = await page.evaluate(
          async (params) => {
            const orderId = params.orderId;
            const token = params.token;
            const r = await fetch(
              'https://dashboard.paytm.com/api/v4/order/detail',
              {
                method: 'POST',
                credentials: 'include',
                headers: {
                  'Content-Type': 'application/json',
                  'X-XSRF-TOKEN': token,
                  'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({
                  bizOrderId: orderId,
                  isSettlementInfo: true
                })
              }
            );
            return await r.text();
          },
          { orderId: bizOrderId, token: capturedXsrf }
        );
        const detail = JSON.parse(detailResult);
        rrn = detail?.additionalInfo?.rrn || '';
        console.log('RRN:', rrn);
      } catch(e) {
        console.log('Detail API error:', e.message);
      }

      await Transaction.create({
        ngoId: account.ngoId,
        accountId: account._id,
        platform: account.platform,
        amount: amountInRupees,
        utr: rrn,
        txnId: bizOrderId,
        status,
        payerName,
        payerUpiId: upiId,
        paymentMode: 'UPI',
        scrapedAt: new Date()
      });

      newCount++;
      console.log(
        'New: Rs.' + amountInRupees +
        ' from ' + payerName +
        ' RRN:' + rrn
      );
    }

    await Account.findByIdAndUpdate(
      account._id,
      { lastSyncTime: new Date() }
    );

    if (newCount > 0 && io) {
      io.to(account.ngoId.toString()).emit(
        'new-transactions', { count: newCount }
      );
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
      const alive = await SessionStore
        .isSessionAlive(accountId);
      if (!alive) {
        clearInterval(interval);
        SessionStore.removeSession(accountId);
        await Account.findByIdAndUpdate(
          accountId, { status: 'paused' }
        );
        emitStatus(
          io,
          account.ngoId.toString(),
          accountId,
          'session_expired',
          'Session expired. Please reconnect.'
        );
        return;
      }
      const session = SessionStore.getSession(accountId);
      if (session && session.page) {
        await fetchAndSaveTransactions(
          account, session.page, io
        );
      }
    } catch(err) {
      console.error('Monitor error:', err.message);
    }
  }, 60000);
  const session = SessionStore.getSession(accountId);
  if (session) {
    session.monitorInterval = interval;
    SessionStore.setSession(accountId, session);
  }
}

function emitStatus(io, ngoId, accountId, status, message) {
  if (io) {
    io.to(ngoId).emit('account-status', {
      accountId, status, message
    });
  }
  console.log('[' + status + '] ' + message);
}

module.exports = {
  initiateLogin,
  submitOTP,
  fetchAndSaveTransactions
};