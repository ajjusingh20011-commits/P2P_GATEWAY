/**
 * Real-vs-noise classifier for APK-captured SMS/notification events.
 *
 * Why this exists: routes/apk.js's POST /event previously trusted the
 * `category` field the Android app sends — but NotificationService.java and
 * APIClient.java both hardcode `category: "PAYMENT"` on every single event
 * they upload, regardless of what the text actually is (confirmed by
 * grepping the app). So the existing `rawEvent.category === CATEGORY.PAYMENT`
 * gate in apk.js has never actually filtered anything — every captured SMS/
 * notification (promotional GPay rewards, OTPs, outgoing-payment
 * confirmations, bank marketing texts, etc.) looked identical to a real
 * received payment as far as the server was concerned.
 *
 * Tightened against real formats confirmed via live device testing:
 *
 *   GPay received : Title "Google Pay" / "Received ₹[Amount] from [Sender
 *                    Name] / [UPI ID]" / sub-text "Tap to view transaction
 *                    details or check history."
 *   GPay sent      : "Paid ₹[Amount] to [Recipient Name]" / sub-text
 *                    "Successful / Completed via UPI." — NOTE: no "you"
 *                    prefix, unlike the earlier best-effort version of this
 *                    file assumed.
 *   GPay request   : "[Name] requested ₹[Amount]" / sub-text "Tap to pay or
 *                    decline the request."
 *   Bank debit     : "Rs [Amount] debited from A/c XX[last4] on [Date]-
 *                    [Time] to [Info/UPI/Beneficiary]-Bal: Rs [Balance]"
 *   Bank credit    : "Rs [Amount] credited to A/c XX[last4] on [Date]-
 *                    [Time] by [Info/Sender]-Bal: Rs [Balance]"
 */

// Reject outright — money moving OUT, not in, or not money at all.
// Matched before the RECEIVED signals below so an SMS that happens to
// contain both ("You paid ₹500... cashback ₹5 credited") is correctly
// treated as noise/outgoing, not a receipt.
const NOISE_PATTERNS = [
  // Promotional / rewards noise — GPay and banks both send these, and they
  // often still contain a ₹ amount, which is exactly why category alone
  // (or amount-presence alone) was never a safe signal.
  /cashback/i,
  /reward/i,
  /scratch\s*card/i,
  /\boffer\b/i,
  /\bwon\b/i,
  /lottery/i,
  /\bbonus\b/i,
  /coupon/i,
  /refer\s*(?:&|and)\s*earn/i,
  /lucky\s*draw/i,
  /spin\s*the\s*wheel/i,
  // OTP / verification noise.
  /\botp\b/i,
  /one[\s-]?time\s*password/i,
  /verification\s*code/i,
  /do\s*not\s*share/i,
  // Outgoing money — has its own path (POST /api/apk/outgoing-payment) and
  // must not also create an incoming Transaction here. The real GPay "sent"
  // format is "Paid ₹500 to Recipient Name" — NO "you" prefix — so this
  // must not require one; /you\s*(?:have\s*)?paid/i alone would miss it.
  /\bpaid\s*(?:₹|rs\.?|inr)?\s*[\d,.]*\s*to\b/i,
  /payment\s*sent/i,
  /\bdebited\b/i,
  /money\s*sent/i,
  // Payment *requests* — no money has actually moved yet.
  /has\s*requested/i,
  /payment\s*request/i,
  /requested\s*(?:₹|rs\.?|inr)/i,
  /money\s*request/i,
];

// Accept — real signals of money having actually arrived.
const RECEIVED_PATTERNS = [
  /\breceived\b/i,
  /\bcredited\b/i,
  /payment\s*received/i,
  /money\s*received/i,
  /added\s*to\s*your\s*account/i,
  /added\s*to\s*(?:your\s*)?(?:gpay|google\s*pay)\s*balance/i,
];

// Same amount regex family as PaymentParser.java (Android), kept in sync
// deliberately: ₹500, Rs.500, Rs 500, INR 500.
const AMOUNT_PATTERN = /(?:₹|rs\.?|inr)\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/i;
const UPI_ID_PATTERN = /([a-zA-Z0-9][a-zA-Z0-9._-]{1,}@[a-zA-Z][a-zA-Z0-9.-]{1,})/;
// Reuses the same label set PaymentParser.java's SENDER pattern uses.
const SENDER_PATTERN = /(?:received\s+from|paid\s+by|from|by)\s+([A-Za-z][A-Za-z0-9 ._@-]{1,39})/i;

/**
 * The char class above includes '-' (needed for hyphenated names) which
 * means it greedily swallows the bank-SMS balance suffix too — the real
 * credit format is "...by John Doe-Bal: Rs 10000", so a naive extraction
 * would capture "John Doe-Bal", not "John Doe". Strip that off, plus the
 * same trailing-noise-word cleanup PaymentParser.java's parseSender()
 * already does on the Android side, so both extractions agree.
 */
function cleanPayerName(raw) {
  if (!raw) return '';
  return raw
    .replace(/[-–]\s*bal\b.*$/i, '')
    // Words that begin the NEXT clause, so the name ends before them.
    // `at` was missing, which is what produced payer names like
    // "Chiranjit K B at 6" from "…from Chiranjit K B at 6:47 PM":
    // SENDER_PATTERN's capture class allows spaces and digits, so it runs on
    // until the colon rather than stopping at the word boundary.
    .replace(/\s+(has|is|was|on|at|for|of|to|via|using|through|ref|utr|txn|upi)\b.*$/i, '')
    // Belt and braces for any trailing time / date / bare-number fragment the
    // label list above doesn't cover ("Name 6:47 PM", "Name 11 Aug", "Name 6").
    // A real payer name does not end in digits.
    .replace(/\s+\d[\d:./\s-]*(?:[ap]\.?m\.?)?\s*$/i, '')
    // Separators either strip can leave dangling.
    .replace(/[\s,.\-–:;]+$/, '')
    .trim();
}

/**
 * @param {Object} evt
 * @param {string} evt.type - RAW_EVENT_TYPE (SMS/NOTIFICATION/SCREEN)
 * @param {string} evt.sender
 * @param {string} evt.body
 * @param {string} evt.amount - already extracted client-side (PaymentParser.java), may be empty
 * @param {string} evt.utr - already extracted client-side, may be empty
 * @returns {{ isRealPayment: boolean, reason: string, amount: string, payerName: string, payerUpiId: string }}
 */
function detectRealPayment(evt) {
  const text = `${evt.sender || ''} ${evt.body || ''}`;

  // Screen-capture events don't go through this route at all today (they
  // use /api/apk/outgoing-payment or /api/apk/overlay-capture) — defensive
  // only, not expected to actually be hit via POST /event.
  if (evt.type === 'SCREEN') {
    return { isRealPayment: false, reason: 'screen events use a different route' };
  }

  for (const pattern of NOISE_PATTERNS) {
    if (pattern.test(text)) {
      return { isRealPayment: false, reason: `noise match: ${pattern}` };
    }
  }

  const hasReceivedSignal = RECEIVED_PATTERNS.some((p) => p.test(text));
  if (!hasReceivedSignal) {
    return { isRealPayment: false, reason: 'no received/credited signal found' };
  }

  // Prefer the client's own extraction (PaymentParser.java runs the same
  // amount regex on-device already) — only fall back to re-deriving from
  // body text if the client didn't send one.
  const amountMatch = AMOUNT_PATTERN.exec(evt.body || '');
  const amount = (evt.amount && evt.amount.trim()) || (amountMatch ? amountMatch[1].replace(/,/g, '') : '');
  if (!amount) {
    // Transaction.amount is a required field — never create one with an
    // empty/fabricated amount. Better to skip and leave the RawEvent as
    // the only record than to insert a bad Transaction.
    return { isRealPayment: false, reason: 'received signal found but no usable amount' };
  }

  const senderMatch = SENDER_PATTERN.exec(evt.body || '');
  const payerName = cleanPayerName(senderMatch ? senderMatch[1] : '') || (evt.sender || '').trim();

  const upiMatch = UPI_ID_PATTERN.exec(evt.body || '');
  const payerUpiId = upiMatch ? upiMatch[1] : '';

  return { isRealPayment: true, reason: 'received/credited signal + usable amount', amount, payerName, payerUpiId };
}

module.exports = { detectRealPayment };
