package com.example.paymentbot;

import android.app.Service;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
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
 * FEATURE 2 — Payout evidence capture overlay: floating RECORD + SCREENSHOT
 * buttons. Visibility is fully trader-controlled (PaymentModeState) —
 * present everywhere, in every app, whenever Payment Mode is ON, subject
 * only to its own minimize/expand state (see PaymentBotService). Both
 * buttons are ALWAYS tappable — there is no disabled state. Tapping
 * without an active payout, or outside a whitelisted UPI app, shows a
 * feedback message and takes no further action instead of silently
 * blocking the tap (see onRecordTap/onScreenshotTap).
 *
 * Detection, capture, packaging, upload of evidence ONLY — no matching,
 * scoring, or approve/reject logic here or anywhere in this feature; that is
 * entirely backend/admin's job. See PayoutState for the local evidence store
 * and the upload trigger.
 *
 * Deliberately a SEPARATE file from OverlayService, even though it reuses
 * the same draggable floating-window/button pattern: OverlayService's
 * RECORD/SCREENSHOT already mean something else (live NGO-input capture /
 * immediate-upload screenshot) for a different, unrelated feature — folding
 * this in would conflate two different "Record"/"Screenshot" semantics
 * under one class.
 */
public class PayoutOverlayService extends Service {

    private static final String TAG = "PaymentBot";

    private static PayoutOverlayService instance;
    private WindowManager windowManager;
    private View currentView;
    private WindowManager.LayoutParams params;
    // Payment Mode opens straight to the full card — trader taps minimize
    // to collapse to the icon, not the other way round.
    private boolean expanded = true;
    private View feedbackView;
    private boolean isVisible = false;

    private static MediaProjection mediaProjection;
    private static int screenWidth;
    private static int screenHeight;
    private static int screenDensity;

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

    /** Minimized state: a small circular icon, ~12% of screen width (within
     *  the 10-15% range), ~30% transparent, draggable, tap to expand. */
    private View buildIcon() {
        int size = (int) (getResources().getDisplayMetrics().widthPixels * 0.12f);
        params.width = size;
        params.height = size;

        TextView icon = new TextView(this);
        icon.setText("💰");
        icon.setTextSize(20);
        icon.setGravity(Gravity.CENTER);
        icon.setTextColor(0xFFFFFFFF);

        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(0xFF6600CC);
        icon.setBackground(bg);
        icon.setAlpha(0.7f); // ~30% transparent

        icon.setOnTouchListener(new DraggableTouchListener(params, windowManager, icon, this::toggleExpand));
        return icon;
    }

    /** Expanded state: RECORD + SCREENSHOT (always tappable — see
     *  onRecordTap/onScreenshotTap) + a minimize control. ~10% transparent. */
    private View buildCard() {
        params.width = dp(150);
        params.height = WindowManager.LayoutParams.WRAP_CONTENT;

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackgroundColor(0xFF1A0033);
        card.setPadding(dp(4), dp(4), dp(4), dp(4));
        card.setAlpha(0.9f); // ~10% transparent

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.END);
        TextView minimize = new TextView(this);
        minimize.setText("—");
        minimize.setTextColor(0xFFFFFFFF);
        minimize.setTextSize(14);
        minimize.setPadding(dp(8), dp(2), dp(8), dp(2));
        header.addView(minimize);
        card.addView(header);

        TextView record = button("⏺ RECORD", 0xFF333333);
        TextView shot = button("📷 SCREENSHOT", 0xFF6600CC);
        card.addView(record);
        card.addView(shot);

        minimize.setOnTouchListener(new DraggableTouchListener(params, windowManager, card, this::toggleExpand));
        record.setOnTouchListener(new DraggableTouchListener(params, windowManager, card, this::onRecordTap));
        shot.setOnTouchListener(new DraggableTouchListener(params, windowManager, card, this::onScreenshotTap));

        return card;
    }

    private TextView button(String text, int color) {
        TextView tv = new TextView(this);
        tv.setText(text);
        tv.setTextColor(0xFFFFFFFF);
        tv.setTextSize(12);
        tv.setGravity(Gravity.CENTER);
        tv.setBackgroundColor(color);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(44));
        lp.bottomMargin = dp(4);
        tv.setLayoutParams(lp);
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
        if (!PayoutState.isActive(this)) {
            showFeedback("No payout in process");
            return;
        }
        PaymentBotService reader = PaymentBotService.getInstance();
        // currentForegroundPackage() is only ever non-empty while a
        // whitelisted UPI app is foregrounded — PaymentBotService's own
        // isPaymentApp(pkg) gate sets/clears it, so reusing it here means
        // no second whitelist copy.
        if (reader == null || reader.currentForegroundPackage().isEmpty()) {
            showFeedback("Open your payment app first");
            return;
        }
        PayoutState.recordConfirmation(this);
        showFeedback("✅ Recorded");
    }

    // ---------------------------------------------------------------------
    // SCREENSHOT — always tappable. Same two checks as Record, then the
    // existing success-page gate; unchanged beyond that.
    // ---------------------------------------------------------------------
    private void onScreenshotTap() {
        if (!PayoutState.isActive(this)) {
            showFeedback("No payout in process");
            return;
        }
        PaymentBotService reader = PaymentBotService.getInstance();
        if (reader == null || reader.currentForegroundPackage().isEmpty()) {
            showFeedback("Open your payment app first");
            return;
        }
        String pkg = reader.currentForegroundPackage();
        String text = reader.currentScreenText();
        if (!matchesSuccessKeyword(pkg, text)) {
            logSuccessKeywordMiss(pkg, text);
            showFeedback("Not a success screen — retry");
            return; // discard entirely: no file, no partial save
        }
        if (mediaProjection == null) {
            showFeedback("Enable screenshot permission");
            return;
        }
        showFeedback("Capturing...");
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
                    postFeedback("Try again");
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
                postFeedback(saved ? "✅ Saved (local)" : "Save failed — retry");
            } catch (Exception e) {
                Log.e(TAG, "Screenshot error: " + e.getMessage());
                postFeedback("Error: " + e.getMessage());
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
    // Feedback toast
    // ---------------------------------------------------------------------
    private void postFeedback(String message) {
        new Handler(Looper.getMainLooper()).post(() -> showFeedback(message));
    }

    private void showFeedback(String message) {
        if (windowManager == null) return;
        if (feedbackView != null) {
            try { windowManager.removeView(feedbackView); } catch (Exception ignored) {}
            feedbackView = null;
        }
        TextView tv = new TextView(this);
        tv.setText(message);
        tv.setTextColor(0xFF000000);
        tv.setBackgroundColor(0xFFFFFFFF);
        tv.setPadding(20, 10, 20, 10);
        tv.setTextSize(13);
        feedbackView = tv;

        WindowManager.LayoutParams fbParams = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                overlayType(), WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                PixelFormat.TRANSLUCENT);
        fbParams.gravity = Gravity.TOP | Gravity.CENTER;
        fbParams.y = 100;
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
}
