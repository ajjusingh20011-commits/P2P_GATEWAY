/**
 * Small date/time helpers shared by the matching engine and services.
 */

/**
 * Converts a date (or date-like value) to an ISO-8601 UTC string.
 * Defaults to "now" when no argument is given.
 * @param {Date|string|number} [date]
 * @returns {string} ISO string, e.g. "2026-07-06T10:15:30.000Z"
 */
function toUTC(date) {
  const d = date ? new Date(date) : new Date();
  return d.toISOString();
}

/**
 * Returns true when two dates are within `minutes` of each other.
 * @param {Date|string|number} date1
 * @param {Date|string|number} date2
 * @param {number} minutes
 * @returns {boolean}
 */
function isWithinMinutes(date1, date2, minutes) {
  const t1 = new Date(date1).getTime();
  const t2 = new Date(date2).getTime();
  if (Number.isNaN(t1) || Number.isNaN(t2)) {
    return false;
  }
  const diffMs = Math.abs(t1 - t2);
  return diffMs <= minutes * 60 * 1000;
}

module.exports = { toUTC, isWithinMinutes };
