package com.example.paymentbot;

import android.app.Service;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.LayerDrawable;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
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

    private static MediaProjection mediaProjection;
    private static int screenWidth;
    private static int screenHeight;
    private static int screenDensity;

    // ---- Design tokens — MaxPayDesign src/Overlay/overlay.css .ov-lab ----
    private static final int C_BRAND = 0xFF0F6A5A;
    private static final int C_BRAND_DARK = 0xFF0A5748;
    private static final int C_BRAND_MID = 0xFF2A8C77;
    private static final int C_BRAND_SOFT = 0xFFE7F6F2;
    private static final int C_SURFACE = 0xFFF1F6F4;
    private static final int C_TEXT = 0xFF103C34;
    private static final int C_MUTED = 0xFF667B76;
    private static final int C_SUCCESS = 0xFF169B62;
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
    private static final String MSG_NO_PERMISSION = "Screen capture permission needed";
    // Package-visible — read by EventUploadWorker, which owns the actual
    // HTTP delivery of PayoutState.uploadBundle()'s queued POST (see
    // EventQueue's offline-durable pipeline) and is the only place a 409
    // from /payout-evidence is actually observed.
    static final String MSG_ALREADY_SUBMITTED_ELSEWHERE = "Already submitted from another device";

    // Seed list, same pattern as BankSenderTags/ParseFailureLogger elsewhere
    // in this app: 2-3 keywords per app, deliberately small at first —
    // misses are logged via logSuccessKeywordMiss() below for real-traffic
    // review before this list gets extended.
    private static final Map<String, String[]> SUCCESS_KEYWORDS = new HashMap<>();
    static {
        SUCCESS_KEYWORDS.put("com.google.android.apps.nbu.paisa.user",
                new String[]{"payment successful", "money sent", "completed"});
        SUCCESS_KEYWORDS.put("com.google.android.apps.nbu.paisa.merchant",
                new String[]{"payment successful", "money sent", "completed"});
        SUCCESS_KEYWORDS.put("com.phonepe.app",
                new String[]{"transfer successful", "money sent"});
        SUCCESS_KEYWORDS.put("com.phonepe.app.business",
                new String[]{"transfer successful", "money sent"});
        SUCCESS_KEYWORDS.put("net.one97.paytm",
                new String[]{"payment successful", "money sent successfully"});
        SUCCESS_KEYWORDS.put("com.paytm.business",
                new String[]{"payment successful", "money sent successfully"});
        // BHIM intentionally omitted — package id unverified, see PR notes.
    }

    public static PayoutOverlayService getInstance() {
        return instance;
    }

    /** Set from MainActivity's existing MediaProjection consent flow — the
     *  same one-time grant OverlayService.setMediaProjection() receives. */
    public static void setMediaProjection(MediaProjection mp, int w, int h, int d) {
        mediaProjection = mp;
        screenWidth = w;
        screenHeight = h;
        screenDensity = d;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
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

        TextView icon = new TextView(this);
        icon.setText("💰");
        icon.setTextSize(20);
        icon.setGravity(Gravity.CENTER);
        icon.setTextColor(0xFFFFFFFF);
        icon.setBackground(bubbleDrawable());
        icon.setAlpha(activePayout ? BUBBLE_ACTIVE_ALPHA : BUBBLE_IDLE_ALPHA);

        icon.setOnTouchListener(new DraggableTouchListener(params, windowManager, icon, this::toggleExpand));
        return icon;
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
        if (!activePayout) {
            return fill;
        }
        GradientDrawable whiteRing = new GradientDrawable();
        whiteRing.setShape(GradientDrawable.OVAL);
        whiteRing.setColor(0x00000000);
        whiteRing.setStroke(dp(2), 0xEBFFFFFF);
        GradientDrawable emeraldRing = new GradientDrawable();
        emeraldRing.setShape(GradientDrawable.OVAL);
        emeraldRing.setColor(0x00000000);
        emeraldRing.setStroke(dp(2), C_SUCCESS);
        LayerDrawable layered = new LayerDrawable(new android.graphics.drawable.Drawable[]{fill, whiteRing, emeraldRing});
        layered.setLayerInset(1, dp(1), dp(1), dp(1), dp(1));
        layered.setLayerInset(2, 0, 0, 0, 0);
        return layered;
    }

    /** Expanded state — design: 208×100dp card, 97% opaque white, 18dp
     *  radius, a centred drag-handle pill + minimize control in a 26dp
     *  header, Record (filled) + Capture (outline) side by side. */
    private View buildCard() {
        params.width = dp(CARD_W_DP);
        params.height = dp(CARD_H_DP);

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackground(cardBackground());
        card.setPadding(dp(8), dp(8), dp(8), dp(8));
        card.setAlpha(CARD_ALPHA);

        // Header: active-dot (conditional) + centred drag handle + minimize.
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(26)));

        if (activePayout) {
            View dot = new View(this);
            GradientDrawable dotBg = new GradientDrawable();
            dotBg.setShape(GradientDrawable.OVAL);
            dotBg.setColor(C_SUCCESS);
            dot.setBackground(dotBg);
            LinearLayout.LayoutParams dotLp = new LinearLayout.LayoutParams(dp(6), dp(6));
            dotLp.setMarginStart(dp(2));
            header.addView(dot, dotLp);
        }

        // Decorative-only handle, optically centred via a weighted spacer
        // either side (matches the design's absolute-centre positioning).
        View spacerL = new View(this);
        header.addView(spacerL, new LinearLayout.LayoutParams(0, 0, 1f));

        View handle = new View(this);
        GradientDrawable handleBg = new GradientDrawable();
        handleBg.setColor(C_HANDLE);
        handleBg.setCornerRadius(dp(2));
        handle.setBackground(handleBg);
        header.addView(handle, new LinearLayout.LayoutParams(dp(34), dp(4)));

        View spacerR = new View(this);
        header.addView(spacerR, new LinearLayout.LayoutParams(0, 0, 1f));

        TextView minimize = new TextView(this);
        minimize.setText("▾");
        minimize.setTextColor(C_MUTED);
        minimize.setTextSize(16);
        minimize.setGravity(Gravity.CENTER);
        header.addView(minimize, new LinearLayout.LayoutParams(dp(30), dp(26)));

        card.addView(header);

        // Actions — side by side (design: 2-column grid), not stacked.
        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams actionsLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f);
        actionsLp.topMargin = dp(8);
        actions.setLayoutParams(actionsLp);

        TextView record = actionButton("Record", true);
        TextView capture = actionButton("Capture", false);
        LinearLayout.LayoutParams recordLp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f);
        LinearLayout.LayoutParams captureLp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f);
        captureLp.setMarginStart(dp(8));
        actions.addView(record, recordLp);
        actions.addView(capture, captureLp);
        card.addView(actions);

        minimize.setOnTouchListener(new DraggableTouchListener(params, windowManager, card, this::toggleExpand));
        record.setOnTouchListener(new DraggableTouchListener(params, windowManager, card, this::onRecordTap));
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
    private void onRecordTap() {
        PaymentBotService reader = PaymentBotService.getInstance();
        // currentForegroundPackage() is only ever non-empty while a
        // whitelisted UPI app is foregrounded — PaymentBotService's own
        // isPaymentApp(pkg) gate sets/clears it, so reusing it here means
        // no second whitelist copy.
        // TEMPORARY DEBUG LOGGING — real-device root-cause investigation,
        // see PaymentBotService.onAccessibilityEvent's matching note.
        Log.d(TAG, "DIAG onRecordTap: currentForegroundPackage=\""
                + (reader == null ? "null-reader" : reader.currentForegroundPackage()) + "\"");
        // App-whitelist checked FIRST, payout-active checked second: "you're
        // not even in a payment app" is the more specific, more actionable
        // fact when both conditions are false. Checking isActive() first
        // meant standing on the home screen with no payout running showed
        // "No payout in process" — technically true, but it hid the more
        // basic problem (wrong app) behind a less useful message.
        if (reader == null || reader.currentForegroundPackage().isEmpty()) {
            showFeedback(MSG_NOT_PAYMENT_APP, false);
            return;
        }
        if (!PayoutState.isActive(this)) {
            showFeedback(MSG_NO_PAYOUT, false);
            return;
        }
        PayoutState.recordConfirmation(this);
        showFeedback(MSG_RECORDED, true);
    }

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
        if (!PayoutState.isActive(this)) {
            showFeedback(MSG_NO_PAYOUT, false);
            return;
        }
        String pkg = reader.currentForegroundPackage();
        String text = reader.currentScreenText();
        if (!matchesSuccessKeyword(pkg, text)) {
            logSuccessKeywordMiss(pkg, text);
            showFeedback(MSG_NOT_SUCCESS, false);
            return; // discard entirely: no file, no partial save
        }
        if (mediaProjection == null) {
            showFeedback(MSG_NO_PERMISSION, false);
            return;
        }
        showFeedback("Capturing...", false);
        captureAndSaveLocally();
    }

    /** Pure — package-visible + static for PayoutStateTest. */
    static boolean matchesSuccessKeyword(String pkg, String screenText) {
        String[] keywords = SUCCESS_KEYWORDS.get(pkg);
        if (keywords == null || screenText == null) return false;
        String t = screenText.toLowerCase();
        for (String k : keywords) {
            if (t.contains(k)) return true;
        }
        return false;
    }

    /** Same seed-list-tuning pattern as ParseFailureLogger elsewhere — logs
     *  misses for later review instead of silently discarding the signal. */
    private void logSuccessKeywordMiss(String pkg, String screenText) {
        ParseFailureLogger.log(this, "PAYOUT_SUCCESS_SCREEN", pkg == null ? "" : pkg,
                screenText == null ? "" : screenText, "payout_success_keyword_miss");
    }

    private void captureAndSaveLocally() {
        new Thread(() -> {
            ImageReader imageReader = null;
            VirtualDisplay virtualDisplay = null;
            try {
                imageReader = ImageReader.newInstance(
                        screenWidth, screenHeight, PixelFormat.RGBA_8888, 2);
                try {
                    mediaProjection.registerCallback(new MediaProjection.Callback() {
                    }, new Handler(Looper.getMainLooper()));
                } catch (Exception ignored) {
                }
                virtualDisplay = mediaProjection.createVirtualDisplay(
                        "payout_evidence", screenWidth, screenHeight, screenDensity,
                        DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                        imageReader.getSurface(), null, null);

                Thread.sleep(300);
                Image image = imageReader.acquireLatestImage();
                if (image == null) {
                    postFeedback("Try again", false);
                    return;
                }
                Image.Plane[] planes = image.getPlanes();
                ByteBuffer buffer = planes[0].getBuffer();
                int pixelStride = planes[0].getPixelStride();
                int rowStride = planes[0].getRowStride();
                int rowPadding = rowStride - pixelStride * screenWidth;

                Bitmap bitmap = Bitmap.createBitmap(
                        screenWidth + rowPadding / pixelStride, screenHeight, Bitmap.Config.ARGB_8888);
                bitmap.copyPixelsFromBuffer(buffer);
                image.close();
                if (rowPadding != 0) {
                    Bitmap cropped = Bitmap.createBitmap(bitmap, 0, 0, screenWidth, screenHeight);
                    bitmap.recycle();
                    bitmap = cropped;
                }

                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                bitmap.compress(Bitmap.CompressFormat.JPEG, 70, baos);
                bitmap.recycle();

                boolean saved = PayoutState.saveScreenshot(this, baos.toByteArray());
                postFeedback(saved ? MSG_CAPTURED : "Save failed — retry", saved);
            } catch (Exception e) {
                Log.e(TAG, "Screenshot error: " + e.getMessage());
                postFeedback("Error: " + e.getMessage(), false);
            } finally {
                if (virtualDisplay != null) {
                    try { virtualDisplay.release(); } catch (Exception ignored) {}
                }
                if (imageReader != null) {
                    try { imageReader.close(); } catch (Exception ignored) {}
                }
            }
        }).start();
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
        if (windowManager == null) return;
        if (feedbackView != null) {
            try { windowManager.removeView(feedbackView); } catch (Exception ignored) {}
            feedbackView = null;
        }

        LinearLayout snack = new LinearLayout(this);
        snack.setOrientation(LinearLayout.HORIZONTAL);
        snack.setGravity(Gravity.CENTER_VERTICAL);
        snack.setPadding(dp(10), dp(7), dp(12), dp(7));
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(11));
        if (success) {
            bg.setColor(C_SNACK_SUCCESS_BG);
            bg.setStroke(dp(1), C_SNACK_SUCCESS_BORDER);
        } else {
            bg.setColor(C_SNACK_INFO_BG);
            bg.setStroke(dp(1), C_SNACK_INFO_BORDER);
        }
        snack.setBackground(bg);
        snack.setMinimumHeight(dp(34));

        TextView icon = new TextView(this);
        icon.setText(success ? "✅" : "ℹ️");
        icon.setTextSize(13);
        LinearLayout.LayoutParams iconLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        iconLp.setMarginEnd(dp(7));
        snack.addView(icon, iconLp);

        TextView text = new TextView(this);
        text.setText(message);
        text.setTextColor(success ? C_SNACK_SUCCESS_TEXT : C_TEXT);
        text.setTextSize(12);
        snack.addView(text);

        feedbackView = snack;

        WindowManager.LayoutParams fbParams = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                overlayType(), WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                PixelFormat.TRANSLUCENT);
        placeSnackbar(fbParams);
        try {
            windowManager.addView(feedbackView, fbParams);
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                if (feedbackView != null) {
                    try { windowManager.removeView(feedbackView); } catch (Exception ignored) {}
                    feedbackView = null;
                }
            }, 3000);
        } catch (Exception ignored) {
        }
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
