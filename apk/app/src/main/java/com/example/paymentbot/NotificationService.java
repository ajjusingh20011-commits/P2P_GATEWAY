package com.example.paymentbot;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.text.TextUtils;
import android.util.Log;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * NotificationListenerService that captures notifications from EVERY app
 * (no package filtering), extracts their text, resolves a readable app name,
 * builds an {@link SMSData} object, forwards it to the UI via
 * {@link MainActivity#addSMS(SMSData)}, and — for allowed banking/UPI apps —
 * posts it to the backend the same way SMSReceiver does for debit SMS.
 */
public class NotificationService extends NotificationListenerService {

    private static final String TAG = "PaymentBot";

    /**
     * Fires when the OS actually binds this listener — the real "capture is
     * live" signal, distinct from the permission grant. Recorded durably
     * (survives process death) so HeartbeatService's periodic health check
     * can read it without needing this service instance to still be alive.
     */
    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        Log.i(TAG, "NotificationListenerService connected");
        ListenerHealthStore.setConnected(this, true);
    }

    /**
     * Fires when the OS unbinds this listener — happens on some OEM skins
     * (ColorOS in particular) even while the notification-access permission
     * itself remains granted, silently stopping capture with no visible
     * error anywhere. Recorded so the health check can detect exactly this
     * mismatch and request a rebind.
     */
    @Override
    public void onListenerDisconnected() {
        super.onListenerDisconnected();
        Log.w(TAG, "NotificationListenerService disconnected");
        ListenerHealthStore.setConnected(this, false);
    }

    // Only capture notifications from these banking / UPI apps.
    //
    // Verification status of the "for Business" entries added alongside the
    // original set: only com.bharatpe.app has been independently checked
    // against its Play Store listing as of this change. com.paytm.business,
    // com.phonepe.app.business, and com.google.android.apps.nbu.paisa.merchant
    // came from user-provided input and have NOT been independently verified —
    // re-confirm each via `adb shell dumpsys notification` or
    // `adb shell pm list packages` on a device with the real app installed
    // before relying on them in production.
    private static final String[] ALLOWED_PACKAGES = {
            "com.phonepe.app",
            "com.google.android.apps.nbu.paisa.user",
            // Google Pay for Business — merchant/business variant, separate
            // app+package from consumer GPay above.
            "com.google.android.apps.nbu.paisa.merchant",
            "net.one97.paytm",
            "com.bharatpe.merchant",
            // BharatPe for Business — verified against the Play Store listing.
            "com.bharatpe.app",
            // Paytm for Business — unverified, see note above.
            "com.paytm.business",
            // PhonePe Business — unverified, see note above.
            "com.phonepe.app.business",
            "in.amazon.mShop.android.shopping",
            "com.freecharge.android",
            "com.airtelpeymentsbank",
            "com.snapwork.hdfc",
            "com.csam.icici.bank.imobile",
            "com.sbi.SBIFreedomPlus",
            "com.axis.mobile",
            "com.dreamplug.androidapp",
            "com.mobikwik_new"
    };

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) {
            return;
        }

        // Banking-only filter: ignore notifications from any other app.
        String pkg = sbn.getPackageName();
        if (pkg == null) {
            return;
        }
        boolean allowed = false;
        for (String p : ALLOWED_PACKAGES) {
            if (pkg.equals(p)) {
                allowed = true;
                break;
            }
        }
        if (!allowed) {
            return;
        }

        try {
            Notification notification = sbn.getNotification();
            if (notification == null || notification.extras == null) {
                return;
            }
            Bundle extras = notification.extras;
            String packageName = pkg;

            // Read ALL relevant notification fields. Paytm (and many apps) store
            // these as SpannableString rather than plain String, so we read them
            // as CharSequence — Bundle.getString() would return null for those,
            // which is exactly the bug that surfaced the wrong text.
            String title = charSeq(extras, Notification.EXTRA_TITLE);
            String text = charSeq(extras, Notification.EXTRA_TEXT);
            String bigText = charSeq(extras, Notification.EXTRA_BIG_TEXT);
            String subText = charSeq(extras, Notification.EXTRA_SUB_TEXT);
            String summaryText = charSeq(extras, Notification.EXTRA_SUMMARY_TEXT);

            // Skip promotional / marketing notifications — keep only real
            // transaction alerts.
            String combined = title + " " + text;
            String lower = combined.toLowerCase();
            boolean isPromo =
                    lower.contains("loan offer")
                            || lower.contains("cashback offer")
                            || lower.contains("apply now")
                            || lower.contains("pre-approved")
                            || lower.contains("upgrade your")
                            || lower.contains("earn reward")
                            || lower.contains("limited time")
                            || lower.contains("click here")
                            || (lower.contains("offer")
                                && !lower.contains("received")
                                && !lower.contains("paid")
                                && !lower.contains("sent")
                                && !lower.contains("debited")
                                && !lower.contains("credited")
                                && !lower.contains("transferred"));
            if (isPromo) {
                Log.d(TAG, "Skipping promo notification: " + title);
                return;
            }

            // Build best possible display text:
            // Use bigText if available (most complete), otherwise combine
            // title + text so no context is lost.
            String displayBody;
            if (!bigText.isEmpty()) {
                displayBody = bigText;
            } else if (!title.isEmpty() && !text.isEmpty()) {
                displayBody = title + "\n" + text;
            } else if (!title.isEmpty()) {
                displayBody = title;
            } else {
                displayBody = text;
            }

            if (TextUtils.isEmpty(displayBody)) {
                return;
            }

            // Use app name as the sender; append the title when present so the
            // card header reads e.g. "Paytm: Payment received".
            String senderName = getAppName(packageName);
            if (!title.isEmpty()) {
                senderName = getAppName(packageName) + ": " + title;
            }

            long timestamp = sbn.getPostTime();
            if (timestamp <= 0) {
                timestamp = System.currentTimeMillis();
            }

            // Create SMSData with full info.
            SMSData data = new SMSData(senderName, displayBody, timestamp);
            data.source = "NOTIFICATION";

            // Log all fields for debugging.
            Log.d(TAG, "NOTIF TITLE: " + title);
            Log.d(TAG, "NOTIF TEXT: " + text);
            Log.d(TAG, "NOTIF BIGTEXT: " + bigText);
            Log.d(TAG, "NOTIF SUBTEXT: " + subText);
            Log.d(TAG, "NOTIF SUMMARY: " + summaryText);
            Log.d(TAG, "Notification from " + senderName + " (" + packageName + ") ["
                    + data.category + "]: " + displayBody);

            MainActivity.addSMS(data);

            // Forward to the backend so it actually reaches the matching
            // engine — addSMS() above is UI-only and never leaves the phone.
            String amount = SMSReceiver.firstMatch(displayBody, SMSReceiver.AMOUNT_PATTERNS);
            String utr = SMSReceiver.firstMatch(displayBody, SMSReceiver.UTR_PATTERNS);
            sendEventToServer(senderName, displayBody, amount, utr, timestamp);

        } catch (Exception e) {
            Log.e(TAG, "NotificationService error", e);
        }
    }

    /**
     * POSTs this notification to POST /api/apk/event as a PAYMENT-category
     * RawEvent — the one endpoint that actually feeds matchingEngine.checkMatch
     * server-side (unlike /api/apk/debit-sms, which nothing currently reads).
     * Requires the deviceToken issued at /register-device; skips silently
     * (logs only) if the device hasn't obtained one yet.
     */
    private void sendEventToServer(String sender, String body, String amount, String utr, long timestamp) {
        final String deviceToken = RegistrationManager.getDeviceToken(this);
        if (TextUtils.isEmpty(deviceToken)) {
            Log.w(TAG, "No deviceToken yet — skipping server post for this notification");
            return;
        }
        final String serverUrl = RegistrationManager.getServerUrl(this);

        final String payload;
        try {
            JSONObject json = new JSONObject();
            json.put("type", "NOTIFICATION");
            json.put("sender", sender);
            json.put("body", body);
            json.put("category", "PAYMENT");
            json.put("amount", amount == null ? "" : amount);
            json.put("utr", utr == null ? "" : utr);
            json.put("utcTimestamp", TimeFormatter.toUTC(timestamp));
            payload = json.toString();
        } catch (Exception e) {
            Log.e(TAG, "sendEventToServer buildJson error: " + e.getMessage());
            return;
        }

        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(serverUrl + "/api/apk/event");
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("devicetoken", deviceToken);
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);
                conn.setDoOutput(true);

                byte[] out = payload.getBytes(StandardCharsets.UTF_8);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(out);
                }

                int code = conn.getResponseCode();
                Log.d(TAG, "Notification event posted to server, HTTP " + code);
            } catch (Exception e) {
                Log.e(TAG, "Failed to post notification event: " + e.getMessage());
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        }).start();
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        // No-op: we only care about posted notifications.
    }

    /**
     * Maps a known payment/messaging app package to a friendly name. For any
     * unknown package, returns the last dot-separated segment of the package.
     */
    private static String getAppName(String packageName) {
        if (TextUtils.isEmpty(packageName)) {
            return "Unknown";
        }
        switch (packageName) {
            case "net.one97.paytm":
                return "Paytm";
            case "com.phonepe.app":
                return "PhonePe";
            case "com.google.android.apps.nbu.paisa.user":
                return "GPay";
            case "com.bharatpe.merchant":
                return "BharatPe";
            case "com.whatsapp":
                return "WhatsApp";
            default:
                int lastDot = packageName.lastIndexOf('.');
                if (lastDot >= 0 && lastDot < packageName.length() - 1) {
                    return packageName.substring(lastDot + 1);
                }
                return packageName;
        }
    }

    private static String charSeq(Bundle extras, String key) {
        try {
            CharSequence cs = extras.getCharSequence(key);
            if (cs != null) {
                return cs.toString();
            }
            Object o = extras.get(key);
            if (o != null) {
                return String.valueOf(o);
            }
        } catch (Exception ignored) {
            // fall through to empty
        }
        return "";
    }
}
