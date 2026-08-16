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

    // The shape a real bank header actually takes in the wild, used as the
    // capture gate (BUG-38). Deliberately wider than DLT_SENDER_PATTERN above,
    // which only ever matched the textbook form: real headers carry 2-4
    // character circle prefixes and 4-9 character entity codes, and the
    // category suffix is often -S (service) rather than -T, or absent
    // entirely. The one real ICICI sender in our own database,
    // "ICIC-ICICIBK-T", has a 4-character prefix and a 7-character code and so
    // matched nothing at all under the old pattern.
    private static final Pattern DLT_HEADER = Pattern.compile("^[A-Z]{2,4}-([A-Z0-9]{4,9})(?:-([TSPG]))?$");

    // Action/scam fragments that turn a real bank fragment into a lookalike an
    // attacker controls (SBIKYC, AXISVERIFY, HDFCBLOCK). A DLT code carrying one
    // is rejected even though it also carries a bank fragment. These are NOT
    // bank fragments — checked separately, only after a bank match succeeds.
    private static final String[] NEGATIVE_CODE_KEYWORDS = {
            "KYC", "VERIFY", "BLOCK", "SUSPEND", "UNLOCK", "UPDATE", "ALERT",
    };

    // Any form of plain phone number Android may hand us as the originating
    // address. A transactional bank alert never comes from one.
    private static final Pattern PHONE_SENDER = Pattern.compile("^(?:\\+?91[- ]?|0)?[6-9][0-9]{9}$|^[0-9]{3,15}$");

    // Secondary content signals a genuine bank alert carries: a reference the
    // trader could reconcile against, and the masked account it landed in.
    // Used ALONGSIDE the sender check, never instead of it.
    private static final Pattern MASKED_ACCOUNT = Pattern.compile(
            "(?:a/?c|acct|account)[^0-9a-z]{0,12}(?:x+|\\*+)?\\s*\\d{3,4}\\b", Pattern.CASE_INSENSITIVE);

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

            // Source check first: who it is from, which wording cannot fake.
            // Evaluate once so a reject can be logged with its reason + code.
            GateResult gate = evaluateSender(sender);
            if (!gate.accepted()) {
                Log.d(TAG, "Skipping SMS — gate rejected (" + gate.reason + ") sender=" + sender);
                // Rejection-review log: sender ID + extracted DLT code + reason
                // + timestamp ONLY — never the message body. Used to expand the
                // bank-fragment list from real traffic. Only senders that reached
                // the bank check (a valid DLT shape) carry a code worth reviewing.
                if (!gate.code.isEmpty()) {
                    RejectedSmsLog.record(context, sender, gate.code, gate.reason.name());
                }
                return;
            }

            // Then the corroborating content check. A message from a genuine
            // bank header that carries neither a reference nor a masked
            // account is not a payment alert — it is an OTP, a marketing push
            // or a service notice, and it has no business reaching the
            // classifier or the trader's feed.
            if (!hasBankMessageMarkers(body)) {
                Log.d(TAG, "Skipping SMS from " + sender + " — no UTR/reference and no masked account number");
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
                // Unchanged trigger/shape for -T: a debit-classified body
                // always reached handleDebit before FEATURE 1 too. What
                // changed is INSIDE handleDebit (below) — it used to push
                // only for verifiedSender (-T); the sender gate above
                // already excludes phone numbers, unknown banks, lookalikes
                // and -P promotional, so -S/-G/no-suffix debits reaching
                // here are exactly FEATURE 1's content-push case.
                handleDebit(context, sender, body, timestamp, verifiedSender, bankTag);
            } else {
                // Existing behaviour: capture every non-debit SMS unchanged.
                SMSData smsData = new SMSData(sender, body, timestamp);
                smsData.source = "SMS";
                Log.d(TAG, "SMS from " + sender + " [" + smsData.category + "] "
                        + smsData.utcTime + ": " + body);
                MainActivity.addSMS(smsData);

                // FEATURE 1 — push on any real signal (CREDIT/OTP/
                // PAYMENT_REFERENCE), regardless of suffix. A -T body that's
                // genuinely INFO still pushes, tagged TRANSACTIONAL (sender
                // already highest-trust). A non-T INFO body stays
                // local-only, unchanged from before this feature.
                String type = classifyMessageBody(body);
                if (!"INFO".equals(type)) {
                    pushClassified(context, sender, body, timestamp, type);
                } else if (verifiedSender) {
                    pushClassified(context, sender, body, timestamp, "TRANSACTIONAL");
                }
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

        // FEATURE 6 — show as a red DEBIT card in the feed.
        SMSData card = new SMSData("BANK DEBIT: " + sender, body, timestamp);
        card.source = "SMS";
        MainActivity.addSMS(card);

        // FEATURE 2 (Payout evidence) — a debit arriving while a payout is
        // active is evidence FOR that payout, not an independent event: hold
        // it against the active payout instead of pushing it separately.
        if (PayoutState.isActive(context)) {
            PayoutState.linkDebitSms(context, sender, body, timestamp);
            return;
        }

        // FEATURE 5 — forward every debit that reached here (Item 3:
        // queue-first, Room-backed — see EventQueue). Previously gated on
        // verifiedSender/-T only; FEATURE 1 content-push now pushes
        // -S/-G/no-suffix debits too — the sender gate in onReceive already
        // excludes anything not a real, non-promotional bank sender.
        queueDebit(context, debit, "DEBIT");
    }

    // ---------------------------------------------------------------------
    // Classification helpers
    // ---------------------------------------------------------------------

    /**
     * FEATURE 1: DEBIT — a debit/spend keyword AND an extractable amount.
     * The amount requirement means a "debited"-mention with no number
     * doesn't reach here as a debit (see classifyMessageBody below, which
     * would still catch it as PAYMENT_REFERENCE or fall through to INFO).
     * Single definition — classifyMessageBody() calls this directly rather
     * than keeping a second, divergent keyword list.
     */
    static boolean isDebit(String body) {
        String t = body != null ? body.toLowerCase() : "";
        boolean keyword = t.contains("debited") || t.contains("spent")
                || t.contains("withdrawn") || t.contains("paid") || t.contains("debit of");
        return keyword && !firstMatch(body, AMOUNT_PATTERNS).isEmpty();
    }

    /**
     * FEATURE 1: CREDIT — previously defined but never called anywhere
     * (dead code, no test covered it); now wired into classifyMessageBody()
     * the same way as isDebit() above.
     */
    static boolean isCredit(String body) {
        String t = body != null ? body.toLowerCase() : "";
        boolean keyword = t.contains("credited") || t.contains("received") || t.contains("credit of");
        return keyword && !firstMatch(body, AMOUNT_PATTERNS).isEmpty();
    }

    // Bare 4-8 digit run — the OTP code itself. Word boundaries so it
    // doesn't match inside a longer digit run (e.g. an account number).
    private static final Pattern OTP_CODE_PATTERN = Pattern.compile("\\b(\\d{4,8})\\b");

    /** FEATURE 1: OTP — the word "OTP" plus a standalone 4-8 digit code. */
    static boolean isOtp(String body) {
        if (body == null) return false;
        return body.toLowerCase().contains("otp") && OTP_CODE_PATTERN.matcher(body).find();
    }

    // Bare masked-account form, no "a/c" prefix required (unlike
    // MASKED_ACCOUNT above, which gates hasBankMessageMarkers and stays
    // untouched) — "xx1234", "xxxx1234", "x1234", "XX8812".
    private static final Pattern MASKED_ACCOUNT_ANY = Pattern.compile("\\b[xX]{1,4}\\d{3,4}\\b");

    // "Ref No"/"Reference No"/"UTR"/"RRN"/"Txn ID"/"Transaction ID" followed
    // by digits — broader than UTR_PATTERNS (which extracts the reference
    // VALUE for the debit payload); this only needs to detect PRESENCE.
    private static final Pattern PAYMENT_REFERENCE_PATTERN = Pattern.compile(
            "(?:ref\\s*no|reference\\s*no|utr|rrn|txn\\s*id|transaction\\s*id)[:\\s.#]*\\d+",
            Pattern.CASE_INSENSITIVE);

    /**
     * FEATURE 1 follow-up: PAYMENT_REFERENCE — a masked account number or a
     * transaction reference pattern, even without a debit/credit/OTP
     * keyword. Catches real bank content that doesn't cleanly say
     * "debited"/"credited" (e.g. "Ref No 623910842019 for A/c xx3902").
     */
    static boolean hasPaymentReference(String body) {
        if (body == null || body.isEmpty()) return false;
        return MASKED_ACCOUNT_ANY.matcher(body).find()
                || PAYMENT_REFERENCE_PATTERN.matcher(body).find();
    }

    /**
     * FEATURE 1 — single classification point for the content-based push
     * decision (onReceive) and the "type" field every push now carries.
     * Order: DEBIT, then CREDIT, then OTP, then PAYMENT_REFERENCE (catches
     * messages with account/ref patterns that don't cleanly match the other
     * three), else INFO.
     */
    static String classifyMessageBody(String body) {
        if (isDebit(body)) return "DEBIT";
        if (isCredit(body)) return "CREDIT";
        if (isOtp(body)) return "OTP";
        if (hasPaymentReference(body)) return "PAYMENT_REFERENCE";
        return "INFO";
    }

    /**
     * Banking-only gate — now structural first, name second (BUG-38).
     *
     * A real bank alert always arrives from a TRAI DLT header: a short
     * carrier/circle prefix, a hyphen, the registered entity code, and
     * optionally a category suffix (-T transactional, -S service, -P
     * promotional, -G government). It NEVER arrives from a plain phone number.
     *
     * The old gate was a substring test alone, so anything merely CONTAINING a
     * bank's name passed — "HDFCBANKOFFERS", or a personal number whose
     * contact name mentioned a bank. Someone texting fake "payment received"
     * wording from an ordinary number is a real risk, and no amount of text
     * classification can catch it, because the text is genuinely well-formed.
     * Checking who it is from is the part that cannot be faked by wording.
     */
    static boolean isValidBankSender(String sender) {
        return evaluateSender(sender).accepted();
    }

    /**
     * The verdict of the capture gate and WHY it reached it — so onReceive can
     * log a reject (sender + code + reason) for later fragment-list tuning.
     */
    static final class GateResult {
        enum Reason { ACCEPT, NOT_DLT_SHAPE, PHONE_NUMBER, UNKNOWN_BANK, NEGATIVE_KEYWORD, PROMOTIONAL }
        final Reason reason;
        /** Extracted DLT entity code, or "" when the shape didn't match. */
        final String code;
        /** Category suffix: "S", "T", "P", "G", or "" when absent. */
        final String suffix;
        GateResult(Reason reason, String code, String suffix) {
            this.reason = reason;
            this.code = code == null ? "" : code;
            this.suffix = suffix == null ? "" : suffix;
        }
        boolean accepted() {
            return reason == Reason.ACCEPT;
        }
    }

    /**
     * Evaluate a sender against the banking-only capture gate. Pure — no
     * Android, no Context — which is exactly what the unit tests exercise; the
     * on-device rejection logging lives in onReceive, which holds the Context.
     *
     * Order: reject phone numbers, require the TRAI DLT header shape, then
     * require a known bank NAME FRAGMENT in the entity code, then reject
     * action/scam lookalikes (SBIKYC), then reject promotional (-P) senders
     * even for a genuine bank.
     *
     * NOTE (scope): this validates the SENDER only. Content-level checks — in
     * particular a domain allowlist for messages that contain LINKS/URLs — are
     * a SEPARATE follow-up and are deliberately NOT done in this pass. A
     * genuine-looking header (e.g. JX-AXISBK-S) passes here; catching a phishing
     * body that arrives from such a header is that follow-up's job, not this
     * gate's.
     */
    static GateResult evaluateSender(String sender) {
        if (sender == null) {
            return new GateResult(GateResult.Reason.NOT_DLT_SHAPE, "", "");
        }
        String u = sender.trim().toUpperCase();

        // Reject outright: a phone number in any of the forms Android hands us
        // (10-digit, +91-prefixed, 0-prefixed, spaced). Real transactional bank
        // SMS cannot come from one.
        if (PHONE_SENDER.matcher(u).matches()) {
            return new GateResult(GateResult.Reason.PHONE_NUMBER, "", "");
        }

        // Require the DLT header shape; take the entity code and category suffix.
        Matcher header = DLT_HEADER.matcher(u);
        if (!header.matches()) {
            return new GateResult(GateResult.Reason.NOT_DLT_SHAPE, "", "");
        }
        String code = header.group(1);
        String suffix = header.group(2) == null ? "" : header.group(2);

        // Bank test: a known bank NAME FRAGMENT appears anywhere in the code.
        // Substring, not exact code — so every registered variant of a bank
        // (IDFC as IDFCB and IDFCFB, SBI as SBIBNK/SBIUPI/…) is covered from one
        // fragment. This REPLACES the old exact-match against KNOWN_BANK_TAGS,
        // which caught only the specific codes someone had already seen and so
        // dropped real senders like VM-IDFCB-T.
        if (!containsBankName(code)) {
            return new GateResult(GateResult.Reason.UNKNOWN_BANK, code, suffix);
        }

        // Negative-keyword guard: a real bank fragment PLUS an action word is a
        // lookalike an attacker registered (SBIKYC, AXISVERIFY, HDFCBLOCK).
        if (hasNegativeKeyword(code)) {
            return new GateResult(GateResult.Reason.NEGATIVE_KEYWORD, code, suffix);
        }

        // Promotional (-P) senders are marketing, not payment alerts — reject
        // even for a genuine bank. -S (service), -T (transactional) and no
        // suffix all proceed; only -T later forwards as a verified debit
        // (isTransactionalSender), which is unchanged.
        if ("P".equals(suffix)) {
            return new GateResult(GateResult.Reason.PROMOTIONAL, code, suffix);
        }

        return new GateResult(GateResult.Reason.ACCEPT, code, suffix);
    }

    /**
     * True when the DLT entity {@code code} contains any known bank-name
     * fragment ({@link BankSenderTags#BANK_NAME_FRAGMENTS}). Substring match on
     * the code only — never the message body.
     */
    private static boolean containsBankName(String code) {
        if (code == null) {
            return false;
        }
        for (String fragment : BankSenderTags.BANK_NAME_FRAGMENTS) {
            if (code.contains(fragment)) {
                return true;
            }
        }
        return false;
    }

    /**
     * True when the code carries an action/scam keyword (KYC, VERIFY, BLOCK,
     * SUSPEND, UNLOCK, UPDATE, ALERT). Applied only AFTER a bank fragment
     * matched, to reject lookalikes like SBIKYC that borrow a real bank name.
     */
    private static boolean hasNegativeKeyword(String code) {
        if (code == null) {
            return false;
        }
        for (String keyword : NEGATIVE_CODE_KEYWORDS) {
            if (code.contains(keyword)) {
                return true;
            }
        }
        return false;
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

    /**
     * True when the body carries at least one marker a real bank alert has and
     * a fabricated one usually doesn't: a UTR/reference, or a masked account
     * number.
     *
     * At least one, not both, on purpose: banks are inconsistent about which
     * they include, and a message that names a masked account but no reference
     * is still clearly a bank's own alert. Requiring both would reject real
     * payments, which costs a settlement — the far more expensive error of the
     * two. The sender check is what actually establishes authenticity; this is
     * the corroborating signal.
     */
    static boolean hasBankMessageMarkers(String body) {
        if (body == null || body.isEmpty()) {
            return false;
        }
        return !firstMatch(body, UTR_PATTERNS).isEmpty() || MASKED_ACCOUNT.matcher(body).find();
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
    private void queueDebit(Context context, final DebitSMSData debit, String type) {
        final String deviceId = getAndroidId(context);
        final String payload = buildJson(deviceId, debit, type);
        if (payload == null) {
            return;
        }
        // /api/apk/debit-sms keys off the deviceId field in the JSON body
        // (see ngo-backend/src/routes/apk.js) — no devicetoken header needed.
        EventQueue.enqueue(context, DEBIT_ENDPOINT_PATH, payload, false);
    }

    /**
     * FEATURE 1 — content-based push for CREDIT/OTP/PAYMENT_REFERENCE/
     * TRANSACTIONAL (DEBIT keeps using queueDebit/buildJson above, unchanged
     * shape). Reuses the existing /api/apk/event ingestion endpoint already
     * used by NotificationService/APIClient/WebLoginActivity — CATEGORY.
     * PAYMENT here is what makes a CREDIT SMS eligible for matchingEngineV2
     * the same way an incoming-payment notification already is; the other
     * three types are visibility-only (CATEGORY.OTP / CATEGORY.BANK).
     */
    private void pushClassified(Context context, String sender, String body,
                                long timestamp, String type) {
        String category;
        switch (type) {
            case "CREDIT": category = "PAYMENT"; break;
            case "OTP": category = "OTP"; break;
            default: category = "BANK"; break; // TRANSACTIONAL, PAYMENT_REFERENCE
        }
        try {
            JSONObject json = new JSONObject();
            json.put("type", "SMS");
            json.put("sender", sender);
            json.put("body", body);
            json.put("category", category);
            json.put("amount", firstMatch(body, AMOUNT_PATTERNS));
            json.put("utr", firstMatch(body, UTR_PATTERNS));
            json.put("utcTimestamp", TimeFormatter.toUTC(timestamp));
            EventQueue.enqueue(context, "/api/apk/event", json.toString(), true);
        } catch (Exception e) {
            Log.e(TAG, "pushClassified buildJson error: " + e.getMessage());
        }
    }

    private static String buildJson(String deviceId, DebitSMSData debit, String type) {
        try {
            JSONObject json = new JSONObject();
            json.put("deviceId", deviceId);
            json.put("type", type);
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
