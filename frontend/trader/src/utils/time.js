/**
 * Every absolute time this panel shows is IST, for every trader, wherever they
 * are.
 *
 * The trap this exists to close: 'en-IN' is a LOCALE, not a timezone. It picks
 * Indian formatting conventions while the clock still comes from whatever
 * machine is rendering, so the same payment read 09:44 to one trader and 04:14
 * to another — and neither was labelled. Anything hand-rolled from
 * Date#getHours() has the same problem, silently.
 *
 * The gateway's own settlement, routing windows and daily limits are all
 * reckoned in IST, so a trader comparing the panel against their bank app or
 * against support needs one clock, not their own.
 */

export const IST = 'Asia/Kolkata';
export const IST_LABEL = 'IST';

function valid(value) {
  if (value == null || value === '' || value === '—') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "21:44", or "09:44 pm" with hour12. Null for a missing/invalid value. */
export function istTime(value, { hour12 = false } = {}) {
  const d = valid(value);
  if (!d) return null;
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12, timeZone: IST,
  });
}

/** "11.08.2026" (dotted) or "11/08/2026" (slash). Null when unset. */
export function istDate(value, { style = 'dotted' } = {}) {
  const d = valid(value);
  if (!d) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: IST,
  }).formatToParts(d).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const sep = style === 'slash' ? '/' : '.';
  return `${parts.day}${sep}${parts.month}${sep}${parts.year}`;
}

/** Both halves at once, for the two-line stamps used in tables. */
export function istStamp(value, opts = {}) {
  const time = istTime(value, opts);
  if (!time) return null;
  return { time, date: istDate(value, opts) };
}

/** "11.08.2026 21:44 IST" — for tooltips and one-line displays. */
export function istDateTime(value, opts = {}) {
  const time = istTime(value, opts);
  if (!time) return null;
  return `${istDate(value, opts)} ${time} ${IST_LABEL}`;
}
