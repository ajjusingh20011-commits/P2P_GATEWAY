package com.example.paymentbot;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import androidx.annotation.RequiresApi;

/**
 * Engine 1 — Screen reader (AccessibilityService).
 *
 * <p>Foreground-app tracking + on-demand screen text. OUTGOING/payout details
 * are NEVER read passively — the old "read every success screen automatically"
 * behaviour was removed (it would falsely capture an OLD transaction a trader
 * merely scrolled to). Payout fields are extracted ONLY when the trader taps
 * Capture (PayoutOverlayService.onScreenshotTap reads currentScreenText() once,
 * at that moment, via SuccessScreenParser).
 *
 * <p>The original inbound-payment screen capture (for watched UPI apps) is
 * preserved for non-success screens — that is the separate receiving path.
 */
public class PaymentBotService extends AccessibilityService {

    private static final String TAG = "PaymentBot";

    private static PaymentBotService instance;

    public static PaymentBotService getInstance() {
        return instance;
    }

    // The package currently tracked as foregrounded (a payment app). Drives the
    // payout overlay's foreground-app light + Capture-tap gate. This is the ONLY
    // state this service keeps about the foreground app: it reads NOTHING from
    // the screen on its own. All capture is event-driven (NotificationService /
    // SMSReceiver, on real payment notifications/SMS only) or trader-initiated
    // (PayoutOverlayService's Capture tap). The payment-app allowlist itself
    // lives in one place — PaymentApps.isPaymentApp (Phase 1b).
    private String currentPaymentApp = "";

    // ---------------------------------------------------------------------
    // Overlay-readiness retry (overlay investigation, item 1)
    // ---------------------------------------------------------------------
    // startService() only schedules the target service's onCreate() to run —
    // it does not block until that's done. The old code checked
    // getInstance() immediately afterwards with no wait, so any time
    // PayoutOverlayService wasn't already alive (fresh reboot before the app
    // was opened, or the OS had background-killed it — it carries no restart
    // protection of its own, unlike KeepAliveService) the very first
    // payment-app-open silently skipped showing the overlay: no error, no
    // retry, nothing visible anywhere.
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
            // A payment app is foregrounded — track it. BUG 2: no separate
            // "watching" banner. The single unified overlay (PayoutOverlayService
            // bubble/card) and its foreground-verification light already convey
            // this; the old PaymentOverlayService badge was a SECOND floating
            // element stacked on top of that overlay.
            // Track ONLY which payment app is foregrounded — read nothing from
            // the screen. The old passive screen-scrape (handleInboundCapture)
            // fired on every window event in a watched app and, because its
            // "looks like a payment" test matched any screen containing ₹ / rs /
            // upi / paid / payment, it repeatedly auto-captured loan promos,
            // failed payments and scrolled-to OLD transactions and posted them to
            // /api/apk/event (feeding the matcher). Removed entirely: inbound
            // detection is event-driven via NotificationService / SMSReceiver
            // (real payment notifications/SMS only), and outgoing/payout capture
            // is trader-initiated via PayoutOverlayService's Capture tap.
            if (!pkg.equals(currentPaymentApp)) {
                Log.d(TAG, "DIAG currentPaymentApp SET: \"" + currentPaymentApp + "\" -> \"" + pkg + "\"");
                currentPaymentApp = pkg;
            }
        } else {
            // BUG 1 — a NON-payment package took focus, but do NOT clear the
            // payment-app state for a TRANSIENT SYSTEM overlay briefly appearing
            // ON TOP of the payment app: fingerprint/biometric prompts, permission
            // dialogs, the notification shade, the keyboard. Confirmed on-device:
            // PhonePe's "Pay with fingerprint" prompt surfaced as a
            // com.android.systemui TYPE_WINDOW_CONTENT_CHANGED (2048) event and
            // was wrongly clearing state — flashing the light red mid-payment,
            // even though the trader never left PhonePe. Only a genuine SWITCH —
            // a window-STATE change to a different REAL app — clears.
            boolean genuineAppSwitch = type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                    && !isTransientSystemOverlay(pkg);
            if (genuineAppSwitch && !currentPaymentApp.isEmpty()) {
                Log.d(TAG, "DIAG currentPaymentApp CLEARED: was \"" + currentPaymentApp
                        + "\" (switched to real app \"" + pkg + "\")");
                currentPaymentApp = "";
            }
            // Payout overlay visibility is driven solely by PaymentModeState
            // above, not by which app is foregrounded.
        }
    }

    // ---------------------------------------------------------------------
    // Extraction helpers
    // ---------------------------------------------------------------------

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
        // Only clear the singleton if WE are still the current instance. On a
        // permission toggle-off/on (or a system rebind) the OLD instance's
        // onDestroy() can run AFTER the NEW instance's onServiceConnected()
        // already set `instance = this`. An unconditional `instance = null` here
        // then wiped the live reference, so getInstance() returned null forever
        // — the "null-reader" the overlay logs — despite a connected service
        // existing. Guarding on identity fixes that stale-null race.
        boolean wasCurrent = (instance == this);
        if (wasCurrent) {
            instance = null;
        }
        Log.d(TAG, "Accessibility service DESTROYED (wasCurrentInstance=" + wasCurrent
                + ", instanceNowNull=" + (instance == null) + ")");
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
        // Single source of truth (Phase 1b) — payment apps only, no bank apps.
        return PaymentApps.isPaymentApp(pkg);
    }

    /**
     * BUG 1 — a transient system UI window that appears ON TOP of the real
     * foreground app without the user ever leaving it: the fingerprint/biometric
     * prompt, a runtime-permission dialog, the notification shade / quick
     * settings (all com.android.systemui or "android"), and the on-screen
     * keyboard. An event from one of these must never clear the tracked payment
     * app. An empty package (some content events carry none) is treated the same
     * — it is never a genuine switch to a different app.
     */
    private static boolean isTransientSystemOverlay(String pkg) {
        if (pkg == null || pkg.isEmpty()) return true;
        return pkg.equals("com.android.systemui")
                || pkg.equals("android")
                || pkg.equals("com.android.permissioncontroller")
                || pkg.equals("com.google.android.permissioncontroller")
                || pkg.contains("inputmethod");
    }

    // ---------------------------------------------------------------------
    // Accessibility-native screenshot (API 30+). Replaces MediaProjection
    // entirely — uses the already-granted accessibility permission, so there is
    // no consent dialog, no foreground-service-type, and no crash-prone flow.
    // Tap-triggered ONLY (PayoutOverlayService.onScreenshotTap). Optional and
    // graceful: on any failure the callback gets null and the payout still
    // completes on the accessibility TEXT read, which is what powers the match
    // gate. Note: like MediaProjection, this cannot capture a FLAG_SECURE window
    // (the callback fails) — but text extraction is unaffected on secure screens.
    // ---------------------------------------------------------------------

    /** Result sink — jpegBytes is null when the screenshot is unavailable. */
    public interface ScreenshotBytesCallback {
        void onResult(byte[] jpegBytes);
    }

    @RequiresApi(api = android.os.Build.VERSION_CODES.R)
    public void takePayoutScreenshot(final ScreenshotBytesCallback cb) {
        try {
            takeScreenshot(android.view.Display.DEFAULT_DISPLAY, getMainExecutor(),
                    new TakeScreenshotCallback() {
                        @Override
                        public void onSuccess(ScreenshotResult result) {
                            cb.onResult(encodeJpeg(result));
                        }

                        @Override
                        public void onFailure(int errorCode) {
                            Log.w(TAG, "takeScreenshot failed: code " + errorCode
                                    + " (likely FLAG_SECURE window, rate-limit, or capability not granted)");
                            cb.onResult(null);
                        }
                    });
        } catch (Exception e) {
            Log.w(TAG, "takeScreenshot threw: " + e.getMessage());
            cb.onResult(null);
        }
    }

    @RequiresApi(api = android.os.Build.VERSION_CODES.R)
    private static byte[] encodeJpeg(AccessibilityService.ScreenshotResult result) {
        android.hardware.HardwareBuffer hb = null;
        Bitmap hw = null;
        Bitmap sw = null;
        try {
            hb = result.getHardwareBuffer();
            hw = Bitmap.wrapHardwareBuffer(hb, result.getColorSpace());
            if (hw == null) return null;
            // Hardware bitmaps are GPU-backed / read-only; copy to a software
            // config so JPEG compression can read the pixels.
            sw = hw.copy(Bitmap.Config.ARGB_8888, false);
            if (sw == null) return null;
            java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
            sw.compress(Bitmap.CompressFormat.JPEG, 70, baos);
            return baos.toByteArray();
        } catch (Exception e) {
            Log.w(TAG, "takeScreenshot decode failed: " + e.getMessage());
            return null;
        } finally {
            if (sw != null) sw.recycle();
            if (hw != null) hw.recycle();
            if (hb != null) {
                try { hb.close(); } catch (Exception ignored) { }
            }
        }
    }

}
