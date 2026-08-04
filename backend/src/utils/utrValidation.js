'use strict';

/**
 * Rejects obviously-fake UTR/reference numbers a donor might type just to
 * get past the "enter UTR" step (all-repeated digits, simple ascending/
 * descending runs, or a two-digit alternating pattern). This is a cheap
 * plausibility filter, not a checksum/registry lookup — real UTRs still
 * pass through unexamined otherwise.
 */
function isJunkUtr(raw) {
  const s = String(raw || '').trim();
  if (!/^\d+$/.test(s)) return false; // only digit strings match these patterns
  if (s.length < 4) return false;

  if (/^(\d)\1+$/.test(s)) return true; // 111111111111, 222222222222, ...

  let ascending = true;
  let descending = true;
  for (let i = 1; i < s.length; i++) {
    const prev = Number(s[i - 1]);
    const cur = Number(s[i]);
    if (cur !== (prev + 1) % 10) ascending = false;
    if (cur !== (prev + 9) % 10) descending = false;
  }
  if (ascending || descending) return true; // 123456789012, 987654321098, ...

  let alternating = true;
  for (let i = 2; i < s.length; i++) {
    if (s[i] !== s[i - 2]) { alternating = false; break; }
  }
  if (alternating && s[0] !== s[1]) return true; // 121212121212, ...

  return false;
}

module.exports = { isJunkUtr };
