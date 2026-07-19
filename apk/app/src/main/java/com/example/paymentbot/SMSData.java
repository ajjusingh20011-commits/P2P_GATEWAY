package com.example.paymentbot;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Data model representing a single SMS message along with derived
 * metadata such as category, formatted timestamps, and extracted amount.
 */
public class SMSData {

    public static final String CATEGORY_PAYMENT = "PAYMENT";
    public static final String CATEGORY_DEBIT = "DEBIT";
    public static final String CATEGORY_OTP = "OTP";
    public static final String CATEGORY_ALERT = "ALERT";
    public static final String CATEGORY_BANK = "BANK";
    public static final String CATEGORY_OTHER = "OTHER";

    // Matches "₹1,234.56", "Rs 1234", "Rs. 1,234.00", "INR 500", etc.
    private static final Pattern AMOUNT_PATTERN = Pattern.compile(
            "(?:₹|rs\\.?|inr)\\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\\.[0-9]{1,2})?|[0-9]+(?:\\.[0-9]{1,2})?)",
            Pattern.CASE_INSENSITIVE);

    public String sender;
    public String body;
    /** Capture source: "SMS", "NOTIFICATION", or "UNKNOWN". */
    public String source = "UNKNOWN";
    public String category;
    public String utcTime;
    public String relativeTime;
    public String displayTime;
    public String amount;
    public long timestamp;

    /**
     * Creates an SMSData instance and auto-fills all derived fields.
     *
     * @param sender    the message sender / address
     * @param body      the message body text
     * @param timestamp epoch time in milliseconds when the message arrived
     */
    public SMSData(String sender, String body, long timestamp) {
        this.sender = sender != null ? sender : "";
        this.body = body != null ? body : "";
        this.timestamp = timestamp;

        this.utcTime = TimeFormatter.toUTC(timestamp);
        this.displayTime = TimeFormatter.toDisplay(timestamp);
        this.relativeTime = TimeFormatter.toRelative(timestamp);
        this.category = categorize();
        this.amount = extractAmount();
    }

    /**
     * Classifies the message based on keywords found in the body.
     *
     * @return one of the CATEGORY_* constants
     */
    public String categorize() {
        String text = body != null ? body.toLowerCase() : "";

        // DEBIT (outgoing money) is checked first: a debit SMS also frequently
        // contains "₹", which would otherwise fall through to PAYMENT below.
        if (text.contains("debited") || text.contains("debit")
                || text.contains("withdrawn") || text.contains("paid")
                || text.contains("sent")) {
            return CATEGORY_DEBIT;
        }
        // CREDIT / incoming payment.
        if (text.contains("received") || text.contains("credited")
                || text.contains("added") || text.contains("₹")) {
            return CATEGORY_PAYMENT;
        }
        if (text.contains("otp") || text.contains("one time") || text.contains("password")) {
            return CATEGORY_OTP;
        }
        if (text.contains("fraud") || text.contains("block") || text.contains("suspicious")) {
            return CATEGORY_ALERT;
        }
        if (text.contains("balance") || text.contains("account") || text.contains("avl")) {
            return CATEGORY_BANK;
        }
        return CATEGORY_OTHER;
    }

    /**
     * Extracts a monetary amount from the body using a regex that looks for
     * ₹ or Rs / INR prefixed numbers.
     *
     * @return the matched amount string (digits only, e.g. "1,234.56"),
     *         or an empty string if none found
     */
    public String extractAmount() {
        if (body == null || body.isEmpty()) {
            return "";
        }
        Matcher matcher = AMOUNT_PATTERN.matcher(body);
        if (matcher.find()) {
            return matcher.group(1);
        }
        return "";
    }

    @Override
    public String toString() {
        return "SMSData{"
                + "sender='" + sender + '\''
                + ", category='" + category + '\''
                + ", amount='" + amount + '\''
                + ", displayTime='" + displayTime + '\''
                + ", body='" + body + '\''
                + '}';
    }
}
