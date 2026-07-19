package com.example.paymentbot;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.text.TextUtils;
import android.util.Log;

/**
 * NotificationListenerService that captures notifications from EVERY app
 * (no package filtering), extracts their text, resolves a readable app name,
 * builds an {@link SMSData} object, and forwards it to the UI via
 * {@link MainActivity#addSMS(SMSData)}.
 */
public class NotificationService extends NotificationListenerService {

    private static final String TAG = "PaymentBot";

    // Only capture notifications from these banking / UPI apps.
    private static final String[] ALLOWED_PACKAGES = {
            "com.phonepe.app",
            "com.google.android.apps.nbu.paisa.user",
            "net.one97.paytm",
            "com.bharatpe.merchant",
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

        } catch (Exception e) {
            Log.e(TAG, "NotificationService error", e);
        }
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
