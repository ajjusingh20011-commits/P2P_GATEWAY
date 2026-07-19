package com.example.paymentbot;

/**
 * Smart merge across the three detection engines.
 *
 * For each field it picks the best available value (first non-empty, with a
 * defined engine priority for conflicts). Confidence is additive per engine
 * that contributed a usable capture:
 *   SMS = 30%, Notification = 40%, Screen = 30%  (capped at 100%).
 */
public final class PaymentMerger {

    public static final int WEIGHT_SMS = 30;
    public static final int WEIGHT_NOTIFICATION = 40;
    public static final int WEIGHT_SCREEN = 30;

    private PaymentMerger() { }

    /**
     * Merge any combination of engine captures. Nulls are ignored.
     * Screen data is treated as most authoritative for numeric fields, then
     * notification, then SMS — but any non-empty value wins over an empty one.
     */
    public static PaymentData merge(PaymentData sms, PaymentData notification, PaymentData screen) {
        PaymentData out = new PaymentData();

        // Priority order for "best value": screen > notification > sms.
        PaymentData[] byPriority = { screen, notification, sms };

        out.setApp(firstNonEmpty(pick(byPriority, Field.APP)));
        out.setAmount(firstNonEmpty(pick(byPriority, Field.AMOUNT)));
        out.setSender(firstNonEmpty(pick(byPriority, Field.SENDER)));
        out.setUtr(firstNonEmpty(pick(byPriority, Field.UTR)));
        out.setUpiId(firstNonEmpty(pick(byPriority, Field.UPI)));
        out.setStatus(firstNonEmpty(pick(byPriority, Field.STATUS)));
        out.setMode(firstNonEmpty(pick(byPriority, Field.MODE)));

        // Keep the richest raw text (usually the screen capture).
        out.setRawText(firstNonEmpty(new String[]{
                screen != null ? screen.getRawText() : "",
                notification != null ? notification.getRawText() : "",
                sms != null ? sms.getRawText() : ""
        }));

        // Earliest timestamp = when the payment was first seen.
        long ts = Long.MAX_VALUE;
        if (sms != null) ts = Math.min(ts, sms.getTimestamp());
        if (notification != null) ts = Math.min(ts, notification.getTimestamp());
        if (screen != null) ts = Math.min(ts, screen.getTimestamp());
        out.setTimestamp(ts == Long.MAX_VALUE ? System.currentTimeMillis() : ts);

        // Engine flags.
        boolean bySms = sms != null;
        boolean byNotif = notification != null;
        boolean byScreen = screen != null;
        out.setCapturedBySMS(bySms);
        out.setCapturedByNotification(byNotif);
        out.setCapturedByScreen(byScreen);

        // Additive confidence, capped at 100.
        int conf = 0;
        if (bySms) conf += WEIGHT_SMS;
        if (byNotif) conf += WEIGHT_NOTIFICATION;
        if (byScreen) conf += WEIGHT_SCREEN;
        out.setConfidence(Math.min(100, conf));

        return out;
    }

    /** Convenience for a single-engine capture (still computes confidence). */
    public static PaymentData single(PaymentData d) {
        if (d == null) return new PaymentData();
        return merge(
                d.isCapturedBySMS() ? d : null,
                d.isCapturedByNotification() ? d : null,
                d.isCapturedByScreen() ? d : null
        );
    }

    private enum Field { APP, AMOUNT, SENDER, UTR, UPI, STATUS, MODE }

    private static String[] pick(PaymentData[] sources, Field f) {
        String[] values = new String[sources.length];
        for (int i = 0; i < sources.length; i++) {
            values[i] = sources[i] == null ? "" : valueOf(sources[i], f);
        }
        return values;
    }

    private static String valueOf(PaymentData d, Field f) {
        switch (f) {
            case APP: return d.getApp();
            case AMOUNT: return d.getAmount();
            case SENDER: return d.getSender();
            case UTR: return d.getUtr();
            case UPI: return d.getUpiId();
            case STATUS: return d.getStatus();
            case MODE: return d.getMode();
            default: return "";
        }
    }

    private static String firstNonEmpty(String[] values) {
        for (String v : values) {
            if (v != null && !v.trim().isEmpty()) return v.trim();
        }
        return "";
    }
}
