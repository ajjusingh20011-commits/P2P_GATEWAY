'use strict';

/**
 * Reconciles a trader's DECLARED bank (payment_details.bank_name, the exact
 * label they picked when adding the account) to the canonical TRAI DLT sender
 * code — so it can be compared, apples-to-apples, against the bank an incoming
 * SMS identifies itself as (BUG-58, SMS half).
 *
 * Two halves of the same vocabulary live in two packages:
 *   - the SMS sender → code side is ngo-backend/src/utils/bankSenders.js;
 *   - this is the declared-name → code side, in the gateway where bank_name and
 *     the settle decision live.
 * They MUST share the same code set — keep them in sync when a code is added.
 *
 * Why a code and not a raw string compare: the picker and the SMS table don't
 * spell every bank the same way ("SBI" vs "State Bank of India", "GPay Business"
 * vs "Google Pay Business"). Normalising both sides to the DLT code removes that
 * mismatch. A name we can't place returns null — the caller then holds for
 * manual review rather than guessing.
 */

// Lowercase, strip punctuation to single spaces, trim — so "J&K Bank",
// "Punjab & Sind Bank", "IDFC FIRST Bank" normalise stably on both sides.
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Canonical display name per DLT code (matches the SMS table's names and, after
// last change's reconciliation, the trader picker's names for real banks).
const CODE_TO_NAME = {
  SBIBNK: 'State Bank of India',
  HDFCBK: 'HDFC Bank',
  ICICIB: 'ICICI Bank',
  AXISBK: 'Axis Bank',
  PNBSMS: 'Punjab National Bank',
  BOBSMS: 'Bank of Baroda',
  BOINDF: 'Bank of India',
  CANBNK: 'Canara Bank',
  UNIONB: 'Union Bank of India',
  KOTAKB: 'Kotak Mahindra Bank',
  INDUSB: 'IndusInd Bank',
  IDFCFB: 'IDFC FIRST Bank',
  IDBIBK: 'IDBI Bank',
  CBINDF: 'Central Bank of India',
  IOBBNK: 'Indian Overseas Bank',
  MAHABK: 'Bank of Maharashtra',
  UCOBNK: 'UCO Bank',
  PSBBNK: 'Punjab & Sind Bank',
  FEDBNK: 'Federal Bank',
  SIBBNK: 'South Indian Bank',
  KVBBNK: 'Karur Vysya Bank',
  KBLBNK: 'Karnataka Bank',
  CUBBNK: 'City Union Bank',
  CSBBNK: 'CSB Bank',
  DBSBNK: 'DBS Bank',
  DLXBNK: 'Dhanlaxmi Bank',
  BDNBNK: 'Bandhan Bank',
  RBLBNK: 'RBL Bank',
  YESBNK: 'YES Bank',
  JKBBNK: 'J&K Bank',
  TMBBNK: 'Tamilnad Mercantile Bank',
  KGBBNK: 'Kerala Gramin Bank',
  ESAFSF: 'ESAF Small Finance Bank',
  FNCFNB: 'Fincare Small Finance Bank',
  JANASFB: 'Jana Small Finance Bank',
  UJJIVN: 'Ujjivan Small Finance Bank',
  AIRTEL: 'Airtel Payments Bank',
  PAYTM: 'Paytm Payments Bank',
  IPPBIN: 'India Post Payments Bank',
  FINOAN: 'Fino Payments Bank',
  NSDLBN: 'NSDL Payments Bank',
  BHRTPE: 'BharatPe',
  PHONEP: 'PhonePe',
  GPAYBZ: 'Google Pay Business',
  KWIKSM: 'MobiKwik',
};

// Picker labels that differ from the canonical name above — abbreviations and
// the merchant-app names a trader may have declared. (App-named accounts mostly
// collect via notifications, but a declared value must still resolve so a bank
// SMS can be compared against it.)
const EXTRA_ALIASES = {
  sbi: 'SBIBNK',
  pnb: 'PNBSMS',
  'gpay business': 'GPAYBZ',
  gpay: 'GPAYBZ',
  'phonepe business': 'PHONEP',
  'paytm business': 'PAYTM',
  paytm: 'PAYTM',
  'bharatpe business': 'BHRTPE',
  bharatpe: 'BHRTPE',
};

const NAME_TO_CODE = {};
for (const [code, name] of Object.entries(CODE_TO_NAME)) NAME_TO_CODE[norm(name)] = code;
for (const [alias, code] of Object.entries(EXTRA_ALIASES)) NAME_TO_CODE[norm(alias)] = code;

/**
 * @param {string} bankName - payment_details.bank_name (the trader's declared label)
 * @returns {string|null} the canonical DLT sender code, or null when the name is
 *   blank or unrecognised (caller must hold, not guess).
 */
function canonicalBankCode(bankName) {
  if (!bankName) return null;
  return NAME_TO_CODE[norm(bankName)] || null;
}

module.exports = { canonicalBankCode, CODE_TO_NAME };
