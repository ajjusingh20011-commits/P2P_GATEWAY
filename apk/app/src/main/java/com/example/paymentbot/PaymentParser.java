package com.example.paymentbot;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Regex-based extractor for Indian UPI payment text. Shared by all three
 * engines so SMS, notifications and on-screen text are parsed identically.
 *
 * Handles:
 *   Amount  : ₹500, Rs.500, Rs 500, INR 500, 500.00
 *   Sender  : "from X", "by X", "paid by X", "received from X"
 *   UTR/RRN : "UTR:", "RRN:", "Txn ID:", "Ref No:"
 *   UPI ID  : anything containing '@'
 *   Status  : received / credited / success / failed / declined
 *   Mode    : UPI / IMPS / NEFT / RTGS
 */
public final class PaymentParser {

    private PaymentParser() { }

    private static final Pattern AMOUNT = Pattern.compile(
            "(?:(?:₹|rs\\.?|inr)\\s*)([0-9]{1,3}(?:,[0-9]{2,3})*(?:\\.[0-9]{1,2})?|[0-9]+(?:\\.[0-9]{1,2})?)",
            Pattern.CASE_INSENSITIVE);

    // Fallback: a bare number that looks like an amount when no currency symbol is present.
    private static final Pattern AMOUNT_BARE = Pattern.compile(
            "\\b([0-9]{1,3}(?:,[0-9]{2,3})+(?:\\.[0-9]{1,2})?|[0-9]+\\.[0-9]{2})\\b");

    private static final Pattern SENDER = Pattern.compile(
            "(?:received\\s+from|paid\\s+by|from|by)\\s+([A-Za-z][A-Za-z0-9 ._@-]{1,39})",
            Pattern.CASE_INSENSITIVE);

    private static final Pattern UTR = Pattern.compile(
            "(?:utr|rrn|txn(?:\\.|\\s)?id|transaction\\s*id|ref(?:erence)?\\s*(?:no|id|number)?)\\s*[:#-]?\\s*([A-Za-z0-9]{6,25})",
            Pattern.CASE_INSENSITIVE);

    private static final Pattern UPI_ID = Pattern.compile(
            "([a-zA-Z0-9][a-zA-Z0-9._-]{1,}@[a-zA-Z][a-zA-Z0-9.-]{1,})");

    private static final Pattern MODE = Pattern.compile(
            "\\b(UPI|IMPS|NEFT|RTGS)\\b", Pattern.CASE_INSENSITIVE);

    public static String parseAmount(String text) {
        if (text == null) return "";
        Matcher m = AMOUNT.matcher(text);
        if (m.find()) return clean(m.group(1));
        Matcher b = AMOUNT_BARE.matcher(text);
        if (b.find()) return clean(b.group(1));
        return "";
    }

    public static String parseSender(String text) {
        if (text == null) return "";
        Matcher m = SENDER.matcher(text);
        if (m.find()) {
            String s = m.group(1).trim();
            // Trim trailing noise words that regex may greedily grab.
            s = s.replaceAll("(?i)\\s+(has|is|was|on|for|of|to|via|using)\\b.*$", "").trim();
            return s;
        }
        return "";
    }

    public static String parseUtr(String text) {
        if (text == null) return "";
        Matcher m = UTR.matcher(text);
        return m.find() ? m.group(1).trim() : "";
    }

    public static String parseUpiId(String text) {
        if (text == null) return "";
        Matcher m = UPI_ID.matcher(text);
        return m.find() ? m.group(1).trim() : "";
    }

    public static String parseStatus(String text) {
        if (text == null) return "";
        String t = text.toLowerCase();
        if (t.contains("failed") || t.contains("declined") || t.contains("unsuccessful")) return "failed";
        if (t.contains("received") || t.contains("credited") || t.contains("success")
                || t.contains("added to") || t.contains("payment of")) return "received";
        return "";
    }

    public static String parseMode(String text) {
        if (text == null) return "";
        Matcher m = MODE.matcher(text);
        return m.find() ? m.group(1).toUpperCase() : "";
    }

    private static String clean(String amount) {
        return amount == null ? "" : amount.replace(",", "").trim();
    }

    /**
     * Parse a full block of text into a {@link PaymentData}. The caller is
     * responsible for setting the {@code capturedBy*} flag and the app label.
     */
    public static PaymentData parse(String rawText, String app) {
        PaymentData d = new PaymentData();
        d.setApp(app == null ? "" : app);
        d.setRawText(rawText == null ? "" : rawText);
        d.setAmount(parseAmount(rawText));
        d.setSender(parseSender(rawText));
        d.setUtr(parseUtr(rawText));
        d.setUpiId(parseUpiId(rawText));
        d.setStatus(parseStatus(rawText));
        d.setMode(parseMode(rawText));
        return d;
    }
}
