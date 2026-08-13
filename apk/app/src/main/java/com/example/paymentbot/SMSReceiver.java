package com.example.paymentbot;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import android.telephony.SmsMessage;
import android.util.Log;

import org.json.JSONObject;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * BroadcastReceiver that listens for ALL incoming SMS (no sender filtering),
 * builds an {@link SMSData} object for each message, and forwards it to the UI
 * via {@link MainActivity#addSMS(SMSData)}.
 *
 * <p>Enhanced with DEBIT detection: debit SMS from a verified transactional
 * ("-T") bank sender are parsed into a {@link DebitSMSData} (last-4 / amount /
 * balance / UTR), shown in the feed as a red DEBIT card, and forwarded to the
 * backend.
 */
public class SMSReceiver extends BroadcastReceiver {

    private static final String TAG = "PaymentBot";
    private static final String SMS_RECEIVED = "android.provider.Telephony.SMS_RECEIVED";

    // Path relative to the server base URL — see EventQueue/EventUploadWorker,
    // which resolve the base URL fresh on every delivery attempt rather than
    // baking it in at capture time.
    private static final String DEBIT_ENDPOINT_PATH = "/api/apk/debit-sms";

    // Legitimate transactional bank sender IDs, e.g. AX-HDFCBK-T, VM-SBIPSG-T.
    private static final Pattern TRANSACTIONAL_SENDER = Pattern.compile("^[A-Z]{2}-[A-Z]+-T$");

    // TRAI DLT transactional sender-ID header structure: two-letter
    // carrier/circle code, hyphen, 6-character DLT-registered entity tag,
    // hyphen, "T" (Transactional) suffix — e.g. "AD-HDFCBK-T". Stricter than
    // TRANSACTIONAL_SENDER above (exactly 6 chars, not "one or more") so it
    // can reliably capture the entity tag itself, not just verify the shape.
    private static final Pattern DLT_SENDER_PATTERN = Pattern.compile("^[A-Z]{2}-([A-Z]{6})-T$");

    // ---- Debit body extraction patterns (all case-insensitive) ----
    private static final Pattern[] LAST4_PATTERNS = {
            Pattern.compile("a/?c\\s*(?:no\\.?\\s*)?(?:x+|\\*+)\\s*(\\d{4})", Pattern.CASE_INSENSITIVE),
            Pattern.compile("a/?c\\s*ending\\s*(?:with\\s*)?(\\d{4})", Pattern.CASE_INSENSITIVE),
            Pattern.compile("a/?c\\s*(?:no\\.?\\s*)?(\\d{4})\\b", Pattern.CASE_INSENSITIVE),
            Pattern.compile("ending\\s*(?:with\\s*)?(\\d{4})", Pattern.CASE_INSENSITIVE),
    };
    // Package-visible (not private): reused by NotificationService so both
    // capture paths extract amount/UTR the same way instead of duplicating
    // the regex set.
    //
    // The ₹ symbol was missing here while PaymentParser.AMOUNT (used by the
    // overlay path) and the server's own parser both had it. Bank SMS writes
    // "Rs 500", so this looked fine for the path it was written for — but
    // NotificationService reuses it, and UPI apps write "Received ₹20". Every
    // one of those uploaded amount:"" and the server had to re-derive it.
    static final Pattern[] AMOUNT_PATTERNS = {
            Pattern.compile("(?:₹|rs\\.?|inr)\\s*([\\d,]+(?:\\.\\d+)?)", Pattern.CASE_INSENSITIVE),
    };
    private static final Pattern[] BALANCE_PATTERNS = {
            Pattern.compile("(?:avl\\s*bal|available\\s*balance|bal|balance)[:\\s]*(?:rs\\.?|inr)?\\s*([\\d,]+(?:\\.\\d+)?)",
                    Pattern.CASE_INSENSITIVE),
    };
    static final Pattern[] UTR_PATTERNS = {
            Pattern.compile("upi\\s*ref(?:\\s*no)?[:\\s.#]*([A-Za-z0-9]{6,})", Pattern.CASE_INSENSITIVE),
            Pattern.compile("utr[:\\s.#]*([A-Za-z0-9]{6,})", Pattern.CASE_INSENSITIVE),
            Pattern.compile("\\bref(?:erence)?(?:\\s*no)?[:\\s.#]+([A-Za-z0-9]{6,})", Pattern.CASE_INSENSITIVE),
    };

    @Override
    public void onReceive(Context context, Intent intent) {
        // First statement in the callback — the SMS half of the same delay
        // measurement NotificationService takes. See CaptureTiming.
        final long appReactionMs = System.currentTimeMillis();
        if (intent == null || !SMS_RECEIVED.equals(intent.getAction())) {
            return;
        }

        Bundle bundle = intent.getExtras();
        if (bundle == null) {
            return;
        }

        try {
            Object[] pdus = (Object[]) bundle.get("pdus");
            if (pdus == null || pdus.length == 0) {
                Log.w(TAG, "SMS_RECEIVED with no PDUs");
                return;
            }
            String format = bundle.getString("format");

            // A single SMS may arrive as multiple PDUs — concatenate the body
            // and keep the sender address + timestamp from the first part.
            String sender = "";
            StringBuilder bodyBuilder = new StringBuilder();
            long timestamp = System.currentTimeMillis();

            for (Object pdu : pdus) {
                SmsMessage msg = createFromPdu((byte[]) pdu, format);
                if (msg == null) {
                    continue;
                }
                if (sender.isEmpty() && msg.getDisplayOriginatingAddress() != null) {
                    sender = msg.getDisplayOriginatingAddress();
                }
                if (msg.getMessageBody() != null) {
                    bodyBuilder.append(msg.getMessageBody());
                }
                timestamp = msg.getTimestampMillis();
            }

            if (sender.isEmpty()) {
                sender = "Unknown";
            }
            String body = bodyBuilder.toString();

            // Banking-only filter: ignore SMS from non-bank senders entirely.
            if (!isValidBankSender(sender)) {
                Log.d(TAG, "Skipping non-bank SMS: " + sender);
                return;
            }

            // FEATURE 1 — SMS type. FEATURE 2 — sender verification.
            boolean isDebit = isDebit(body);
            boolean verifiedSender = isTransactionalSender(sender);

            if (!verifiedSender) {
                Log.w(TAG, "Non-T sender detected - possible fake: " + sender);
            }

            // DLT header check: this is additive (confidence signal + bank
            // identification), it does not change which messages get
            // processed above — isValidBankSender() remains the sole capture
            // gate so existing capture behavior is unchanged.
            String bankTag = extractDltBankTag(sender);
            if (!bankTag.isEmpty()) {
                if (BankSenderTags.KNOWN_BANK_TAGS.containsKey(bankTag)) {
                    Log.d(TAG, "DLT sender matched known bank tag " + bankTag
                            + " (" + BankSenderTags.KNOWN_BANK_TAGS.get(bankTag) + ")");
                } else {
                    Log.w(TAG, "Unrecognized DLT bank tag: " + bankTag
                            + " (sender=" + sender + ") — consider adding to BankSenderTags");
                }
            }

            // Diagnostic only — recorded for every captured SMS, debit or
            // credit, before the paths diverge below. `timestamp` here is the
            // telephony layer's own received time (SmsMessage.getTimestampMillis),
            // which is the SMS equivalent of a notification's post time.
            CaptureTiming.record(context, "SMS", sender, body,
                    firstMatch(body, AMOUNT_PATTERNS), timestamp, appReactionMs,
                    TimeFormatter.toUTC(timestamp));

            if (isDebit) {
                handleDebit(context, sender, body, timestamp, verifiedSender, bankTag);
            } else {
                // Existing behaviour: capture every non-debit SMS unchanged.
                SMSData smsData = new SMSData(sender, body, timestamp);
                smsData.source = "SMS";
                Log.d(TAG, "SMS from " + sender + " [" + smsData.category + "] "
                        + smsData.utcTime + ": " + body);
                MainActivity.addSMS(smsData);
            }

        } catch (Exception e) {
            Log.e(TAG, "SMSReceiver error", e);
        }
    }

    // ---------------------------------------------------------------------
    // Debit handling
    // ---------------------------------------------------------------------
    private void handleDebit(Context context, String sender, String body,
                             long timestamp, boolean verifiedSender, String bankTag) {
        // FEATURE 3 — extract payment details.
        String last4 = firstMatch(body, LAST4_PATTERNS);
        String amount = firstMatch(body, AMOUNT_PATTERNS);
        String balance = firstMatch(body, BALANCE_PATTERNS);
        String utr = firstMatch(body, UTR_PATTERNS);
        String receivedAt = TimeFormatter.toUTC(timestamp);

        // FEATURE 4 — structured debit object.
        DebitSMSData debit = new DebitSMSData(
                sender, body, last4, amount, balance, utr, receivedAt,
                verifiedSender, true, body, bankTag);

        Log.d(TAG, "DEBIT detected " + (verifiedSender ? "[verified]" : "[UNVERIFIED]")
                + " " + debit);

        // Item 5: a confirmed debit SMS with no extractable amount is a real
        // format gap (balance/UTR can legitimately be absent, amount can't
        // for a genuine debit alert) — log it for review instead of just
        // silently sending an empty amount field.
        if (verifiedSender && (amount == null || amount.isEmpty())) {
            ParseFailureLogger.log(context, "SMS", sender, body, "debit_sms_no_amount_matched");
        }

        // FEATURE 6 — show as a red DEBIT card in the feed.
        SMSData card = new SMSData("BANK DEBIT: " + sender, body, timestamp);
        card.source = "SMS";
        MainActivity.addSMS(card);

        // FEATURE 5 — forward verified bank debits to the backend.
        // Item 3: queue-first (Room-backed), not a direct fire-and-forget
        // POST — see EventQueue.
        if (verifiedSender) {
            queueDebit(context, debit);
        }
    }

    // ---------------------------------------------------------------------
    // Classification helpers
    // ---------------------------------------------------------------------

    /** FEATURE 1: DEBIT keywords. */
    static boolean isDebit(String body) {
        String t = body != null ? body.toLowerCase() : "";
        return t.contains("debited") || t.contains("debit") || t.contains("paid")
                || t.contains("sent") || t.contains("withdrawn");
    }

    /** FEATURE 1: CREDIT keywords (exposed for completeness / testing). */
    static boolean isCredit(String body) {
        String t = body != null ? body.toLowerCase() : "";
        return t.contains("credited") || t.contains("received") || t.contains("added");
    }

    /** Banking-only gate: true when the sender id belongs to a known bank/UPI. */
    static boolean isValidBankSender(String sender) {
        if (sender == null) {
            return false;
        }
        String u = sender.toUpperCase();
        return u.contains("HDFC")
                || u.contains("SBIN") || u.contains("SBI")
                || u.contains("ICICI")
                || u.contains("AXIS")
                || u.contains("KOTAK")
                || u.contains("PNB")
                || u.contains("PAYTM") || u.contains("PYTM")
                || u.contains("PHONEPE")
                || u.contains("YESBNK")
                || u.contains("BOB")
                || u.contains("UNION")
                || u.contains("CANARA")
                || u.contains("INDBNK")
                || u.contains("AUBANK")
                || u.contains("CENTBK")
                || u.contains("IDFCBK")
                || u.contains("AIRTEL")
                || u.contains("IDBI")
                || u.contains("FEDERAL")
                || u.contains("KARUR")
                || u.contains("SOUTH")
                || u.contains("INDIAN")
                || u.contains("NAINITAL");
    }

    /** FEATURE 2: verify the sender is a transactional "-T" bank ID. */
    static boolean isTransactionalSender(String sender) {
        if (sender == null) {
            return false;
        }
        return TRANSACTIONAL_SENDER.matcher(sender.trim().toUpperCase()).matches();
    }

    /**
     * Extracts the 6-character DLT entity tag from a sender ID matching the
     * TRAI DLT transactional header structure (^[A-Z]{2}-[A-Z]{6}-T$), or ""
     * if the sender doesn't match that structure at all. A non-empty return
     * does not imply the tag is a recognized bank — check
     * {@link BankSenderTags#KNOWN_BANK_TAGS} separately for that.
     */
    static String extractDltBankTag(String sender) {
        if (sender == null) {
            return "";
        }
        Matcher m = DLT_SENDER_PATTERN.matcher(sender.trim().toUpperCase());
        return m.matches() ? m.group(1) : "";
    }

    /** Returns the first capturing-group match across the given patterns, or "". */
    static String firstMatch(String body, Pattern[] patterns) {
        if (body == null || body.isEmpty()) {
            return "";
        }
        for (Pattern p : patterns) {
            Matcher m = p.matcher(body);
            if (m.find() && m.groupCount() >= 1 && m.group(1) != null) {
                return m.group(1).trim();
            }
        }
        return "";
    }

    // ---------------------------------------------------------------------
    // Networking (FEATURE 5)
    // ---------------------------------------------------------------------
    private void queueDebit(Context context, final DebitSMSData debit) {
        final String deviceId = getAndroidId(context);
        final String payload = buildJson(deviceId, debit);
        if (payload == null) {
            return;
        }
        // /api/apk/debit-sms keys off the deviceId field in the JSON body
        // (see ngo-backend/src/routes/apk.js) — no devicetoken header needed.
        EventQueue.enqueue(context, DEBIT_ENDPOINT_PATH, payload, false);
    }

    private static String buildJson(String deviceId, DebitSMSData debit) {
        try {
            JSONObject json = new JSONObject();
            json.put("deviceId", deviceId);
            json.put("type", "DEBIT_SMS");
            json.put("sender", debit.sender);
            json.put("body", debit.smsBody);
            json.put("last4Digits", debit.last4Digits);
            json.put("amount", debit.amount);
            json.put("utr", debit.utr == null ? "" : debit.utr);
            json.put("receivedAt", debit.receivedAt);
            json.put("isTransactionalSender", debit.isTransactionalSender);
            json.put("isVerifiedBank", debit.isTransactionalSender);
            json.put("bankTag", debit.bankTag == null ? "" : debit.bankTag);
            return json.toString();
        } catch (Exception e) {
            Log.e(TAG, "buildJson error: " + e.getMessage());
            return null;
        }
    }

    @SuppressWarnings("HardwareIds")
    private static String getAndroidId(Context context) {
        try {
            String id = Settings.Secure.getString(
                    context.getContentResolver(), Settings.Secure.ANDROID_ID);
            return id != null ? id : "";
        } catch (Exception e) {
            return "";
        }
    }

    // ---------------------------------------------------------------------
    // PDU decoding
    // ---------------------------------------------------------------------
    @SuppressWarnings("deprecation")
    private static SmsMessage createFromPdu(byte[] pdu, String format) {
        try {
            if (format != null) {
                return SmsMessage.createFromPdu(pdu, format);
            }
            return SmsMessage.createFromPdu(pdu);
        } catch (Exception e) {
            return null;
        }
    }
}
