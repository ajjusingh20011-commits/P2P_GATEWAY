package com.example.paymentbot;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import org.json.JSONObject;

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

    private static PaymentBotService instance;

    public static PaymentBotService getInstance() {
        return instance;
    }

    // Every banking / UPI app the bot watches — drives the floating screenshot
    // button and (for UPI apps) the outgoing success-screen capture.
    //
    // Kept in sync with NotificationService.ALLOWED_PACKAGES (overlay
    // investigation, item 2: this list had drifted 4 packages behind that
    // one — the "for Business"/merchant variants below were watched for
    // notifications but never triggered the overlay at all).
    private static final String[] PAYMENT_APPS = {
            "com.phonepe.app",
            "com.google.android.apps.nbu.paisa.user",
            // Google Pay for Business — merchant/business variant.
            "com.google.android.apps.nbu.paisa.merchant",
            "net.one97.paytm",
            "com.bharatpe.merchant",
            // BharatPe for Business — verified against the Play Store listing
            // (see the matching note in NotificationService.ALLOWED_PACKAGES).
            "com.bharatpe.app",
            // Paytm for Business — unverified, see NotificationService note.
            "com.paytm.business",
            // PhonePe Business — unverified, see NotificationService note.
            "com.phonepe.app.business",
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

    // Subset used for the legacy inbound-payment (non-success-screen) capture
    // path. Deliberately NOT extended with the 4 business-variant packages
    // above: notifications already cover inbound detection for those apps via
    // NotificationService.ALLOWED_PACKAGES, and there's no verified evidence
    // of what those apps' non-success inbound screens look like to justify
    // screen-scraping them blindly (unlike the 4 entries below, which this
    // capture path was actually built/tested against).
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

    // ---------------------------------------------------------------------
    // Overlay-readiness retry (overlay investigation, item 1)
    // ---------------------------------------------------------------------
    // startService() only schedules the target service's onCreate() to run —
    // it does not block until that's done. The old code checked
    // getInstance() immediately afterwards with no wait, so any time
    // PaymentOverlayService/OverlayService weren't already alive (fresh
    // reboot before the app was opened, or the OS had background-killed
    // them — they carry no restart protection of their own, unlike
    // KeepAliveService) the very first payment-app-open silently skipped
    // showing the overlay: no error, no retry, nothing visible anywhere.
    //
    // Fixed with a short bounded retry instead of converting to
    // bindService()/ServiceConnection: both services currently return null
    // from onBind() (binding isn't supported at all today), and every
    // caller here assumes synchronous static getInstance() access from a
    // very hot path (onAccessibilityEvent fires many times per second) —
    // moving to a real bound-service model would mean maintaining a
    // persistent ServiceConnection per service plus queuing actions until
    // onServiceConnected(), a much larger structural change for marginal
    // benefit. Service.onCreate() for these two (no heavy I/O, just a
    // WindowManager handle) normally completes in low single-digit
    // milliseconds, so 5 attempts × 150ms (750ms max) is generous headroom
    // and keeps the fix contained to this one file.
    private final Handler overlayRetryHandler = new Handler(Looper.getMainLooper());
    private static final int OVERLAY_RETRY_DELAY_MS = 150;
    private static final int OVERLAY_RETRY_MAX_ATTEMPTS = 5;

    /** @return true once the action ran (service was ready); false to retry. */
    private interface ReadyAction {
        boolean tryRun();
    }

    private void runWhenOverlayReady(ReadyAction action) {
        runWhenOverlayReady(action, OVERLAY_RETRY_MAX_ATTEMPTS);
    }

    private void runWhenOverlayReady(final ReadyAction action, final int attemptsLeft) {
        if (action.tryRun()) {
            return;
        }
        if (attemptsLeft <= 0) {
            Log.w(TAG, "Overlay service still not ready after retries — giving up for this event");
            return;
        }
        overlayRetryHandler.postDelayed(
                () -> runWhenOverlayReady(action, attemptsLeft - 1), OVERLAY_RETRY_DELAY_MS);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null) {
            return;
        }
        int type = event.getEventType();
        String pkg = event.getPackageName() != null ? event.getPackageName().toString() : "";

        // TEMPORARY DEBUG LOGGING — real-device root-cause investigation for
        // the "PhonePe success screen not detected as foreground" bug.
        // Remove once diagnosed. Logs every event unconditionally, including
        // ones from this app's own overlay windows, to see whether a
        // self-generated event is what's clearing currentPaymentApp.
        Log.d(TAG, "DIAG onAccessibilityEvent: type=" + type + " pkg=" + pkg);

        // Computed once — reused below instead of repeating the same type
        // check three times (mechanical, not a behavior change).
        boolean isWindowEvent = type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                || type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED;

        // FEATURE 2 — "I have transferred" detection. Deliberately NOT
        // gated on isPaymentApp(pkg): the trader-panel page can be shown in
        // any installed browser or an in-app WebView, and there's no way to
        // verify a specific browser package without guessing. Bounded by
        // PayoutState.isActive() instead, so this costs nothing outside an
        // active payout window.
        if (isWindowEvent && PayoutState.isActive(this) && !PayoutState.isUploadTriggered(this)) {
            AccessibilityNodeInfo transferRoot = getRootInActiveWindow();
            if (transferRoot != null) {
                try {
                    if (extractText(transferRoot).toLowerCase().contains("i have transferred")) {
                        PayoutState.markUploadTriggered(this);
                        PayoutState.uploadBundle(this, "trader_click");
                    }
                } finally {
                    try {
                        transferRoot.recycle();
                    } catch (Exception ignored) {
                    }
                }
            }
        }

        // FEATURE 2 (overlay revision) — Payment Mode overlay lifecycle,
        // decoupled from any particular foreground app: present whenever
        // the trader has toggled it on, in every app, subject only to its
        // own minimize state (see PayoutOverlayService). Button
        // clickability is no longer pushed from here — PayoutOverlayService
        // checks PayoutState.isActive()/foreground-app itself on each tap
        // and gives feedback instead of gating the tap.
        if (isWindowEvent) {
            if (PaymentModeState.isEnabled(this)) {
                startService(new Intent(this, PayoutOverlayService.class));
                final boolean payoutActiveNow = PayoutState.isActive(this);
                runWhenOverlayReady(() -> {
                    PayoutOverlayService svc = PayoutOverlayService.getInstance();
                    if (svc == null) return false;
                    if (!svc.isVisible()) svc.show();
                    // Presentation-only: the active-payout ring/dot. Does not
                    // gate tappability — that check is unchanged, on the tap
                    // itself, in PayoutOverlayService.
                    svc.refreshActiveIndicator(payoutActiveNow);
                    return true;
                });
            } else {
                PayoutOverlayService svc = PayoutOverlayService.getInstance();
                if (svc != null) svc.hide();
            }
        }

        if (!isWindowEvent) {
            return;
        }

        // CONFIRMED FIX — self-generated events must not participate in
        // foreground-app tracking. accessibility_config.xml has no
        // packageNames filter, so this service also receives events from
        // its own overlay windows (success toasts, feedback snackbars,
        // badge views). PaymentOverlayService.showSuccessNotification()
        // adding a WindowManager view the instant the real success screen
        // is detected produced a self-generated event with
        // pkg == getPackageName(), which fell into the `else` branch below
        // and cleared currentPaymentApp even though the real foreground app
        // (PhonePe) never changed. Skip entirely — currentPaymentApp holds
        // its last real value through any self-generated event.
        if (pkg.equals(getPackageName())) {
            return;
        }

        if (isPaymentApp(pkg)) {
            // When a payment app comes forward: passive "watching" badge.
            if (!pkg.equals(currentPaymentApp)) {
                // TEMPORARY DEBUG LOGGING — see note at top of this method.
                Log.d(TAG, "DIAG currentPaymentApp SET: \"" + currentPaymentApp + "\" -> \"" + pkg + "\"");
                currentPaymentApp = pkg;
                final String appNameForBadge = getAppName(pkg);

                startService(new Intent(this, PaymentOverlayService.class));
                runWhenOverlayReady(() -> {
                    PaymentOverlayService svc = PaymentOverlayService.getInstance();
                    if (svc == null) return false;
                    svc.showBadge(appNameForBadge);
                    return true;
                });
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
            // Left the payment app — hide the badge.
            // No retry here (unlike show, above): if the services aren't
            // ready, nothing was ever shown in the first place, so there's
            // genuinely nothing to hide — that's a correct no-op, not the
            // same silent-fail bug. Logged at debug level purely for
            // visibility while diagnosing the overlay-service lifecycle.
            if (!currentPaymentApp.isEmpty()) {
                // TEMPORARY DEBUG LOGGING — see note at top of this method.
                Log.d(TAG, "DIAG currentPaymentApp CLEARED: was \"" + currentPaymentApp
                        + "\" (event pkg=\"" + pkg + "\" not whitelisted)");
                currentPaymentApp = "";
                PaymentOverlayService overlaySvc = PaymentOverlayService.getInstance();
                if (overlaySvc != null) {
                    overlaySvc.hideBadge();
                } else {
                    Log.d(TAG, "hideBadge skipped — PaymentOverlayService not running (nothing to hide)");
                }
            }
            // Payout overlay no longer hides on leaving a payment app — its
            // visibility is now driven solely by PaymentModeState above,
            // not by which app is currently foregrounded.
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

        if (amount == null || amount.isEmpty()) {
            // Item 5: this passed isSuccessScreen()'s keyword gate, so it's a
            // real success screen — but if no amount extracted, that's an
            // app/format our AMOUNT_PATTERN doesn't handle. Log for review
            // (skip logging plain duplicate/debounce returns below — those
            // aren't parse failures, they're working as intended).
            ParseFailureLogger.log(this, "SCREEN", appName, screenText, "success_screen_no_amount_matched");
            return;
        }
        if (isDuplicate || tooSoon) {
            return;
        }

        lastCapturedUTR = utr != null ? utr : "";
        lastCaptureTime = now;

        Log.d(TAG, "SUCCESS DETECTED: " + appName + " Rs." + amount
                + " to " + name + " UTR:" + utr);

        // AUTO capture and send — no user interaction.
        autoCaptureAndSend(appName, name, amount, last4, utr);

        // Confirm to the NGO with a brief notification. Retried the same way
        // as showBadge() above — by the time a success screen appears the
        // service has almost always finished starting already (it was
        // started when the app came to the foreground, seconds earlier),
        // but the race is the same shape, so it gets the same fix.
        final String fAppName = appName;
        final String fName = name;
        final String fAmount = amount;
        final String fUtr = utr;
        runWhenOverlayReady(() -> {
            PaymentOverlayService svc = PaymentOverlayService.getInstance();
            if (svc == null) return false;
            svc.showSuccessNotification(fAppName, fName, fAmount, fUtr);
            return true;
        });

        MainActivity.addLog("💸 OUTGOING: Rs." + amount + " to " + name
                + " via " + appName + " UTR:" + utr);
    }

    /**
     * Queues the auto-captured outgoing payment for delivery (item 3:
     * Room-backed, survives offline/process death — this used to be a
     * direct fire-and-forget POST that silently lost the event on failure).
     */
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

            // /api/apk/outgoing-payment keys off the deviceId field in the
            // JSON body (see ngo-backend/src/routes/apk.js) — no
            // devicetoken header needed.
            EventQueue.enqueue(this, "/api/apk/outgoing-payment", json.toString(), false);
        } catch (Exception e) {
            Log.e(TAG, "autoCaptureAndSend buildJson error: " + e.getMessage());
        }
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
            // Item 5: looksLikePayment already gated this as payment-related
            // text — a missing amount here is a screen layout/format our
            // regexes don't handle yet, not routine noise.
            ParseFailureLogger.log(this, "SCREEN", getAppName(pkg), screenText, "inbound_screen_no_amount_matched");
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
        APIClient.send(this, data);
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
        instance = this;
        Log.d(TAG, "Accessibility service connected");
        MainActivity.addLog("● Screen engine connected");
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        instance = null;
    }

    /** Current foreground window's visible text — used by
     *  PayoutOverlayService to gate the Screenshot button. */
    public String currentScreenText() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return "";
        try {
            return extractText(root);
        } finally {
            try {
                root.recycle();
            } catch (Exception ignored) {
            }
        }
    }

    /** The package currently tracked as foregrounded-and-whitelisted, or ""
     *  when none is. */
    public String currentForegroundPackage() {
        return currentPaymentApp;
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
