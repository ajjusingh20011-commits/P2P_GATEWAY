'use strict';

/**
 * Which half of a capture actually describes the payment.
 *
 * A notification arrives as a title and a body, and NotificationService stores
 * the title inside `sender` ("<app name>: <title>"). GPay alternates which of
 * the two carries the payment between posts of the SAME notification — the
 * title reads "₹10 received from Chiranjit K B at 6:40pm" one minute and the
 * boilerplate "See live notifications here…" the next, with the body doing the
 * opposite. BUG-40 fixed the amount and payer extraction to look at both;
 * this is the same fallback for the line the trader actually reads.
 *
 * Deliberately picks by CONTENT, not by field: whichever text names an amount
 * is the payment, wherever the app decided to put it that time.
 */

const AMOUNT = /(?:₹|rs\.?|inr)\s*[0-9]/i;

/** The title half of NotificationService's "<app name>: <title>" sender. */
function titleOf(sender) {
  if (!sender) return '';
  const colon = sender.indexOf(':');
  return colon === -1 ? '' : sender.slice(colon + 1).trim();
}

/**
 * @param {object} row
 * @param {string} [row.body] - RawEvent.body
 * @param {string} [row.sender] - RawEvent.sender
 * @returns {string} the text to show the trader, '' when there is no capture
 */
function paymentText({ body, sender } = {}) {
  const b = (body || '').trim();
  const title = titleOf(sender);

  // The body first — it is the payment line in the common case, and it is the
  // text every capture before this change was displayed from.
  if (AMOUNT.test(b)) return b;
  if (AMOUNT.test(title)) return title;

  // Neither names an amount (a scraper row, or boilerplate on both halves):
  // keep the existing behaviour rather than inventing text.
  return b || title;
}

module.exports = { paymentText, titleOf };
