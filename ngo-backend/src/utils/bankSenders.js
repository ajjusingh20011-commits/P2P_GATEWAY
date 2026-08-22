'use strict';

/**
 * TRAI DLT sender-header → bank identification (BUG-58), as a 4-layer, tiered-
 * confidence system. This SUPERSEDES the earlier detection the audit flagged as
 * an unverified seed list, and replaces the loose substring fallback that could
 * false-match (e.g. "CAN" sitting inside "MERCAN").
 *
 * Real sender format is `XX-YYYYYY`: a 2-char operator/circle prefix (VM, AX,
 * JD, …) then the DLT header registered to the sender. Headers are not all six
 * characters (`PAYTM`=5, `JANASFB`=7).
 *
 * ── The 4 layers ──────────────────────────────────────────────────────────
 *  1. ISOLATE the header first — parse it out of the sender and match only
 *     against that token, never against the full SMS body/text.
 *  2. ANCHORED matching — startsWith on the isolated header, never "contains".
 *     "MERCAN".startsWith("CAN") is false, so the classic substring collision
 *     cannot happen.
 *  3. LENGTH/PRIORITY — longer, more specific prefixes are tried before shorter
 *     generic ones.
 *  4. TIERED ROUTING, evaluated exact → blacklist → prefix:
 *       Tier 1  exact dictionary hit  — CERTAIN. Settle-eligible.
 *       Tier 3  blacklist trap        — a header that resembles a bank prefix
 *                                       but isn't (CANFIN → Can Fin Homes,
 *                                       MAHAGO → a govt service). Non-bank,
 *                                       never settles. Checked BEFORE Tier 2 so
 *                                       a trap can never fall through to a
 *                                       parent bank.
 *       Tier 2  anchored prefix hit   — a well-designed INFERENCE (HDFCBF→HDFC,
 *                                       SBIPSG→SBI). Good enough to DISPLAY,
 *                                       NOT good enough to auto-settle money.
 *
 * ── Confidence carries downstream (the money-safety refinement) ────────────
 *  DISPLAY (logo/name in UI): any resolving tier is fine — use `identifyBankFromSender`.
 *  SETTLEMENT (BUG-58 auto-close): ONLY Tier 1 may auto-settle — use
 *  `settlementBankCode`, which returns a code exclusively for an exact match.
 *  Tier 2/3/none → null → the matcher holds for manual review.
 */

// ── Tier 1 — the verified real header table. Exact hits only. ──────────────
// DLT header → { name, logo }. Keys are UPPERCASE.
const BANK_BY_SENDER_CODE = {
  SBIBNK: { name: 'State Bank of India', logo: 'sbi.svg' },
  HDFCBK: { name: 'HDFC Bank', logo: 'hdfc-bank.svg' },
  ICICIB: { name: 'ICICI Bank', logo: 'icici-bank.svg' },
  AXISBK: { name: 'Axis Bank', logo: 'axis_bank.svg' },
  PNBSMS: { name: 'Punjab National Bank', logo: 'pnb.svg' },
  BOBSMS: { name: 'Bank of Baroda', logo: 'bank_of_baroda.svg' },
  BOINDF: { name: 'Bank of India', logo: 'bank_of_india.svg' },
  CANBNK: { name: 'Canara Bank', logo: 'canara_bank.svg' },
  UNIONB: { name: 'Union Bank of India', logo: 'unionin.svg' },
  KOTAKB: { name: 'Kotak Mahindra Bank', logo: 'kotak.svg' },
  INDUSB: { name: 'IndusInd Bank', logo: 'indusind.svg' },
  IDFCFB: { name: 'IDFC FIRST Bank', logo: 'idfc-bank.svg' },
  IDBIBK: { name: 'IDBI Bank', logo: 'idbi-bank.svg' },
  CBINDF: { name: 'Central Bank of India', logo: 'central_bank.svg' },
  IOBBNK: { name: 'Indian Overseas Bank', logo: 'indian-overseas-bank.svg' },
  MAHABK: { name: 'Bank of Maharashtra', logo: 'bank_of_maharashtra.svg' },
  UCOBNK: { name: 'UCO Bank', logo: 'uco.svg' },
  PSBBNK: { name: 'Punjab & Sind Bank', logo: 'punjab-sind-bank.svg' },
  FEDBNK: { name: 'Federal Bank', logo: 'federal_bank.svg' },
  SIBBNK: { name: 'South Indian Bank', logo: 'south-indian-bank.svg' },
  KVBBNK: { name: 'Karur Vysya Bank', logo: 'karur-vysya-bank.svg' },
  KBLBNK: { name: 'Karnataka Bank', logo: 'karnataka-bank.svg' },
  CUBBNK: { name: 'City Union Bank', logo: 'city_union_bank.svg' },
  CSBBNK: { name: 'CSB Bank', logo: 'csb_bank.svg' },
  DBSBNK: { name: 'DBS Bank', logo: 'dbs_bank.svg' },
  DLXBNK: { name: 'Dhanlaxmi Bank', logo: 'dhanlaxmi-bank.svg' },
  BDNBNK: { name: 'Bandhan Bank', logo: 'bandhan_bank.svg' },
  RBLBNK: { name: 'RBL Bank', logo: 'rblbank.svg' },
  YESBNK: { name: 'YES Bank', logo: 'yes.svg' },
  JKBBNK: { name: 'J&K Bank', logo: 'jk-bank.svg' },
  TMBBNK: { name: 'Tamilnad Mercantile Bank', logo: 'tmb-bank.svg' },
  KGBBNK: { name: 'Kerala Gramin Bank', logo: 'kerala.svg' },
  ESAFSF: { name: 'ESAF Small Finance Bank', logo: 'esaf-bank.svg' },
  FNCFNB: { name: 'Fincare Small Finance Bank', logo: 'fincare-bank.svg' },
  JANASFB: { name: 'Jana Small Finance Bank', logo: 'janabank.svg' },
  UJJIVN: { name: 'Ujjivan Small Finance Bank', logo: 'ujjivan-bank.svg' },
  AIRTEL: { name: 'Airtel Payments Bank', logo: 'airtel.svg' },
  PAYTM: { name: 'Paytm Payments Bank', logo: 'paytm.svg' },
  IPPBIN: { name: 'India Post Payments Bank', logo: 'india-post-payments-bank.svg' },
  FINOAN: { name: 'Fino Payments Bank', logo: 'fino-payments-bank.svg' },
  NSDLBN: { name: 'NSDL Payments Bank', logo: 'nsdl-bank.svg' },
  BHRTPE: { name: 'BharatPe', logo: 'bharatpe.svg' },
  PHONEP: { name: 'PhonePe', logo: 'phone-pe-mqr.svg' },
  GPAYBZ: { name: 'Google Pay Business', logo: 'gpay-business-bank.svg' },
  KWIKSM: { name: 'MobiKwik', logo: 'mobikwik.svg' },
};

// ── Tier 3 — blacklist / disambiguation of known false-positive traps. ─────
// Headers that resemble a bank prefix but are a different entity. Checked
// before Tier 2 so they never resolve to a parent bank. Non-bank → never
// settles; the label lets the UI show it honestly. Extend as real traps surface.
const HEADER_BLACKLIST = {
  CANFIN: { label: 'Can Fin Homes', note: 'housing finance company, not Canara Bank' },
  MAHAGO: { label: 'Maharashtra Govt', note: 'government service, not Bank of Maharashtra' },
};

// ── Tier 2 — anchored bank header prefixes. prefix → canonical DLT code. ────
// Real registered variants share a lead (HDFCBK/HDFCBF/HDFCBN → HDFC;
// SBIBNK/SBIPSG/SBIINB → SBI). Prefixes are chosen specific enough that an
// anchored startsWith cannot reasonably hit a non-bank header; the Tier 3
// blacklist covers the few that can. NOT settle-eligible — inference only.
const BANK_PREFIXES = {
  ICICI: 'ICICIB',
  INDUS: 'INDUSB',
  CANARA: 'CANBNK',
  CANBK: 'CANBNK',
  CANBNK: 'CANBNK',
  KOTAK: 'KOTAKB',
  UNION: 'UNIONB',
  HDFC: 'HDFCBK',
  AXIS: 'AXISBK',
  IDFC: 'IDFCFB',
  IDBI: 'IDBIBK',
  FEDB: 'FEDBNK',
  YESB: 'YESBNK',
  CBIN: 'CBINDF',
  MAHAB: 'MAHABK',
  IPPB: 'IPPBIN',
  SBI: 'SBIBNK',
  PNB: 'PNBSMS',
  BOB: 'BOBSMS',
  BOI: 'BOINDF',
  RBL: 'RBLBNK',
  UCO: 'UCOBNK',
  KVB: 'KVBBNK',
  KBL: 'KBLBNK',
};
// Layer 3 — length/priority: try the longest (most specific) prefix first.
const PREFIXES_BY_LENGTH = Object.keys(BANK_PREFIXES).sort((a, b) => b.length - a.length);

/**
 * Layer 1 — isolate the candidate header token(s) from the sender, never the
 * full text. Splits on delimiters (so "VM-SBIBNK" → "SBIBNK", ignoring the
 * operator prefix) and, for a compact "XXHEADER" with no delimiter, also offers
 * the header with the 2-char operator prefix stripped.
 */
function headerTokens(sender) {
  const s = String(sender || '').toUpperCase();
  const segs = s.split(/[^A-Z0-9]+/).filter(Boolean);
  const tokens = [];
  if (segs.length >= 2) {
    for (const seg of segs) tokens.push(seg); // "VM","SBIBNK" — operator is its own segment
  } else if (segs.length === 1) {
    const seg = segs[0];
    tokens.push(seg);
    if (seg.length > 2) tokens.push(seg.slice(2)); // compact "VMSBIBNK" → "SBIBNK"
  }
  return [...new Set(tokens)];
}

/**
 * Identify the bank behind an SMS sender header, with its confidence tier.
 *
 * @param {string} sender - raw SMS sender/address, e.g. "VM-SBIBNK", "AX-HDFCBF".
 * @returns {{ tier:1|2|3, code:string|null, name:string, logo:string|null,
 *   isBank:boolean, confident:boolean, note?:string } | null} the match, or
 *   null when nothing resolves. `confident` is true ONLY for Tier 1 (exact) —
 *   the settlement path keys off that; DISPLAY may use any tier.
 */
function identifyBankFromSender(sender) {
  if (!sender) return null;
  const tokens = headerTokens(sender);

  // Tier 1 — exact dictionary lookup. Highest confidence; stop immediately.
  for (const t of tokens) {
    if (BANK_BY_SENDER_CODE[t]) {
      return { tier: 1, code: t, ...BANK_BY_SENDER_CODE[t], isBank: true, confident: true };
    }
  }

  // Tier 3 — blacklist traps, BEFORE prefix matching so a trap never resolves
  // to a parent bank. Non-bank; never settles.
  for (const t of tokens) {
    if (HEADER_BLACKLIST[t]) {
      const b = HEADER_BLACKLIST[t];
      return { tier: 3, code: null, name: b.label, logo: null, isBank: false, confident: false, note: b.note };
    }
  }

  // Tier 2 — anchored prefix matching, longest prefix first. Inference only.
  for (const t of tokens) {
    for (const pref of PREFIXES_BY_LENGTH) {
      if (t.startsWith(pref)) {
        const code = BANK_PREFIXES[pref];
        return { tier: 2, code, ...BANK_BY_SENDER_CODE[code], isBank: true, confident: false };
      }
    }
  }

  return null;
}

/**
 * SETTLEMENT gate — the DLT code that may auto-close an order, or null.
 * Returns a code ONLY for a Tier 1 exact match. A Tier 2 inference, a Tier 3
 * trap, or no match all return null, so the matcher holds for manual review —
 * the "don't guess with real money" bar, kept strict for the money decision
 * even though DISPLAY happily uses the full system.
 */
function settlementBankCode(sender) {
  const r = identifyBankFromSender(sender);
  return r && r.confident ? r.code : null;
}

// ── Bank sign-off extraction (redesign — a SECOND confirmation layer) ───────
// Most genuine bank SMS end with the bank's own name after a trailing dash:
//   "… Ref No 623409812345. Avail Bal: Rs 14,250.00. - Bank of Maharashtra"
// This recovers that name and is used two ways (never for settlement):
//   1. header recognised → cross-check header vs sign-off agree (a mismatch is
//      a real suspicious signal worth surfacing).
//   2. header NOT recognised → show the REAL bank name in the review queue /
//      trader feed instead of a cryptic code (turns "unknown" into "Bank of X").
// A confidence signal, NOT a requirement: some banks omit it — absence alone
// must never count against a message.
//
// The trailing "- <phrase>" at the end of the SMS. Capture the phrase (letters,
// spaces, and a few name punctuation chars — never digits, so an earlier
// "21-AUG-26" or amount can't be captured), then keep it only if it actually
// contains the word "bank" (checked in code, so a name STARTING with "Bank" —
// "Bank of Maharashtra" — is handled as well as one ending in it).
const SIGNOFF_PATTERN = /[-–—]\s*([A-Za-z][A-Za-z&.'()\- ]{2,60})\s*\.?\s*$/;

function extractBankSignoff(body) {
  if (!body) return '';
  const m = SIGNOFF_PATTERN.exec(String(body).trim());
  if (!m) return '';
  const phrase = m[1].replace(/\s+/g, ' ').trim();
  return /\bbank\b/i.test(phrase) ? phrase : '';
}

const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Identify the bank behind an SMS using BOTH the header (tiered matcher, kept
 * unchanged) and the body sign-off. Pure — no settlement side effects.
 * @returns {{
 *   header: object|null,        // identifyBankFromSender result (tier/name/…)
 *   signoffName: string|null,   // bank name from the "- <Bank>" sign-off
 *   signoffAgrees: boolean|null,// header vs sign-off agree? null = n/a
 *   bankRecognized: boolean,    // did the header resolve to a bank?
 *   displayName: string|null,   // best name to SHOW (header, else sign-off)
 * }}
 */
function identifyBankFromSms(sender, body) {
  const header = identifyBankFromSender(sender);
  const signoffName = extractBankSignoff(body) || null;

  let signoffAgrees = null;
  if (header && header.name && signoffName) {
    const a = normName(header.name);
    const b = normName(signoffName);
    signoffAgrees = a === b || a.includes(b) || b.includes(a);
  }

  const bankRecognized = !!(header && header.isBank);
  const displayName = bankRecognized ? header.name : signoffName;

  return { header, signoffName, signoffAgrees, bankRecognized, displayName };
}

module.exports = {
  identifyBankFromSender,
  settlementBankCode,
  extractBankSignoff,
  identifyBankFromSms,
  BANK_BY_SENDER_CODE,
  HEADER_BLACKLIST,
  BANK_PREFIXES,
};
