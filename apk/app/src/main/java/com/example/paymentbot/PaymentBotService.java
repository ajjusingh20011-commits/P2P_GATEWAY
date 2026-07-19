package com.example.paymentbot;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Engine 1 — Screen reader (AccessibilityService).
 *
 * <p>Fully automatic outgoing-payment capture: whenever a payment app shows a
 * success screen, the bot silently reads the amount / recipient / UTR and posts
 * it to the backend — the NGO team does nothing. A passive badge indicates the
 * bot is watching, and a brief success notification confirms each capture.
 *
 * <p>The original inbound-payment screen capture (for watched UPI apps) is
 * preserved for non-success screens.
 */
public class PaymentBotService extends AccessibilityService {

    private static final String TAG = "PaymentBot";

    // Every banking / UPI app the bot watches — drives the floating screenshot
    // button and (for UPI apps) the outgoing success-screen capture.
    private static final String[] PAYMENT_APPS = {
            "com.phonepe.app",
            "com.google.android.apps.nbu.paisa.user",
            "net.one97.paytm",
            "com.bharatpe.merchant",
            "in.amazon.mShop.android.shopping",
            "com.freecharge.android",
            "com.airtelpeymentsbank",
            "com.csam.icici.bank.imobile",
            "com.sbi.SBIFreedomPlus",
            "com.axis.mobile",
            "com.dreamplug.androidapp",
            "com.mobikwik_new",
            "com.snapwork.hdfc"
    };

    // Subset used for the legacy inbound-payment capture path.
    private static final String[] WATCHED_PACKAGES = {
            "net.one97.paytm",
            "com.phonepe.app",
            "com.bharatpe.merchant",
            "com.google.android.apps.nbu.paisa.user"
    };

    // ---- Success-screen extraction patterns ----
    private static final Pattern AMOUNT_PATTERN =
            Pattern.compile("(?:₹|rs\\.?|inr)\\s*([\\d,]+(?:\\.\\d+)?)", Pattern.CASE_INSENSITIVE);
    private static final Pattern NAME_PATTERN =
            Pattern.compile("(?i)(?:paid to|sent to|transferred to|to)\\s+([A-Za-z][A-Za-z .]{1,40})");
    private static final Pattern LAST4_PATTERN =
            Pattern.compile("(?:[Xx*]{2,})\\s*(\\d{4})");
    private static final Pattern UTR_PATTERN = Pattern.compile(
            "(?i)(?:utr|upi\\s*(?:ref|txn|transaction)\\s*(?:id|no)?|transaction\\s*id|txn\\s*id|"
                    + "reference\\s*(?:id|no)?)[:\\s.#]*([A-Za-z0-9]{6,})");

    // Inbound capture debounce.
    private String lastSignature = "";
    private long lastCaptureAt = 0L;

    // Outgoing (automatic) capture state.
    private String lastCapturedUTR = "";
    private long lastCaptureTime = 0L;
    private String currentPaymentApp = "";

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null) {
            return;
        }
        int type = event.getEventType();
        String pkg = event.getPackageName() != null ? event.getPackageName().toString() : "";

        // Input recording: capture editable field text while RECORD is active.
        if (type == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED) {
            if (OverlayService.isRecording() && isPaymentApp(pkg)) {
                captureRecordedField(event);
            }
            return;
        }

        if (type != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                && type != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
            return;
        }

        if (isPaymentApp(pkg)) {
            // When a payment app comes forward: passive "watching" badge plus the
            // floating screenshot button.
            if (!pkg.equals(currentPaymentApp)) {
                currentPaymentApp = pkg;

                startService(new Intent(this, PaymentOverlayService.class));
                if (PaymentOverlayService.getInstance() != null) {
                    PaymentOverlayService.getInstance().showBadge(getAppName(pkg));
                }

                startService(new Intent(this, OverlayService.class));
                if (OverlayService.getInstance() != null
                        && !OverlayService.getInstance().isVisible()) {
                    OverlayService.getInstance().showFloatingButton();
                }
            }

            AccessibilityNodeInfo root = getRootInActiveWindow();
            if (root == null) {
                return;
            }

            try {
                String screenText = extractText(root);
                if (screenText.isEmpty()) {
                    return;
                }

                if (isSuccessScreen(screenText)) {
                    handleSuccessScreen(pkg, screenText);
                } else if (isWatched(pkg)) {
                    // Preserved inbound-payment capture for non-success screens.
                    handleInboundCapture(pkg, screenText);
                }
            } catch (Exception e) {
                Log.e(TAG, "PaymentBotService error", e);
            } finally {
                try {
                    root.recycle();
                } catch (Exception ignored) {
                }
            }
        } else {
            // Left the payment app — hide the badge and the screenshot button.
            if (!currentPaymentApp.isEmpty()) {
                currentPaymentApp = "";
                if (PaymentOverlayService.getInstance() != null) {
                    PaymentOverlayService.getInstance().hideBadge();
                }
                if (OverlayService.getInstance() != null) {
                    OverlayService.getInstance().hideFloatingButton();
                }
            }
        }
    }

    // ---------------------------------------------------------------------
    // Outgoing success capture (automatic)
    // ---------------------------------------------------------------------
    private void handleSuccessScreen(String pkg, String screenText) {
        String amount = extractSuccessAmount(screenText);
        String name = extractSuccessName(screenText);
        String last4 = extractSuccessLast4(screenText);
        String utr = extractSuccessUTR(screenText);
        String appName = getAppName(pkg);

        long now = System.currentTimeMillis();
        boolean isDuplicate = utr != null && !utr.isEmpty() && utr.equals(lastCapturedUTR);
        boolean tooSoon = (now - lastCaptureTime) < 8000;

        if (amount == null || amount.isEmpty() || isDuplicate || tooSoon) {
            return;
        }

        lastCapturedUTR = utr != null ? utr : "";
        lastCaptureTime = now;

        Log.d(TAG, "SUCCESS DETECTED: " + appName + " Rs." + amount
                + " to " + name + " UTR:" + utr);

        // AUTO capture and send — no user interaction.
        autoCaptureAndSend(appName, name, amount, last4, utr);

        // Confirm to the NGO with a brief notification.
        if (PaymentOverlayService.getInstance() != null) {
            PaymentOverlayService.getInstance().showSuccessNotification(appName, name, amount, utr);
        }

        MainActivity.addLog("💸 OUTGOING: Rs." + amount + " to " + name
                + " via " + appName + " UTR:" + utr);
    }

    /** Posts the auto-captured outgoing payment to the backend (background). */
    private void autoCaptureAndSend(String app, String recipientName,
                                    String amount, String last4, String utr) {
        final String deviceId = android.provider.Settings.Secure.getString(
                getContentResolver(), android.provider.Settings.Secure.ANDROID_ID);
        final String capturedAt = TimeFormatter.toUTC(System.currentTimeMillis());
        final String fName = recipientName != null ? recipientName : "";
        final String fLast4 = last4 != null ? last4 : "";
        final String fUtr = utr != null ? utr : "";
        final String fApp = app != null ? app : "";
        final String fAmount = amount != null ? amount : "";

        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                JSONObject json = new JSONObject();
                json.put("deviceId", deviceId == null ? "" : deviceId);
                json.put("type", "OUTGOING");
                json.put("app", fApp);
                json.put("recipientName", fName);
                json.put("recipientLast4", fLast4);
                json.put("amount", fAmount);
                json.put("utr", fUtr);
                json.put("capturedAt", capturedAt);
                json.put("capturedFrom", "SUCCESS_SCREEN");
                json.put("autoCapture", true);

                URL url = new URL(Config.EP_OUTGOING_PAYMENT);
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);
                conn.setDoOutput(true);

                byte[] out = json.toString().getBytes(StandardCharsets.UTF_8);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(out);
                }

                int code = conn.getResponseCode();
                Log.d(TAG, "Auto capture sent: " + code);
            } catch (Exception e) {
                Log.e(TAG, "Auto capture error: " + e.getMessage());
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        }).start();
    }

    // ---------------------------------------------------------------------
    // Inbound capture (preserved from the original engine)
    // ---------------------------------------------------------------------
    private void handleInboundCapture(String pkg, String screenText) {
        String lower = screenText.toLowerCase();
        boolean looksLikePayment = lower.contains("received") || lower.contains("credited")
                || lower.contains("paid") || lower.contains("payment")
                || lower.contains("₹") || lower.contains("rs") || lower.contains("upi");
        if (!looksLikePayment) {
            return;
        }

        PaymentData data = PaymentParser.parse(screenText, getAppName(pkg));
        data.setCapturedByScreen(true);
        if (data.getAmount().isEmpty()) {
            return;
        }

        String signature = data.getAmount() + "|" + data.getUtr() + "|" + data.getUpiId();
        long now = System.currentTimeMillis();
        if (signature.equals(lastSignature) && (now - lastCaptureAt) < 4000) {
            return;
        }
        lastSignature = signature;
        lastCaptureAt = now;

        data = PaymentMerger.single(data);

        Log.d(TAG, "Screen capture: " + data);
        MainActivity.addLog("SCREEN 📱 " + getAppName(pkg) + " ₹" + data.getAmount()
                + (data.getSender().isEmpty() ? "" : " from " + data.getSender())
                + " [" + data.getConfidence() + "%]");

        MainActivity.addPayment(data);
        APIClient.send(data);
    }

    // ---------------------------------------------------------------------
    // Extraction helpers
    // ---------------------------------------------------------------------

    /** True when the screen looks like an OUTGOING payment success screen. */
    static boolean isSuccessScreen(String text) {
        if (text == null) {
            return false;
        }
        String t = text.toLowerCase();
        // Inbound "received/credited" screens are handled elsewhere.
        if (t.contains("received") || t.contains("credited")) {
            return false;
        }
        return t.contains("payment successful")
                || t.contains("transaction successful")
                || t.contains("transfer successful")
                || t.contains("successfully paid")
                || t.contains("successfully sent")
                || t.contains("paid successfully")
                || t.contains("money sent")
                || t.contains("payment of")
                || (t.contains("success") && (t.contains("paid") || t.contains("sent") || t.contains(" to ")));
    }

    private static String extractSuccessAmount(String text) {
        return firstGroup(AMOUNT_PATTERN, text);
    }

    private static String extractSuccessName(String text) {
        String name = firstGroup(NAME_PATTERN, text);
        // Trim trailing noise words that regularly follow the name on screen.
        if (!name.isEmpty()) {
            name = name.replaceAll("(?i)\\b(on|via|using|upi|paid|successful|success).*$", "").trim();
        }
        return name;
    }

    private static String extractSuccessLast4(String text) {
        return firstGroup(LAST4_PATTERN, text);
    }

    private static String extractSuccessUTR(String text) {
        return firstGroup(UTR_PATTERN, text);
    }

    private static String firstGroup(Pattern p, String text) {
        if (text == null || text.isEmpty()) {
            return "";
        }
        Matcher m = p.matcher(text);
        if (m.find() && m.group(1) != null) {
            return m.group(1).trim();
        }
        return "";
    }

    /** Collects and returns all visible text from the node tree. */
    private String extractText(AccessibilityNodeInfo root) {
        StringBuilder sb = new StringBuilder();
        collectText(root, sb);
        return sb.toString().trim();
    }

    /** Recursively collect every non-empty text / content-description node. */
    private void collectText(AccessibilityNodeInfo node, StringBuilder sb) {
        if (node == null) {
            return;
        }
        CharSequence text = node.getText();
        if (text != null && text.length() > 0) {
            sb.append(text).append(' ');
        }
        CharSequence desc = node.getContentDescription();
        if (desc != null && desc.length() > 0) {
            sb.append(desc).append(' ');
        }
        int count = node.getChildCount();
        for (int i = 0; i < count; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                collectText(child, sb);
                child.recycle();
            }
        }
    }

    // ---------------------------------------------------------------------
    // Lifecycle + app helpers
    // ---------------------------------------------------------------------
    @Override
    public void onInterrupt() {
        // Required override; nothing to clean up.
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        Log.d(TAG, "Accessibility service connected");
        MainActivity.addLog("● Screen engine connected");

        // Clipboard monitoring — when recording, a copied account/IFSC/amount is
        // captured too (users often paste these into payment forms).
        try {
            final android.content.ClipboardManager clipboard =
                    (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            if (clipboard != null) {
                clipboard.addPrimaryClipChangedListener(() -> {
                    if (!OverlayService.isRecording()) {
                        return;
                    }
                    android.content.ClipData clip = clipboard.getPrimaryClip();
                    if (clip == null || clip.getItemCount() == 0) {
                        return;
                    }
                    CharSequence cs = clip.getItemAt(0).getText();
                    String copied = cs != null ? cs.toString().trim() : "";
                    if (copied.isEmpty()) {
                        return;
                    }
                    String fieldType = detectFieldType(null, copied);
                    if (fieldType != null) {
                        OverlayService.onFieldCaptured(fieldType, copied);
                        Log.d(TAG, "Clipboard captured: " + fieldType + " = " + copied);
                    }
                });
            }
        } catch (Exception e) {
            Log.e(TAG, "Clipboard listener error: " + e.getMessage());
        }
    }

    // ---------------------------------------------------------------------
    // Input recording (field capture)
    // ---------------------------------------------------------------------
    private void captureRecordedField(AccessibilityEvent event) {
        AccessibilityNodeInfo source = event.getSource();
        if (source == null) {
            return;
        }
        try {
            if (!source.isEditable()) {
                return;
            }
            CharSequence text = source.getText();
            if (text == null || text.length() == 0) {
                return;
            }
            String value = text.toString().trim();
            String fieldType = detectFieldType(source, value);
            if (fieldType != null) {
                OverlayService.onFieldCaptured(fieldType, value);
            }
        } finally {
            try {
                source.recycle();
            } catch (Exception ignored) {
            }
        }
    }

    /**
     * Classifies a captured value into ACCOUNT / IFSC / AMOUNT / NAME. When the
     * source node is null (e.g. a clipboard capture) only the value pattern is
     * used — no hint/description context is available.
     */
    private String detectFieldType(AccessibilityNodeInfo node, String value) {
        if (value == null || value.isEmpty()) {
            return null;
        }

        String combined = "";
        if (node != null) {
            String hint = node.getHintText() != null
                    ? node.getHintText().toString().toLowerCase() : "";
            String desc = node.getContentDescription() != null
                    ? node.getContentDescription().toString().toLowerCase() : "";
            combined = hint + " " + desc;
        }

        // IFSC: 4 letters + 7 alphanumerics.
        if (value.matches("[A-Z]{4}[0-9A-Z]{7}")) {
            return "IFSC";
        }

        // Account number: 9-18 digits.
        if (value.matches("\\d{9,18}")) {
            return "ACCOUNT";
        }

        // Amount: digits with optional 2-decimal, short.
        if (value.matches("\\d+(\\.\\d{1,2})?") && value.length() <= 7) {
            return "AMOUNT";
        }

        // Name: letters + spaces, 3+ chars — needs a name hint, or clipboard.
        if (value.matches("[A-Za-z][A-Za-z\\s]{2,49}")
                && (combined.contains("name")
                    || combined.contains("beneficiary")
                    || combined.contains("recipient")
                    || node == null)) {
            return "NAME";
        }

        return null;
    }

    private static boolean isPaymentApp(String pkg) {
        for (String p : PAYMENT_APPS) {
            if (p.equals(pkg)) return true;
        }
        return false;
    }

    private static boolean isWatched(String pkg) {
        for (String p : WATCHED_PACKAGES) {
            if (p.equals(pkg)) return true;
        }
        return false;
    }

    private static String getAppName(String pkg) {
        if (pkg == null) return "UPI";
        if (pkg.contains("paytm")) return "Paytm";
        if (pkg.contains("phonepe")) return "PhonePe";
        if (pkg.contains("bharatpe")) return "BharatPe";
        if (pkg.contains("paisa")) return "GPay";
        if (pkg.contains("amazon")) return "AmazonPay";
        if (pkg.contains("mobikwik")) return "MobiKwik";
        return pkg;
    }
}
