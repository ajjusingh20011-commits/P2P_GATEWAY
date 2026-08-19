/**
 * Small amount-string helpers shared by paymentDetector, matchingEngine,
 * ledgerService and the admin/ngo summary routes.
 *
 * BUG-54: two separate bugs both produced "₹NaN" on the trader panel from
 * captured amount strings that LOOK numeric but aren't directly
 * Number()/parseFloat()-safe:
 *   (a) PhonePe notifications sometimes render digits using Unicode
 *       "Mathematical" digit variants (e.g. bold "𝟐𝟎" — real, distinct code
 *       points, not the ASCII digits 0-9) — the existing [0-9]-based amount
 *       regexes (here and on the APK) silently fail to match these at all.
 *   (b) thousand-separator commas ("1,000") were stripped in ONE of the two
 *       amount-resolution branches in paymentDetector.detectRealPayment()
 *       but not the other (the client-supplied-amount branch vs the
 *       server-regex-fallback branch) — an inconsistency between two
 *       divergent code paths, not a single missing strip. Several other
 *       call sites (matchingEngine, ledgerService, ngo.js, admin.js) each
 *       had their own ad hoc `.replace(/,/g, '')` — duplicated logic that
 *       had already drifted out of sync once and could again. This file is
 *       the single shared place all of them now route through.
 */

// Every Unicode block that renders 0-9 as visually digit-shaped code points
// with a real numeric value, in order 0->9 within each block. Bold is the
// confirmed PhonePe case; its siblings (Double-Struck, Sans-Serif,
// Sans-Serif Bold, Monospace) cost nothing extra to cover since they're the
// same style of lookalike and equally unmatchable by a plain [0-9] regex.
const DIGIT_BLOCK_STARTS = [0x1d7ce, 0x1d7d8, 0x1d7e2, 0x1d7ec, 0x1d7f6];

/**
 * Replaces Unicode "Mathematical" digit variants with real ASCII 0-9,
 * leaving every other character untouched. Safe to call on arbitrary
 * captured text (sender/body), not just an already-isolated amount — run
 * this BEFORE any amount regex, since the regex can't see through these
 * lookalikes to begin with (verified: /[0-9]/ does not match U+1D7D0).
 * @param {string} text
 * @returns {string}
 */
function normalizeUnicodeDigits(text) {
  if (!text) return text;
  return Array.from(text)
    .map((ch) => {
      const cp = ch.codePointAt(0);
      for (let i = 0; i < DIGIT_BLOCK_STARTS.length; i += 1) {
        const start = DIGIT_BLOCK_STARTS[i];
        if (cp >= start && cp <= start + 9) {
          return String(cp - start);
        }
      }
      return ch;
    })
    .join('');
}

/**
 * Cleans an already-extracted amount string into something safe for
 * Number()/parseFloat(): Unicode digit variants -> ASCII, thousand-separator
 * commas stripped, trimmed. Returns '' for empty/falsy input — every caller
 * here already treats '' as "no usable amount".
 * @param {string} raw
 * @returns {string}
 */
function cleanAmountString(raw) {
  if (!raw) return '';
  return normalizeUnicodeDigits(String(raw)).replace(/,/g, '').trim();
}

module.exports = { normalizeUnicodeDigits, cleanAmountString };
