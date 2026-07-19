const NGO = require('../models/NGO');
const Account = require('../models/Account');
const { encrypt, decrypt } = require('../utils/encryption');

/**
 * NGO lifecycle + account credential management.
 */

async function createNGO(payload) {
  const data = { ...payload };
  if (data.credentials) {
    // Store any raw credentials blob encrypted at rest.
    data.encryptedCredentials = encrypt(JSON.stringify(data.credentials));
    delete data.credentials;
  }
  return NGO.create(data);
}

async function listNGOs(filter = {}) {
  return NGO.find(filter).sort({ createdAt: -1 });
}

async function getNGO(id) {
  return NGO.findById(id);
}

async function updateNGO(id, updates) {
  return NGO.findByIdAndUpdate(id, updates, { new: true });
}

/**
 * Adds a payment account to an NGO, encrypting the login credentials.
 */
async function addAccount(ngoId, { platform, upiId, accountNumber, displayName, loginEmail, loginPassword }) {
  return Account.create({
    ngoId,
    platform,
    upiId,
    accountNumber,
    displayName,
    encryptedLoginEmail: encrypt(loginEmail || ''),
    encryptedLoginPassword: encrypt(loginPassword || ''),
  });
}

/**
 * Returns an account with its login credentials decrypted — used only by
 * the scraper engine, never exposed over the public API.
 */
async function getAccountWithCredentials(accountId) {
  const account = await Account.findById(accountId).lean();
  if (!account) {
    return null;
  }
  return {
    ...account,
    loginEmail: decrypt(account.encryptedLoginEmail || ''),
    loginPassword: decrypt(account.encryptedLoginPassword || ''),
    loginPhone: decrypt(account.encryptedLoginPhone || ''),
  };
}

async function listAccounts(ngoId) {
  return Account.find({ ngoId }).sort({ createdAt: -1 });
}

module.exports = {
  createNGO,
  listNGOs,
  getNGO,
  updateNGO,
  addAccount,
  getAccountWithCredentials,
  listAccounts,
};
