/**
 * Rejects obviously-fake UTR/reference numbers a donor might type just to
 * get past the "enter UTR" step (all-repeated digits, simple ascending/
 * descending runs, or a two-digit alternating pattern). This is a cheap
 * plausibility filter, not a checksum/registry lookup — real UTRs still
 * pass through unexamined otherwise.
 *
 * Mirrors backend/src/utils/utrValidation.js exactly (kept as two small
 * copies since the checkout frontend and the API server are separate
 * packages/build systems — same duplication pattern already used elsewhere
 * in this codebase, e.g. SMSReceiver.java/NotificationService.java's regex
 * constants). The server re-runs this check independently — the client copy
 * is a UX nicety, not the enforcement point.
 */
export function isJunkUtr(raw) {
  const s = String(raw || '').trim();
  if (!/^\d+$/.test(s)) return false;
  if (s.length < 4) return false;

  if (/^(\d)\1+$/.test(s)) return true;

  let ascending = true;
  let descending = true;
  for (let i = 1; i < s.length; i++) {
    const prev = Number(s[i - 1]);
    const cur = Number(s[i]);
    if (cur !== (prev + 1) % 10) ascending = false;
    if (cur !== (prev + 9) % 10) descending = false;
  }
  if (ascending || descending) return true;

  let alternating = true;
  for (let i = 2; i < s.length; i++) {
    if (s[i] !== s[i - 2]) { alternating = false; break; }
  }
  if (alternating && s[0] !== s[1]) return true;

  return false;
}
