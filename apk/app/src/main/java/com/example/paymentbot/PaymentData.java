package com.example.paymentbot;

/**
 * Immutable-ish value object describing a single detected UPI payment.
 *
 * A payment can be captured by any combination of the three engines
 * (SMS / Notification / Screen). The {@code capturedBy*} flags record which
 * engines contributed, and {@link #confidence} is the merged score computed by
 * {@link PaymentMerger}.
 */
public class PaymentData {

    private String app = "";
    private String amount = "";
    private String sender = "";
    private String utr = "";
    private String upiId = "";
    private String status = "";
    private String mode = "";
    private String rawText = "";
    private long timestamp = System.currentTimeMillis();
    private int confidence = 0;
    private boolean capturedBySMS = false;
    private boolean capturedByNotification = false;
    private boolean capturedByScreen = false;

    public PaymentData() {
    }

    // ----- getters -----------------------------------------------------------
    public String getApp() { return app; }
    public String getAmount() { return amount; }
    public String getSender() { return sender; }
    public String getUtr() { return utr; }
    public String getUpiId() { return upiId; }
    public String getStatus() { return status; }
    public String getMode() { return mode; }
    public String getRawText() { return rawText; }
    public long getTimestamp() { return timestamp; }
    public int getConfidence() { return confidence; }
    public boolean isCapturedBySMS() { return capturedBySMS; }
    public boolean isCapturedByNotification() { return capturedByNotification; }
    public boolean isCapturedByScreen() { return capturedByScreen; }

    // ----- setters -----------------------------------------------------------
    public void setApp(String app) { this.app = safe(app); }
    public void setAmount(String amount) { this.amount = safe(amount); }
    public void setSender(String sender) { this.sender = safe(sender); }
    public void setUtr(String utr) { this.utr = safe(utr); }
    public void setUpiId(String upiId) { this.upiId = safe(upiId); }
    public void setStatus(String status) { this.status = safe(status); }
    public void setMode(String mode) { this.mode = safe(mode); }
    public void setRawText(String rawText) { this.rawText = safe(rawText); }
    public void setTimestamp(long timestamp) { this.timestamp = timestamp; }
    public void setConfidence(int confidence) { this.confidence = Math.max(0, Math.min(100, confidence)); }
    public void setCapturedBySMS(boolean v) { this.capturedBySMS = v; }
    public void setCapturedByNotification(boolean v) { this.capturedByNotification = v; }
    public void setCapturedByScreen(boolean v) { this.capturedByScreen = v; }

    private static String safe(String s) { return s == null ? "" : s.trim(); }

    private static boolean has(String s) { return s != null && !s.trim().isEmpty(); }

    /**
     * A payment is considered usable once we have an amount plus at least one
     * identifying field (UTR, UPI id or sender).
     */
    public boolean isValid() {
        return has(amount) && (has(utr) || has(upiId) || has(sender));
    }

    /** Human-readable summary of which engines contributed. */
    public String enginesLabel() {
        StringBuilder sb = new StringBuilder();
        if (capturedBySMS) sb.append("SMS ");
        if (capturedByNotification) sb.append("Notification ");
        if (capturedByScreen) sb.append("Screen ");
        String s = sb.toString().trim();
        return s.isEmpty() ? "None" : s.replace(' ', '+');
    }

    @Override
    public String toString() {
        return "PaymentData{" +
                "app='" + app + '\'' +
                ", amount='" + amount + '\'' +
                ", sender='" + sender + '\'' +
                ", utr='" + utr + '\'' +
                ", upiId='" + upiId + '\'' +
                ", status='" + status + '\'' +
                ", mode='" + mode + '\'' +
                ", confidence=" + confidence +
                ", engines=" + enginesLabel() +
                ", timestamp=" + timestamp +
                '}';
    }
}
