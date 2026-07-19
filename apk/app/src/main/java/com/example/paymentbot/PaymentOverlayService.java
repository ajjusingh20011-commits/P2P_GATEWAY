package com.example.paymentbot;

import android.app.Service;
import android.content.Intent;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Floating overlay UI for the fully-automatic capture flow.
 *
 * <ul>
 *   <li>{@link #showBadge(String)} — passive "watching" chip while a payment
 *       app is open (capture happens silently in the background).</li>
 *   <li>{@link #showSuccessNotification} — brief confirmation after an outgoing
 *       payment is auto-captured, with an optional "Add Purpose" action.</li>
 *   <li>{@link #showPurposeInput} — quick purpose picker the NGO may tap.</li>
 * </ul>
 *
 * Requires the SYSTEM_ALERT_WINDOW permission.
 */
public class PaymentOverlayService extends Service {

    private static final String TAG = "PaymentBot";

    private WindowManager windowManager;
    private View badgeView;
    private View notificationView;
    private View purposeView;

    private static PaymentOverlayService instance;

    public static PaymentOverlayService getInstance() {
        return instance;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        Log.d(TAG, "PaymentOverlayService created");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Sticky so the OS restarts it (and re-registers the instance) if killed.
        return START_STICKY;
    }

    // ---------------------------------------------------------------------
    // Passive badge
    // ---------------------------------------------------------------------
    public void showBadge(String appName) {
        if (!canOverlay()) {
            return;
        }
        hideBadge();

        LinearLayout chip = new LinearLayout(this);
        chip.setOrientation(LinearLayout.HORIZONTAL);
        chip.setBackgroundColor(0xCC000000);
        chip.setPadding(16, 8, 16, 8);
        chip.setGravity(Gravity.CENTER_VERTICAL);

        TextView eye = new TextView(this);
        eye.setText("👁 ");
        eye.setTextColor(0xFF00FF88);
        eye.setTextSize(12);
        chip.addView(eye);

        TextView label = new TextView(this);
        label.setText("PaymentBot • " + (appName == null ? "" : appName));
        label.setTextColor(0xFF00FF88);
        label.setTextSize(11);
        label.setTypeface(null, Typeface.BOLD);
        chip.addView(label);

        badgeView = chip;

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                overlayType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = 16;
        params.y = 40;

        try {
            windowManager.addView(badgeView, params);
        } catch (Exception e) {
            Log.e(TAG, "Badge error: " + e.getMessage());
            badgeView = null;
        }
    }

    public void hideBadge() {
        if (badgeView != null && windowManager != null) {
            try {
                windowManager.removeView(badgeView);
            } catch (Exception ignored) {
            }
            badgeView = null;
        }
    }

    // ---------------------------------------------------------------------
    // Success notification
    // ---------------------------------------------------------------------
    public void showSuccessNotification(String app, String recipientName,
                                        String amount, String utr) {
        if (!canOverlay()) {
            return;
        }
        hideNotification();

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackgroundColor(0xEE000000);
        card.setPadding(20, 14, 20, 14);

        // Success icon + title row.
        LinearLayout titleRow = new LinearLayout(this);
        titleRow.setOrientation(LinearLayout.HORIZONTAL);

        TextView icon = new TextView(this);
        icon.setText("✅ ");
        icon.setTextColor(0xFF00FF88);
        icon.setTextSize(14);
        titleRow.addView(icon);

        TextView title = new TextView(this);
        title.setText("Payment Captured!");
        title.setTextColor(0xFF00FF88);
        title.setTextSize(13);
        title.setTypeface(null, Typeface.BOLD);
        titleRow.addView(title);
        card.addView(titleRow);

        // Amount and name.
        TextView details = new TextView(this);
        details.setText("₹" + amount
                + (recipientName != null && !recipientName.isEmpty() ? " → " + recipientName : "")
                + "\nvia " + app);
        details.setTextColor(0xFFCCCCCC);
        details.setTextSize(12);
        details.setPadding(0, 6, 0, 6);
        card.addView(details);

        // UTR if available.
        if (utr != null && !utr.isEmpty()) {
            TextView utrView = new TextView(this);
            utrView.setText("UTR: " + utr);
            utrView.setTextColor(0xFF4488FF);
            utrView.setTextSize(11);
            card.addView(utrView);
        }

        // Purpose + dismiss buttons.
        LinearLayout btnRow = new LinearLayout(this);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        btnRow.setPadding(0, 10, 0, 0);

        Button purposeBtn = new Button(this);
        purposeBtn.setText("Add Purpose");
        purposeBtn.setBackgroundColor(0xFF333333);
        purposeBtn.setTextColor(0xFFFFFFFF);
        purposeBtn.setTextSize(11);
        purposeBtn.setPadding(12, 4, 12, 4);

        Button dismissBtn = new Button(this);
        dismissBtn.setText("✕");
        dismissBtn.setBackgroundColor(0xFF222222);
        dismissBtn.setTextColor(0xFF888888);
        dismissBtn.setTextSize(11);
        dismissBtn.setPadding(12, 4, 12, 4);
        dismissBtn.setOnClickListener(v -> hideNotification());

        final String fAmount = amount;
        final String fName = recipientName;
        final String fUtr = utr;

        purposeBtn.setOnClickListener(v -> {
            hideNotification();
            showPurposeInput(fAmount, fName, fUtr);
        });

        LinearLayout.LayoutParams purposeParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 3f);
        purposeParams.setMarginEnd(8);
        LinearLayout.LayoutParams dismissParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);

        btnRow.addView(purposeBtn, purposeParams);
        btnRow.addView(dismissBtn, dismissParams);
        card.addView(btnRow);

        notificationView = card;

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                650,
                WindowManager.LayoutParams.WRAP_CONTENT,
                overlayType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.BOTTOM | Gravity.CENTER;
        params.y = 80;

        try {
            windowManager.addView(notificationView, params);
            Log.d(TAG, "Success notification shown");

            // Auto dismiss after 8 seconds.
            new Handler(Looper.getMainLooper()).postDelayed(this::hideNotification, 8000);
        } catch (Exception e) {
            Log.e(TAG, "Notification error: " + e.getMessage());
        }
    }

    // ---------------------------------------------------------------------
    // Purpose input
    // ---------------------------------------------------------------------
    public void showPurposeInput(String amount, String recipientName, String utr) {
        if (!canOverlay()) {
            return;
        }
        hidePurposeView();

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setBackgroundColor(0xEE0A0A0A);
        panel.setPadding(20, 16, 20, 16);

        TextView title = new TextView(this);
        title.setText("Add purpose for ₹" + amount + " to " + recipientName);
        title.setTextColor(0xFFFFFFFF);
        title.setTextSize(13);
        title.setPadding(0, 0, 0, 12);
        panel.addView(title);

        String[] purposes = {
                "Volunteer Payment",
                "Field Work",
                "Teaching",
                "Transport",
                "Medical Aid",
                "Food Supply",
                "Other"
        };

        for (String purpose : purposes) {
            Button btn = new Button(this);
            btn.setText(purpose);
            btn.setBackgroundColor(0xFF1A1A1A);
            btn.setTextColor(0xFF00FF88);
            btn.setTextSize(12);

            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT);
            p.setMargins(0, 4, 0, 4);

            final String selectedPurpose = purpose;
            btn.setOnClickListener(v -> {
                sendPurposeToServer(utr, selectedPurpose);
                hidePurposeView();
                MainActivity.addLog("✅ Purpose added: " + selectedPurpose + " for Rs." + amount);
            });
            panel.addView(btn, p);
        }

        Button cancelBtn = new Button(this);
        cancelBtn.setText("Skip");
        cancelBtn.setBackgroundColor(0xFF333333);
        cancelBtn.setTextColor(0xFF888888);
        cancelBtn.setTextSize(12);
        cancelBtn.setOnClickListener(v -> hidePurposeView());
        panel.addView(cancelBtn);

        purposeView = panel;

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                700,
                WindowManager.LayoutParams.WRAP_CONTENT,
                overlayType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.BOTTOM | Gravity.CENTER;
        params.y = 80;

        try {
            windowManager.addView(purposeView, params);
        } catch (Exception e) {
            Log.e(TAG, "Purpose view error: " + e.getMessage());
        }
    }

    private void sendPurposeToServer(String utr, String purpose) {
        final String fUtr = utr == null ? "" : utr;
        final String fPurpose = purpose == null ? "" : purpose;

        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                JSONObject json = new JSONObject();
                json.put("utr", fUtr);
                json.put("purpose", fPurpose);

                URL url = new URL(Config.EP_UPDATE_PURPOSE);
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

                Log.d(TAG, "Purpose sent: " + conn.getResponseCode());
            } catch (Exception e) {
                Log.e(TAG, "Purpose send error: " + e.getMessage());
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        }).start();
    }

    // ---------------------------------------------------------------------
    // Teardown
    // ---------------------------------------------------------------------
    public void hideNotification() {
        if (notificationView != null && windowManager != null) {
            try {
                windowManager.removeView(notificationView);
            } catch (Exception ignored) {
            }
            notificationView = null;
        }
    }

    public void hidePurposeView() {
        if (purposeView != null && windowManager != null) {
            try {
                windowManager.removeView(purposeView);
            } catch (Exception ignored) {
            }
            purposeView = null;
        }
    }

    public void hideAll() {
        hideBadge();
        hideNotification();
        hidePurposeView();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        hideAll();
        instance = null;
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------
    private int overlayType() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
    }

    private boolean canOverlay() {
        if (windowManager == null) {
            return false;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            Log.w(TAG, "Overlay permission not granted");
            return false;
        }
        return true;
    }
}
