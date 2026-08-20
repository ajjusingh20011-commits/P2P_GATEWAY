package com.example.paymentbot;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Pure extractor for a payment app's SUCCESS screen, run ONLY when the trader
 * taps Capture (never passively — see PayoutOverlayService.onScreenshotTap).
 *
 * Extracts whatever real fields the specific app actually shows — amount,
 * transaction time, the sender's (trader's) paying bank, any last-4 account
 * digits on either side, the recipient name (or their last-4 if the name isn't
 * shown), a transaction id, and the UTR. Same tiered-confidence principle used
 * elsewhere tonight: capture what's genuinely present, never fabricate a field
 * that isn't on the screen (absent fields come back as "" / an empty list).
 *
 * Kept pure + package-visible so SuccessScreenParserTest can exercise real
 * app-format samples directly, no device.
 */
public final class SuccessScreenParser {

    private SuccessScreenParser() {
    }

    private static final Pattern AMOUNT = Pattern.compile(
            "(?:₹|rs\\.?|inr)\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)", Pattern.CASE_INSENSITIVE);
    private static final Pattern RECIPIENT = Pattern.compile(
            "(?i)(?:paid to|sent to|transferred to|to)\\s+([A-Za-z][A-Za-z .'&-]{1,40}?)(?=\\s*(?:\\bon\\b|\\bat\\b|₹|rs\\.?|inr|[0-9]{2}|\\n|$))");
    // Masked account last-4: "xxxx1234", "A/c XX1234", "...1234".
    private static final Pattern LAST4 = Pattern.compile(
            "(?i)(?:a/?c(?:count)?\\s*(?:no\\.?)?\\s*[:#]?\\s*)?[Xx*.]{2,}\\s*([0-9]{4})\\b");
    private static final Pattern UTR = Pattern.compile(
            "(?i)\\butr\\b[:\\s.#no]*([A-Za-z0-9]{8,})");
    private static final Pattern TXN_ID = Pattern.compile(
            "(?i)(?:transaction\\s*id|txn\\s*id|order\\s*id|upi\\s*(?:ref(?:erence)?|txn|transaction)\\s*(?:id|no|number)?|reference\\s*(?:id|no|number)?)[:\\s.#]*([A-Za-z0-9]{6,})");
    // Time-of-day, optionally with a preceding date the app shows ("20 Aug 2026, 3:45 PM").
    private static final Pattern TIME = Pattern.compile(
            "(?i)((?:\\d{1,2}\\s+[A-Za-z]{3,9}\\s+\\d{2,4}[, ]+)?\\d{1,2}:\\d{2}(?::\\d{2})?\\s*(?:[ap]\\.?m\\.?)?)");
    // Sender/paying bank — either "from/via/using <X> Bank", or a known bank name.
    private static final Pattern FROM_BANK = Pattern.compile(
            "(?i)(?:from|via|using|debited from|paid using)\\s+([A-Za-z][A-Za-z .&]{2,30}?\\bbank\\b)");
    private static final String[] KNOWN_BANKS = {
            "HDFC", "State Bank of India", "SBI", "ICICI", "Axis", "Kotak", "Punjab National",
            "PNB", "Bank of Baroda", "Canara", "Union Bank", "IndusInd", "IDFC", "Yes Bank",
            "RBL", "Federal", "IDBI", "Bandhan", "AU Small Finance", "Paytm Payments",
            "Airtel Payments", "Central Bank", "UCO", "Indian Overseas",
    };

    private static String first(Pattern p, String text) {
        Matcher m = p.matcher(text == null ? "" : text);
        return m.find() ? m.group(1).trim() : "";
    }

    // Package-visible raw extractors — pure String/List, no org.json, so
    // SuccessScreenParserTest can run on the JVM without the (stubbed) android
    // org.json. parse() below composes these into the JSON the device uploads.
    static String amount(String text) { return cleanAmount(first(AMOUNT, text)); }
    static String recipientName(String text) {
        String n = first(RECIPIENT, text).trim();
        String low = n.toLowerCase();
        // "Paid to account XXXX7788" / "to bank" / a masked account — a generic
        // token, not a real payee name. Treat as no-name so the last-4 fallback
        // is used. [xX*]{3,} catches masked-account text captured as a "name"
        // (real names don't contain 3+ mask chars).
        if (low.startsWith("account") || low.startsWith("a/c") || low.startsWith("ac ")
                || low.equals("bank") || low.startsWith("upi") || low.equals("self")
                || n.matches(".*[xX*]{3,}.*")) {
            return "";
        }
        return n;
    }
    static String utr(String text) { return first(UTR, text); }
    static String transactionId(String text) { return first(TXN_ID, text); }
    static String transactionTime(String text) { return first(TIME, text); }

    static String senderBank(String text) {
        String m = first(FROM_BANK, text);
        if (!m.isEmpty()) return m.replaceAll("\\s+", " ").trim();
        String lower = (text == null ? "" : text).toLowerCase();
        for (String b : KNOWN_BANKS) {
            if (lower.contains(b.toLowerCase())) return b;
        }
        return "";
    }

    static java.util.List<String> last4List(String text) {
        Set<String> out = new LinkedHashSet<>();
        Matcher m = LAST4.matcher(text == null ? "" : text);
        while (m.find()) out.add(m.group(1));
        return new java.util.ArrayList<>(out);
    }

    /**
     * @param pkg  the foreground package the trader tapped Capture in
     * @param text the current on-screen text (from the accessibility node tree,
     *             read once at tap time — never streamed/watched)
     * @return the fields actually present; missing ones are "" / empty.
     */
    public static JSONObject parse(String pkg, String text) {
        JSONObject o = new JSONObject();
        String t = text == null ? "" : text;
        try {
            o.put("sourceApp", pkg == null ? "" : pkg);
            o.put("amount", amount(t));
            o.put("transactionTime", transactionTime(t));    // as shown on the screen, if any
            o.put("senderBank", senderBank(t));              // the trader's own paying bank
            java.util.List<String> last4 = last4List(t);
            o.put("last4", new JSONArray(last4));            // whichever side(s) are shown
            String recipient = recipientName(t);
            o.put("recipientName", recipient);
            // Recipient's last-4 fallback when the name isn't shown.
            o.put("recipientLast4", recipient.isEmpty() && !last4.isEmpty() ? last4.get(last4.size() - 1) : "");
            o.put("transactionId", transactionId(t));
            o.put("utr", utr(t));
            o.put("capturedFrom", "CAPTURE_TAP");            // provenance: trader-initiated only
        } catch (Exception ignored) {
        }
        return o;
    }

    private static String cleanAmount(String a) {
        return a == null ? "" : a.replace(",", "").trim();
    }
}
