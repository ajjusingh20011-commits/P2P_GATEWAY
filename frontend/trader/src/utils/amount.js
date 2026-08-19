/**
 * BUG-54 — "₹NaN" on the trader Notifications page. Two confirmed root
 * causes upstream (ngo-backend/src/utils/amountHelper.js has the full
 * writeup): Unicode "Mathematical" digit variants PhonePe sometimes
 * renders ("𝟐𝟎" instead of "20"), and a comma-stripping inconsistency
 * between two server-side amount-extraction branches ("1,000" reaching
 * Number() uncleaned). Both are now fixed at the source going forward.
 *
 * This is the second, independent layer: the trader panel is a display
 * surface, not just a mirror of whatever the API returns, and rows already
 * sitting in Mongo from before the backend fix would otherwise keep
 * showing "₹NaN" until someone re-captures the same payment. formatAmount
 * defensively re-cleans on the way to the screen so a still-imperfect or
 * future-unknown capture format degrades to the raw string instead of the
 * literal word "NaN" next to a ₹ sign — a real trust problem for a
 * trader trying to reconcile money.
 */

// Mirrors ngo-backend/src/utils/amountHelper.js's DIGIT_BLOCK_STARTS —
// same five Unicode blocks, kept in sync deliberately.
const DIGIT_BLOCK_STARTS = [0x1d7ce, 0x1d7d8, 0x1d7e2, 0x1d7ec, 0x1d7f6];

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
 * Formats a captured amount value for display as "₹<number>", tolerant of
 * commas and Unicode digit variants. Falls back to the raw value (never the
 * literal string "NaN") if it still can't be parsed after cleaning.
 * @param {string|number} raw
 * @returns {string} e.g. "1,000" (already ₹-prefixed by the caller)
 */
export function formatAmount(raw) {
  if (raw === null || raw === undefined || raw === '') return '0';
  const cleaned = normalizeUnicodeDigits(String(raw)).replace(/,/g, '').trim();
  const n = Number(cleaned);
  if (Number.isNaN(n)) {
    // Better to show exactly what we captured than "₹NaN" — a trader can
    // still read a raw amount; "NaN" tells them nothing and looks broken.
    return String(raw);
  }
  return n.toLocaleString('en-IN');
}
