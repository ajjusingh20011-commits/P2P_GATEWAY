package com.example.paymentbot;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.text.TextUtils;
import android.util.Log;

import org.json.JSONObject;

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
            // --- Apps a trader actually collects customer payments in ---
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
            "com.airtelpeymentsbank",

            // --- Bank apps, kept for their credit alerts ---
            // A payment can be reported by the receiving bank's own app rather
            // than the UPI app, so these stay. They are not places a customer
            // pays INTO, which is why they are listed separately.
            "com.snapwork.hdfc",
            "com.csam.icici.bank.imobile",
            "com.sbi.SBIFreedomPlus",
            "com.axis.mobile",

            // Removed deliberately (BUG-38): in.amazon.mShop.android.shopping,
            // com.mobikwik_new, com.dreamplug.androidapp (CRED) and
            // com.freecharge.android. None of them is somewhere a customer
            // pays a trader; all of them post order, cashback and bill-reminder
            // notifications carrying a ₹ amount, which is exactly the noise the
            // text classifier then has to argue with. Filtering them here means
            // that argument never happens. Re-add a line if a trader genuinely
            // collects in one of them.
    };

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        // First statement in the callback, before any work: this is the
        // "when did our code actually get told" timestamp for the delay
        // investigation, and anything done ahead of it would be measured as
        // the OS being slow when it was us.
        final long appReactionMs = System.currentTimeMillis();
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
            // Carry the real app identity through to the Activity screen
            // instead of only the string derived from it — that screen can
            // then render the source app's own icon and name, matching what
            // the trader sees in the notification shade.
            data.packageName = packageName;
            data.appName = getAppName(packageName);
            data.actions = actionLabels(notification);

            // Log all fields for debugging.
            Log.d(TAG, "NOTIF TITLE: " + title);
            Log.d(TAG, "NOTIF TEXT: " + text);
            Log.d(TAG, "NOTIF BIGTEXT: " + bigText);
            Log.d(TAG, "NOTIF SUBTEXT: " + subText);
            Log.d(TAG, "NOTIF SUMMARY: " + summaryText);
            Log.d(TAG, "Notification from " + senderName + " (" + packageName + ") ["
                    + data.category + "]: " + displayBody);

            MainActivity.addSMS(data);

            // Item 5: this notification already passed the allowed-app gate,
            // so it's a real bank/UPI message — but if neither amount nor UTR
            // extracted, that's a format our regexes don't handle yet. Log it
            // locally (persistently) for review instead of silently dropping
            // it — see ParseFailure.
            // Search the body first, then the title. The payment does not
            // reliably live in the body: GPay alternates between
            // title="₹7 received from …" with boilerplate in the body, and the
            // reverse, from one post of the SAME notification to the next.
            // Reading only the body uploaded amount:"" for half of them.
            // BUG-40.
            String amount = SMSReceiver.firstMatch(displayBody, SMSReceiver.AMOUNT_PATTERNS);
            if (amount.isEmpty()) {
                amount = SMSReceiver.firstMatch(title, SMSReceiver.AMOUNT_PATTERNS);
            }
            String utr = SMSReceiver.firstMatch(displayBody, SMSReceiver.UTR_PATTERNS);
            if (utr.isEmpty()) {
                utr = SMSReceiver.firstMatch(title, SMSReceiver.UTR_PATTERNS);
            }
            if (amount.isEmpty() && utr.isEmpty()) {
                ParseFailureLogger.log(this, "NOTIFICATION", senderName, displayBody, "no_amount_or_utr_matched");
            }

            // Forward to the backend so it actually reaches the matching
            // engine — addSMS() above is UI-only and never leaves the phone.
            // Item 3: queue-first, not a direct fire-and-forget POST — see
            // EventQueue for why (this used to be lost outright if offline).
            queueEvent(senderName, displayBody, amount, utr, timestamp);

            // Diagnostic only — see CaptureTiming. Sends the same
            // TimeFormatter output as the key, so the two uploads join.
            CaptureTiming.record(this, "NOTIFICATION", packageName, displayBody, amount,
                    timestamp, appReactionMs, TimeFormatter.toUTC(timestamp));

        } catch (Exception e) {
            Log.e(TAG, "NotificationService error", e);
        }
    }

    /**
     * Builds the same POST /api/apk/event PAYMENT-category payload this
     * always sent, but now hands it to {@link EventQueue} instead of opening
     * the connection here directly — the event is durable (Room-backed) the
     * instant this returns, regardless of whether the device is online.
     */
    private void queueEvent(String sender, String body, String amount, String utr, long timestamp) {
        final String deviceToken = RegistrationManager.getDeviceToken(this);
        if (TextUtils.isEmpty(deviceToken)) {
            Log.w(TAG, "No deviceToken yet — skipping queue for this notification");
            return;
        }

        try {
            JSONObject json = new JSONObject();
            json.put("type", "NOTIFICATION");
            json.put("sender", sender);
            json.put("body", body);
            json.put("category", "PAYMENT");
            json.put("amount", amount == null ? "" : amount);
            json.put("utr", utr == null ? "" : utr);
            json.put("utcTimestamp", TimeFormatter.toUTC(timestamp));
            EventQueue.enqueue(this, "/api/apk/event", json.toString(), true);
        } catch (Exception e) {
            Log.e(TAG, "queueEvent buildJson error: " + e.getMessage());
        }
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        // No-op: we only care about posted notifications.
    }

    /**
     * Maps a known payment/messaging app package to a friendly name. For any
     * unknown package, returns the last dot-separated segment of the package.
     *
     * Every entry in ALLOWED_PACKAGES is listed here deliberately: this name is
     * the ONLY record of which app a payment arrived in that ever leaves the
     * phone (it becomes the "&lt;app&gt;: &lt;title&gt;" sender the server stores), and
     * the last-segment fallback below produces useless labels for exactly the
     * business apps that matter — "com.google.android.apps.nbu.paisa.merchant"
     * came through as "merchant", "com.bharatpe.app" as "app", and both
     * "com.paytm.business" and "com.phonepe.app.business" as an ambiguous
     * "business" that cannot be told apart afterwards.
     */
    private static String getAppName(String packageName) {
        if (TextUtils.isEmpty(packageName)) {
            return "Unknown";
        }
        switch (packageName) {
            case "net.one97.paytm":
                return "Paytm";
            case "com.paytm.business":
                return "Paytm Business";
            case "com.phonepe.app":
                return "PhonePe";
            case "com.phonepe.app.business":
                return "PhonePe Business";
            case "com.google.android.apps.nbu.paisa.user":
                return "GPay";
            case "com.google.android.apps.nbu.paisa.merchant":
                return "GPay Business";
            case "com.bharatpe.merchant":
                return "BharatPe";
            case "com.bharatpe.app":
                return "BharatPe Business";
            case "com.airtelpeymentsbank":
                return "Airtel Payments Bank";
            case "com.snapwork.hdfc":
                return "HDFC Bank";
            case "com.csam.icici.bank.imobile":
                return "ICICI Bank";
            case "com.sbi.SBIFreedomPlus":
                return "SBI";
            case "com.axis.mobile":
                return "Axis Bank";
            case "com.dreamplug.androidapp":
                return "CRED";
            case "com.mobikwik_new":
                return "MobiKwik";
            case "com.freecharge.android":
                return "Freecharge";
            case "in.amazon.mShop.android.shopping":
                return "Amazon Pay";
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

    /**
     * The action button labels the notification carried ("All payments",
     * "Settings"), so the Activity screen can show the same affordances the
     * real notification did. Empty array when it had none — many do not.
     */
    private static String[] actionLabels(Notification notification) {
        if (notification == null || notification.actions == null) {
            return new String[0];
        }
        java.util.List<String> labels = new java.util.ArrayList<>();
        for (Notification.Action action : notification.actions) {
            if (action != null && action.title != null) {
                String title = action.title.toString().trim();
                if (!title.isEmpty()) {
                    labels.add(title);
                }
            }
        }
        return labels.toArray(new String[0]);
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
