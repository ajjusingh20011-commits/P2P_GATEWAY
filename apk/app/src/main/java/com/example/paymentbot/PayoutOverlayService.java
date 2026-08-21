package com.example.paymentbot;

import android.app.Service;
import android.content.Intent;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.LayerDrawable;
import android.os.Build;
import android.os.Handler;
import android.widget.FrameLayout;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.HashMap;
import java.util.Map;

/**
 * FEATURE 2 — Payout evidence capture overlay.
 *
 * UI migrated to match the approved design (MaxPayDesign src/Overlay —
 * OverlayParts.tsx / overlayModel.ts / overlay.css), pixel-for-pixel where
 * Android's WindowManager/View system allows a direct translation. The
 * design's own geometry file states "1 CSS px == 1 Android dp", so every
 * size below is taken directly from overlay.css's --ov-* custom properties.
 *
 * Real action/state logic (record/screenshot preconditions, always-tappable
 * buttons with tap-time feedback, success-keyword gating, local-only
 * screenshot storage) is UNCHANGED from the existing implementation — this
 * pass is presentation-layer only.
 *
 * Documented, unavoidable deviations from the design (Android platform
 * constraints, not design choices):
 *  - GradientDrawable only supports 8 fixed 45°-increment orientations, not
 *    arbitrary CSS angles — the design's 152° bubble gradient is approximated
 *    with the nearest available orientation (TL_BR, ~135°).
 *  - CSS box-shadow (the bubble's white+emerald "active" ring) has no direct
 *    Android equivalent; approximated with a two-layer LayerDrawable ring.
 *  - No card drop-shadow: WindowManager TYPE_APPLICATION_OVERLAY windows
 *    don't reliably render View elevation shadows, and no other overlay in
 *    this app attempts one (OverlayService/PaymentOverlayService are also
 *    shadow-less) — consistent with existing precedent, not a new gap.
 *  - No vector icon set: every overlay in this app (OverlayService,
 *    PaymentOverlayService) already uses Unicode glyphs rather than a vector
 *    drawable pipeline; kept consistent rather than introducing one icon
 *    system just for this file.
 *  - No edge-snap-on-release animation: the design's snapToEdge/
 *    clampToSafeArea behavior lives in DraggableTouchListener.java, which is
 *    SHARED with OverlayService.java (a different, explicitly out-of-scope
 *    feature) — extending shared drag infra risked that other feature's
 *    behavior for a purely cosmetic animation. Deferred, not implemented
 *    here; current free-drag-to-anywhere behavior is unchanged.
 */
public class PayoutOverlayService extends Service {

    private static final String TAG = "PaymentBot";

    private static PayoutOverlayService instance;
    private WindowManager windowManager;
    private View currentView;
    private WindowManager.LayoutParams params;
    // Payment Mode opens straight to the full card — trader taps minimize to
    // collapse to the icon, not the other way round.
    private boolean expanded = true;
    private boolean activePayout = false;
    private View feedbackView;
    private boolean isVisible = false;


    // ---- Design tokens — MaxPayDesign src/Overlay/overlay.css .ov-lab ----
    private static final int C_BRAND = 0xFF0F6A5A;
    private static final int C_BRAND_DARK = 0xFF0A5748;
    private static final int C_BRAND_MID = 0xFF2A8C77;
    private static final int C_BRAND_SOFT = 0xFFE7F6F2;
    private static final int C_SURFACE = 0xFFF1F6F4;
    private static final int C_TEXT = 0xFF103C34;
    private static final int C_MUTED = 0xFF667B76;
    private static final int C_SUCCESS = 0xFF169B62;
    // Unified 3-state status (merges the old signature light with payout state):
    //   RED    — not a payment app, wrong app for a payout, or a signature MISMATCH
    //   ORANGE — a verified payout app, but no payout armed ("nothing to do now")
    //   GREEN  — a verified payout app AND a payout is armed ("real work to do")
    private static final int C_RED = 0xFFDC2626;
    private static final int C_ORANGE = 0xFFF59E0B;
    private static final int C_GREEN = 0xFF16A34A;
    private static final int C_SUCCESS_SOFT = 0xFFEAF8F1;
    private static final int C_HANDLE = 0xFFCBDCD7;
    private static final int C_CAPTURE_BORDER = 0xFFDBE8E4;
    private static final int C_CARD_BORDER = 0x1A103C34; // rgba(16,60,52,.1)
    private static final int C_SNACK_SUCCESS_BG = C_BRAND_SOFT;
    private static final int C_SNACK_SUCCESS_BORDER = 0xFFBFE3D8;
    private static final int C_SNACK_SUCCESS_TEXT = 0xFF0B3B32;
    private static final int C_SNACK_INFO_BG = 0xFFFFFFFF;
    private static final int C_SNACK_INFO_BORDER = 0xFFDDE8E5;
    // Bubble gradient stops (--ov-brand family), 152deg in the design —
    // approximated via GradientDrawable.Orientation.TL_BR (see class doc).
    private static final int[] BUBBLE_GRADIENT = {0xFF147A68, C_BRAND, C_BRAND_DARK};

    // ---- Design geometry (dp) — overlayModel.ts BUBBLE/CARD_W/CARD_H ----
    private static final int BUBBLE_DP = 46;
    private static final int CARD_W_DP = 208;
    private static final int CARD_H_DP = 100;
    private static final float BUBBLE_IDLE_ALPHA = 0.6f;   // spec: 55-65%
    private static final float BUBBLE_ACTIVE_ALPHA = 0.72f;
    private static final float CARD_ALPHA = 0.97f;

    // The six messages — MaxPayDesign src/Overlay/overlayModel.ts MESSAGES.
    private static final String MSG_RECORDED = "Payout recorded";
    private static final String MSG_CAPTURED = "Proof captured";
    private static final String MSG_NO_PAYOUT = "No payout in process";
    private static final String MSG_NOT_PAYMENT_APP = "Not a payment app";
    private static final String MSG_NOT_SUCCESS = "Payment success screen not detected";
    // Phase 1b — foreground is a payment app but not a consumer/personal one
    // payouts are SENT from (e.g. the trader opened the Business receive app).
    private static final String MSG_NOT_PAYOUT_APP = "Open your personal UPI app to send this payout";
    // Phase 1b — a pinned app whose signing cert doesn't match (a sideloaded fake).
    private static final String MSG_UNTRUSTED_APP = "App failed signature check";
    // Package-visible — read by EventUploadWorker, which owns the actual
    // HTTP delivery of PayoutState.uploadBundle()'s queued POST (see
    // EventQueue's offline-durable pipeline) and is the only place a 409
    // from /payout-evidence is actually observed.
    static final String MSG_ALREADY_SUBMITTED_ELSEWHERE = "Already submitted from another device";
    // Issue 1 — one real payment = one capture. Issue 2 — content couldn't say
    // which of several armed payouts this screen belongs to.
    private static final String MSG_ALREADY_CAPTURED = "Already captured — this payout is done";
    private static final String MSG_CANT_RESOLVE = "Can't tell which payout — open it in the app first";

    // Per-app success wording seeds (a fast path). The REAL guard is
    // matchesSuccessKeyword's GENERAL_SUCCESS fallback below (any recognized
    // payout app) plus the downstream amount/last-4 field match. PhonePe's real
    // success header is "Transaction Successful" — NOT "Transfer Successful"
    // (real-device team evidence, 2026-08-20). The old seed only had the latter,
    // so it rejected a genuine, correct PhonePe success screen outright.
    private static final Map<String, String[]> SUCCESS_KEYWORDS = new HashMap<>();
    static {
        SUCCESS_KEYWORDS.put("com.google.android.apps.nbu.paisa.user",
                new String[]{"payment successful", "money sent", "completed"});
        SUCCESS_KEYWORDS.put("com.google.android.apps.nbu.paisa.merchant",
                new String[]{"payment successful", "money sent", "completed"});
        SUCCESS_KEYWORDS.put("com.phonepe.app",
                new String[]{"transaction successful", "transfer successful", "payment successful", "money sent"});
        SUCCESS_KEYWORDS.put("com.phonepe.app.business",
                new String[]{"transaction successful", "transfer successful", "payment successful", "money sent"});
        SUCCESS_KEYWORDS.put("net.one97.paytm",
                new String[]{"payment successful", "transaction successful", "money sent successfully"});
        SUCCESS_KEYWORDS.put("com.paytm.business",
                new String[]{"payment successful", "transaction successful", "money sent successfully"});
        // BHIM intentionally omitted — package id unverified, see PR notes.
    }

    // General UPI success wording, checked for ANY recognized payout app (see
    // matchesSuccessKeyword). Capture is tap-triggered — the trader deliberately
    // taps on the screen they're viewing — so a broad success match is safe here;
    // the amount/last-4 field match downstream is the real guard against a wrong
    // screen. This is what keeps a genuine success screen from ever being
    // rejected on exact wording again.
    private static final String[] GENERAL_SUCCESS_KEYWORDS = {
            "transaction successful", "payment successful", "transfer successful",
            "successfully sent", "successfully paid", "sent successfully",
            "paid successfully", "money sent",
    };

    public static PayoutOverlayService getInstance() {
        return instance;
    }


    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        // Phase 1b — keep the signature light live while the service runs. Cheap:
        // a no-op when no view is up, and it only re-verifies on a package change.
        statusHandler.removeCallbacks(statusTick);
        statusHandler.postDelayed(statusTick, STATUS_TICK_MS);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        statusHandler.removeCallbacks(statusTick);
        hide();
        instance = null;
    }

    public boolean isVisible() {
        return isVisible;
    }

    /**
     * Passive visual only — the active-payout ring (bubble) / dot (card).
     * Does NOT gate Record/Screenshot tappability (that check runs on tap,
     * unchanged — see onRecordTap/onScreenshotTap). Re-renders only when the
     * value actually changes, called from PaymentBotService on every
     * accessibility window event.
     */
    public void refreshActiveIndicator(boolean active) {
        if (active == activePayout) return;
        activePayout = active;
        if (currentView != null) {
            // Cheap in-place swap — same pattern toggleExpand uses.
            if (windowManager != null) {
                try {
                    windowManager.removeView(currentView);
                } catch (Exception ignored) {
                }
            }
            currentView = null;
            renderCurrentState();
        }
    }

    // ---------------------------------------------------------------------
    // Phase 1b — signature-verification light. A small dot on the overlay
    // (bubble corner + card header) that shows, at a glance, whether the CURRENT
    // foreground app is a genuinely verified payout app:
    //   GREEN — a payout (consumer) app AND its signing cert is PINNED_OK.
    //   AMBER — a payout app whose cert is being OBSERVED (no pin set yet); the
    //           real hash is logged (PAYOUT_CERT_PIN) for capture.
    //   RED   — everything else: not a payout app, OR right package name but a
    //           WRONG/unverified signature (a potential fake).
    // Purely additive — does NOT gate Record/Screenshot (that check is on tap,
    // with its existing messages, unchanged). Updated by a light poll that only
    // re-verifies (and re-logs) when the foreground package actually changes.
    // ---------------------------------------------------------------------
    private static final long STATUS_TICK_MS = 800L;
    private final Handler statusHandler = new Handler(android.os.Looper.getMainLooper());

    // Transient tap feedback, shown IN the card (never a separate toast).
    private String feedbackMsg = null;
    private int feedbackColor = C_GREEN;
    private long feedbackUntil = 0L;

    private String lastStatusKey = " ";
    private Status lastStatus;
    private String lastRenderedKey = " ";

    /** A resolved status: colour + message + a leading glyph. */
    private static final class Status {
        final int color;
        final String message;
        final String icon;
        Status(int c, String m, String i) { color = c; message = m; icon = i; }
    }

    private Status computeStatus() {
        PaymentBotService reader = PaymentBotService.getInstance();
        String pkg = (reader == null) ? "" : reader.currentForegroundPackage();
        if (pkg == null) pkg = "";
        boolean active = PayoutState.isActive(this);
        int count = active ? PayoutState.activeCount(this) : 0;
        String key = pkg + "|" + active + "|" + count;
        if (key.equals(lastStatusKey) && lastStatus != null) return lastStatus;
        lastStatusKey = key;

        Status s;
        if (!PaymentApps.isPayoutApp(pkg)) {
            String msg = PaymentApps.isPaymentApp(pkg)
                    ? "Open your personal UPI app" : "Not a payment app";
            s = new Status(C_RED, msg, "✕");
        } else if (AppSignatureVerifier.verify(this, pkg) == AppSignatureVerifier.Result.MISMATCH) {
            s = new Status(C_RED, "App failed signature check", "✕");
        } else if (active) {
            String msg = count > 1 ? (count + " payouts active — tap Capture")
                    : "Payout active — tap Capture";
            s = new Status(C_GREEN, msg, "✓");
        } else {
            s = new Status(C_ORANGE, "No payout in process", "●");
        }
        lastStatus = s;
        return s;
    }

    /** What to SHOW now - a live tap-feedback message briefly overrides the
     *  computed status message (its colour follows the feedback). */
    private Status effectiveStatus() {
        Status s = computeStatus();
        if (feedbackMsg != null && android.os.SystemClock.uptimeMillis() < feedbackUntil) {
            return new Status(feedbackColor, feedbackMsg, feedbackColor == C_RED ? "✕" : "✓");
        }
        return s;
    }

    private void renderIfStatusChanged() {
        Status s = effectiveStatus();
        String key = s.color + "|" + s.message;
        if (key.equals(lastRenderedKey) || currentView == null || windowManager == null) return;
        lastRenderedKey = key;
        try {
            windowManager.removeView(currentView);
        } catch (Exception ignored) {
        }
        currentView = null;
        renderCurrentState();
    }

    private final Runnable statusTick = new Runnable() {
        @Override
        public void run() {
            renderIfStatusChanged();
            statusHandler.postDelayed(this, STATUS_TICK_MS);
        }
    };

    // ---------------------------------------------------------------------
    // Show / hide / minimize / expand
    // ---------------------------------------------------------------------
    public void show() {
        if (currentView != null || windowManager == null
                || !android.provider.Settings.canDrawOverlays(this)) {
            return;
        }
        if (params == null) {
            params = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                    overlayType(), WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                    PixelFormat.TRANSLUCENT);
            params.gravity = Gravity.TOP | Gravity.START;
            params.x = 8;
            params.y = 200;
        }
        renderCurrentState();
    }

    public void hide() {
        if (currentView != null && windowManager != null) {
            try {
                windowManager.removeView(currentView);
            } catch (Exception ignored) {
            }
        }
        currentView = null;
        isVisible = false;
    }

    /** Tap the icon → expand; tap the card's minimize control → collapse.
     *  Rebuilds the view but reuses `params` so screen position survives
     *  the swap (DraggableTouchListener mutates params.x/y directly). */
    private void toggleExpand() {
        expanded = !expanded;
        if (currentView != null && windowManager != null) {
            try {
                windowManager.removeView(currentView);
            } catch (Exception ignored) {
            }
            currentView = null;
        }
        renderCurrentState();
    }

    private void renderCurrentState() {
        View view = expanded ? buildCard() : buildIcon();
        try {
            windowManager.addView(view, params);
            currentView = view;
            isVisible = true;
        } catch (Exception e) {
            Log.e(TAG, "PayoutOverlayService render error: " + e.getMessage());
            currentView = null;
        }
    }

    /** Minimized state — design: 46dp circle, emerald gradient, 60% idle
     *  opacity (72% + thin ring while a payout is active), drag to move,
     *  tap to expand. */
    private View buildIcon() {
        int size = dp(BUBBLE_DP);
        params.width = size;
        params.height = size;
        Status st = effectiveStatus();

        FrameLayout wrap = new FrameLayout(this);

        android.widget.ImageView logo = new android.widget.ImageView(this);
        try {
            logo.setImageDrawable(getPackageManager().getApplicationIcon(getPackageName()));
        } catch (Exception ignored) {
        }
        logo.setScaleType(android.widget.ImageView.ScaleType.CENTER_INSIDE);
        int pad = dp(7);
        logo.setPadding(pad, pad, pad, pad);
        GradientDrawable circle = new GradientDrawable();
        circle.setShape(GradientDrawable.OVAL);
        circle.setColor(0xFFFFFFFF);
        circle.setStroke(dp(3), st.color);
        logo.setBackground(circle);
        wrap.addView(logo, new FrameLayout.LayoutParams(size, size));

        View dot = new View(this);
        GradientDrawable dotBg = new GradientDrawable();
        dotBg.setShape(GradientDrawable.OVAL);
        dotBg.setColor(st.color);
        dotBg.setStroke(dp(1), 0xFFFFFFFF);
        dot.setBackground(dotBg);
        FrameLayout.LayoutParams dotLp = new FrameLayout.LayoutParams(dp(13), dp(13));
        dotLp.gravity = Gravity.TOP | Gravity.END;
        wrap.addView(dot, dotLp);

        wrap.setOnTouchListener(new DraggableTouchListener(params, windowManager, wrap, this::toggleExpand));
        return wrap;
    }

    /**
     * Gradient fill + (while a payout is active) a two-layer ring
     * approximating the design's box-shadow ring: a white inner line so the
     * ring stays legible on both light and dark apps underneath, then an
     * emerald outer line.
     */
    private android.graphics.drawable.Drawable bubbleDrawable() {
        GradientDrawable fill = new GradientDrawable(GradientDrawable.Orientation.TL_BR, BUBBLE_GRADIENT);
        fill.setShape(GradientDrawable.OVAL);
        return fill;
    }

    /** Expanded state — design: 208×100dp card, 97% opaque white, 18dp
     *  radius, a centred drag-handle pill + minimize control in a 26dp
     *  header, Record (filled) + Capture (outline) side by side. */
    private View buildCard() {
        params.width = dp(CARD_W_DP);
        params.height = WindowManager.LayoutParams.WRAP_CONTENT;
        Status st = effectiveStatus();

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable cardBg = new GradientDrawable();
        cardBg.setColor(0xFFFFFFFF);
        cardBg.setCornerRadius(dp(18));
        cardBg.setStroke(dp(2), st.color);
        card.setBackground(cardBg);
        card.setPadding(dp(12), dp(9), dp(12), dp(11));
        card.setAlpha(CARD_ALPHA);

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);

        TextView glyph = new TextView(this);
        glyph.setText(st.icon);
        glyph.setTextColor(st.color);
        glyph.setTextSize(14);
        LinearLayout.LayoutParams glyphLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        glyphLp.setMarginEnd(dp(7));
        top.addView(glyph, glyphLp);

        TextView msg = new TextView(this);
        msg.setText(st.message);
        msg.setTextColor(st.color);
        msg.setTextSize(12.5f);
        msg.setMaxLines(2);
        top.addView(msg, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        TextView minimize = new TextView(this);
        minimize.setText("▾");
        minimize.setTextColor(C_MUTED);
        minimize.setTextSize(16);
        minimize.setGravity(Gravity.CENTER);
        top.addView(minimize, new LinearLayout.LayoutParams(dp(26), dp(24)));
        card.addView(top, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        TextView capture = actionButton("Capture", true);
        LinearLayout.LayoutParams captureLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(40));
        captureLp.topMargin = dp(10);
        card.addView(capture, captureLp);

        minimize.setOnTouchListener(new DraggableTouchListener(params, windowManager, card, this::toggleExpand));
        capture.setOnTouchListener(new DraggableTouchListener(params, windowManager, card, this::onScreenshotTap));

        return card;
    }

    private android.graphics.drawable.Drawable cardBackground() {
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xFFFFFFFF);
        bg.setCornerRadius(dp(18));
        bg.setStroke(dp(1), C_CARD_BORDER);
        return bg;
    }

    /** Record = filled brand (primary); Capture = outline/secondary — the
     *  design separates them by fill, not only by icon (overlay.css
     *  .ov-act.record / .ov-act.capture). */
    private TextView actionButton(String label, boolean primary) {
        TextView tv = new TextView(this);
        tv.setText((primary ? "⏺ " : "📷 ") + label);
        tv.setTextSize(11.5f);
        tv.setGravity(Gravity.CENTER);
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(12));
        if (primary) {
            bg.setColor(C_BRAND);
            tv.setTextColor(0xFFFFFFFF);
        } else {
            bg.setColor(C_SURFACE);
            bg.setStroke(dp(1), C_CAPTURE_BORDER);
            tv.setTextColor(C_BRAND_DARK);
        }
        tv.setBackground(bg);
        return tv;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private int overlayType() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
    }

    // ---------------------------------------------------------------------
    // RECORD — always tappable. Checks conditions on tap and gives clear
    // feedback instead of gating the tap itself; snapshot-only, no
    // screen-reading, no network call here (upload happens on trigger).
    // ---------------------------------------------------------------------


    // ---------------------------------------------------------------------
    // SCREENSHOT — always tappable. Same two checks as Record, then the
    // existing success-page gate; unchanged beyond that.
    // ---------------------------------------------------------------------
    private void onScreenshotTap() {
        PaymentBotService reader = PaymentBotService.getInstance();
        // TEMPORARY DEBUG LOGGING — see onRecordTap's matching note.
        Log.d(TAG, "DIAG onScreenshotTap: currentForegroundPackage=\""
                + (reader == null ? "null-reader" : reader.currentForegroundPackage()) + "\"");
        // Same reordering as onRecordTap — see its comment.
        if (reader == null || reader.currentForegroundPackage().isEmpty()) {
            showFeedback(MSG_NOT_PAYMENT_APP, false);
            return;
        }
        String pkg = reader.currentForegroundPackage();
        // Phase 1b anti-fraud anchor — see onRecordTap. Consumer/personal payout
        // app only, then signature-verified.
        if (!PaymentApps.isPayoutApp(pkg)) {
            showFeedback(MSG_NOT_PAYOUT_APP, false);
            return;
        }
        if (!AppSignatureVerifier.isTrusted(this, pkg)) {
            showFeedback(MSG_UNTRUSTED_APP, false);
            return;
        }
        // At least one payout must be armed — the working slot OR a mirrored
        // list entry (several active with no working slot is a valid state that
        // Phase 2c resolves by content below).
        if (!PayoutState.isActive(this) && PayoutState.activeCount(this) == 0) {
            showFeedback(MSG_NO_PAYOUT, false);
            return;
        }
        String text = reader.currentScreenText();
        if (!matchesSuccessKeyword(pkg, text)) {
            logSuccessKeywordMiss(pkg, text);
            showFeedback(MSG_NOT_SUCCESS, false);
            return; // discard entirely: no file, no partial save
        }
        // TAP-ONLY field extraction (anti-fraud). Read the CURRENT screen text
        // once, right now, at the deliberate Capture tap — NEVER passively. The
        // fields (time, sender bank, last-4s, recipient, txn id, UTR, amount) are
        // saved alongside the screenshot and uploaded with the evidence bundle.
        org.json.JSONObject fields;
        try {
            fields = SuccessScreenParser.parse(pkg, text);
        } catch (Exception e) {
            fields = new org.json.JSONObject();
        }

        // Phase 2c — resolve WHICH armed payout this capture belongs to by its
        // content (amount + recipient account last-4), so a trader running
        // several payouts at once links the evidence to the RIGHT payout instead
        // of whichever was the sticky working slot. This is the fix for genuine
        // payments landing on the wrong payout ("details don't match").
        java.util.List<String> capLast4 = new java.util.ArrayList<>();
        org.json.JSONArray l4 = fields.optJSONArray("last4");
        if (l4 != null) {
            for (int i = 0; i < l4.length(); i++) {
                String v = l4.optString(i, "");
                if (!v.isEmpty()) capLast4.add(v);
            }
        }
        String recipLast4 = fields.optString("recipientLast4", "");
        if (!recipLast4.isEmpty() && !capLast4.contains(recipLast4)) capLast4.add(recipLast4);

        String resolved = PayoutState.resolveOrderIdForCapture(
                PayoutState.activePayouts(this), fields.optString("amount", ""), capLast4);
        final String targetOrderId;
        if (!resolved.isEmpty()) {
            PayoutState.selectWorking(this, resolved); // re-point to the matched payout
            targetOrderId = resolved;
        } else if (PayoutState.isActive(this)) {
            // Single/legacy case, or content couldn't disambiguate but there is a
            // working slot — keep it; the server match gate is the real judge.
            targetOrderId = PayoutState.orderId(this);
        } else {
            // Several armed, none uniquely matched, and no working slot to fall
            // back to — refuse rather than link a real payment to a guessed payout.
            showFeedback(MSG_CANT_RESOLVE, false);
            return;
        }

        // Issue 1 — one real payment = one capture. Refuse a repeat for the SAME
        // payout; show a clear "done" state instead of re-uploading.
        if (PayoutState.isCaptured(this, targetOrderId)) {
            showFeedback(MSG_ALREADY_CAPTURED, true);
            return;
        }

        PayoutState.saveExtractedFields(this, fields.toString());
        // The screenshot is OPTIONAL and captured via the ACCESSIBILITY service's
        // own takeScreenshot() (API 30+) — no MediaProjection, no consent dialog,
        // no foreground service. The accessibility-extracted fields above are what
        // power the match gate; the screenshot is only a supplementary visual. So
        // upload the fields regardless, and add a screenshot as best-effort
        // enrichment when takeScreenshot is available and succeeds. A missing /
        // failed screenshot must NEVER block the trader from completing a payout.
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            showFeedback("Capturing...", false);
            reader.takePayoutScreenshot(jpeg -> new Thread(() -> {
                if (jpeg != null) PayoutState.saveScreenshot(this, jpeg);
                PayoutState.uploadBundle(this, "capture");
                PayoutState.markCaptured(this, targetOrderId);
                postFeedback(MSG_CAPTURED, true);
            }).start());
        } else {
            // Below Android 11 the accessibility screenshot API doesn't exist —
            // upload the text-only evidence (still fully verifiable by the gate).
            PayoutState.uploadBundle(this, "capture");
            PayoutState.markCaptured(this, targetOrderId);
            postFeedback(MSG_CAPTURED, true);
        }
    }

    /** Pure — package-visible + static for PayoutStateTest. */
    static boolean matchesSuccessKeyword(String pkg, String screenText) {
        if (screenText == null) return false;
        String t = screenText.toLowerCase();
        // Per-app seed wording (fast path).
        String[] keywords = SUCCESS_KEYWORDS.get(pkg);
        if (keywords != null) {
            for (String k : keywords) {
                if (t.contains(k)) return true;
            }
        }
        // General success wording — ONLY for a recognized payout app, so an
        // unknown / non-payout package still fails closed. This is what stops a
        // real success screen (e.g. PhonePe's "Transaction Successful") being
        // rejected just because its exact phrase wasn't in the per-app seed.
        if (PaymentApps.isPayoutApp(pkg)) {
            for (String k : GENERAL_SUCCESS_KEYWORDS) {
                if (t.contains(k)) return true;
            }
        }
        return false;
    }

    /** Same seed-list-tuning pattern as ParseFailureLogger elsewhere — logs
     *  misses for later review instead of silently discarding the signal. */
    private void logSuccessKeywordMiss(String pkg, String screenText) {
        ParseFailureLogger.log(this, "PAYOUT_SUCCESS_SCREEN", pkg == null ? "" : pkg,
                screenText == null ? "" : screenText, "payout_success_keyword_miss");
    }

    // ---------------------------------------------------------------------
    // Feedback snackbar — design: overlay.css .ov-snack / OverlaySnack.
    // Positioned adjacent to the widget (above if there's room, else
    // below; horizontally aligned to whichever third of the screen the
    // widget sits in — "never centred on the screen, feedback has to read
    // as belonging to the widget"), colored by kind, with an icon.
    // FLAG_NOT_TOUCHABLE — must never swallow a tap meant for the app
    // underneath (matches the design's own comment on this exact point).
    // ---------------------------------------------------------------------
    // Package-visible for the same reason as the constant above.
    void postFeedback(String message, boolean success) {
        new Handler(Looper.getMainLooper()).post(() -> showFeedback(message, success));
    }

    private void showFeedback(String message, boolean success) {
        feedbackMsg = message;
        feedbackColor = success ? C_GREEN : C_RED;
        feedbackUntil = android.os.SystemClock.uptimeMillis() + 2500L;
        renderIfStatusChanged();
    }

    /**
     * Places the snackbar relative to the widget's current position — above
     * it if there's room, otherwise below; horizontally aligned to whichever
     * third of the screen the widget sits in. Falls back to a fixed
     * top-center position if the widget hasn't been shown yet (params null).
     */
    private void placeSnackbar(WindowManager.LayoutParams fbParams) {
        if (params == null) {
            fbParams.gravity = Gravity.TOP | Gravity.CENTER;
            fbParams.y = dp(100);
            return;
        }
        int metricsWidth = getResources().getDisplayMetrics().widthPixels;
        int widgetW = expanded ? dp(CARD_W_DP) : dp(BUBBLE_DP);
        int gap = dp(8);
        boolean roomAbove = params.y - gap - dp(34) >= 0;
        fbParams.gravity = Gravity.TOP | Gravity.START;
        fbParams.y = roomAbove ? Math.max(0, params.y - gap - dp(34)) : params.y + dp(34) + gap;

        int widgetCentre = params.x + widgetW / 2;
        if (widgetCentre < metricsWidth * 0.36) {
            fbParams.x = params.x;
        } else if (widgetCentre > metricsWidth * 0.64) {
            fbParams.x = Math.max(0, params.x + widgetW - dp(140));
        } else {
            fbParams.x = Math.max(0, widgetCentre - dp(70));
        }
    }
}
