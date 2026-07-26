'use strict';

/**
 * Headed-mode manual test for the real web-login scraper flow — LOCAL USE
 * ONLY. Drives the exact same initiateLogin()/submitOTP() code the server
 * uses (webScraper.js) against an existing web-login Account, in a real,
 * visible Chromium window, so what you watch is the production logic, not a
 * mock. Forces headless off for THIS PROCESS ONLY (SCRAPER_HEADLESS) — the
 * deployed server never sets that var, so its behavior is unaffected.
 *
 * The account must already exist (e.g. saved via the trader panel's "Web
 * Login" form, or POST /api/ngo/accounts with type:"web") — this script
 * reads its encrypted credentials from Mongo; it does not take raw
 * email/password on the CLI.
 *
 * Usage:
 *   node scripts/test-web-login.js <accountId>
 */

process.env.SCRAPER_HEADLESS = 'false';

require('dotenv').config({
  path: process.env.NODE_ENV === 'production' ? '.env' : '.env.local',
});

const readline = require('readline');
const connectDB = require('../src/config/database');
const Account = require('../src/models/Account');
const { initiateLogin, submitOTP } = require('../src/services/webScraper');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const accountId = process.argv[2];
  if (!accountId) {
    console.error('Usage: node scripts/test-web-login.js <accountId>');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await connectDB();

  const account = await Account.findById(accountId);
  if (!account) {
    console.error(`No account found with id ${accountId}`);
    process.exit(1);
  }
  if (account.connectionType !== 'web') {
    console.error(`Account ${accountId} is connectionType "${account.connectionType}", not "web" — nothing to log in with.`);
    process.exit(1);
  }
  if (!account.encryptedLoginEmail || !account.encryptedLoginPassword) {
    console.error(`Account ${accountId} has no saved web-login credentials.`);
    process.exit(1);
  }

  console.log(`Found account: ${account.displayName || account.upiId} (${account.platform})`);
  console.log('Launching a VISIBLE Chromium window — watch it navigate and log in...\n');

  const result = await initiateLogin(account, null);
  console.log('\ninitiateLogin() result:', result);

  if (result.needsOTP) {
    console.log('\nOTP required — check the phone linked to this Paytm account.');
    const otp = await ask('Enter the 6-digit OTP: ');
    const otpResult = await submitOTP(account, otp, null);
    console.log('\nsubmitOTP() result:', otpResult);
  }

  console.log('\nDone. If login succeeded, session cookies were written to:');
  console.log(`  paytm-session-${accountId}.json`);
  console.log('\nThe browser window stays open (startMonitoring polls every 60s, same as production) — Ctrl+C to exit when you\'re done watching.');
}

main().catch((err) => {
  console.error('\nTest script failed:', err.message);
  process.exit(1);
});
