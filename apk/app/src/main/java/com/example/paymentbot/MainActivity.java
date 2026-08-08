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
 * The visible UI is the "Working" home screen + a Logs tab (the live capture
 * feed of every SMS/notification card) + Settings. Engines push captures in
 * via the thread-safe static {@link #addSMS(SMSData)} hook; {@link #addLog(String)}
 * and {@link #addPayment(PaymentData)} are compatibility shims kept so the
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

    // allMessages above is process-lifetime only — true for a background-
    // service-driven app that gets killed by the OS routinely, not rarely.
    // This guards a one-time load from LogStore (real on-device SQLite
    // storage) into allMessages per process, so capture history survives
    // process death without re-reading the DB on every activity recreation
    // (rotation, multi-window, etc. within the same still-alive process).
    private static boolean loadedFromDisk = false;

    // The local debug feed is a rolling window of the most recent captures only.
    // The real event data is posted to the server immediately on capture, so
    // this cap has no effect on data delivery — it just stops the static list
    // (and the on-screen card tree) from growing without bound and OOM-crashing
    // the long-lived process.
    //
    // Log-storage audit, item 2: this is also the Logs tab's default on-screen
    // view size. Full history beyond this is never lost — it's independently
    // persisted in LogStore (5,000-row cap) and stays reachable via the
    // Download/export buttons (buildLogTextAsync() reads LogStore.loadAll()
    // directly, not this in-memory list) — only what's *displayed* by default
    // is capped here.
    private static final int MAX_ENTRIES = 100;

    private LinearLayout messageContainer;
    private TextView emptyView;

    // New UI state.
    private LinearLayout homePage;
    private LinearLayout logsPage;
    private LinearLayout settingsPage;
    private TextView deviceNameLabel;
    private TextView homeTab;
    private TextView logsTab;
    private TextView settingsTab;
    private TextView statusBadge;

    // A third accent color for "online but not capturing" — distinct from
    // the existing green (capturing fine) and the red used for permission
    // errors elsewhere in the app.
    private static final int AMBER_PRIMARY = 0xFFB26A00;
    private static final int AMBER_LIGHT_BG = 0xFFFFF3E0;

    // Auto-refresh the "x min ago" labels on the (hidden) feed once a minute.
    private final Handler timeHandler = new Handler(Looper.getMainLooper());
    private final Runnable timeRunnable = new Runnable() {
        @Override
        public void run() {
            refreshAllTimes();
            updateStatusBadge();
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
        loadPersistedLogsIfNeeded();
        UpdateCheckWorker.checkNow(this);

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
        updateStatusBadge();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        timeHandler.removeCallbacks(timeRunnable);
    }

    /**
     * One-time-per-process load of persisted capture history from LogStore
     * into allMessages, so the feed isn't empty after the process was killed
     * and restarted (previously allMessages was in-memory only — this is the
     * actual fix for that; a bounded, indexed read of at most MAX_ENTRIES
     * rows, cheap enough to do synchronously during onCreate).
     */
    private void loadPersistedLogsIfNeeded() {
        if (loadedFromDisk) {
            return;
        }
        loadedFromDisk = true;
        synchronized (allMessages) {
            if (!allMessages.isEmpty()) {
                // Already populated by a live capture that raced this load
                // (e.g. a service captured something before the activity's
                // onCreate ran) — don't clobber it with a stale disk read.
                return;
            }
            allMessages.addAll(LogStore.get(this).loadRecent(MAX_ENTRIES));
        }
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
        if (requestCode == EXPORT_TXT_REQUEST_CODE) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingExportText != null) {
                writeExportedTxt(data.getData(), pendingExportText);
            }
            pendingExportText = null;
            return;
        }
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

        // Page container: home + logs + settings, one visible at a time.
        LinearLayout.LayoutParams pageLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        homePage = buildHomePage();
        logsPage = buildLogsPage();
        settingsPage = buildSettingsPage();
        root.addView(homePage, pageLp);
        root.addView(logsPage, pageLp);
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

        statusBadge = new TextView(this);
        statusBadge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        statusBadge.setTypeface(Typeface.DEFAULT_BOLD);
        statusBadge.setPadding(dp(12), dp(5), dp(12), dp(5));
        bar.addView(statusBadge);
        updateStatusBadge();

        return bar;
    }

    /**
     * Third status, not just online/offline: distinguishes "capturing fine"
     * from "notification access granted but the listener isn't actually
     * bound right now" (the exact ColorOS silent-unbind case) — previously
     * this badge was a hardcoded "Active" that never reflected reality.
     * HeartbeatService's own health check (checkListenerHealth) is what
     * actually tries to fix a degraded state via requestRebind(); this is
     * just making that same state visible instead of hidden behind a
     * blanket green dot.
     */
    private void updateStatusBadge() {
        if (statusBadge == null) return;
        boolean permissionGranted = isNotificationListenerEnabled(this);
        boolean listenerConnected = ListenerHealthStore.isConnected(this);
        if (permissionGranted && listenerConnected) {
            statusBadge.setText("Active");
            statusBadge.setTextColor(GREEN_PRIMARY);
            statusBadge.setBackground(rounded(GREEN_LIGHT_BG, dp(20)));
        } else if (permissionGranted) {
            statusBadge.setText("Not capturing");
            statusBadge.setTextColor(AMBER_PRIMARY);
            statusBadge.setBackground(rounded(AMBER_LIGHT_BG, dp(20)));
        } else {
            statusBadge.setText("Permission needed");
            statusBadge.setTextColor(0xFFC62828);
            statusBadge.setBackground(rounded(0xFFFFEBEE, dp(20)));
        }
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

        // Item 3/5 visibility: the offline-first queue and parse-failure log
        // are otherwise invisible unless someone plugs in adb — this makes
        // "is anything stuck undelivered right now" a glance, not a mystery.
        TextView queueValue = new TextView(this);
        queueValue.setText("…");
        queueValue.setTextColor(TEXT_PRIMARY);
        queueValue.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        queueValue.setPadding(0, dp(2), 0, dp(10));
        LinearLayout queueRow = new LinearLayout(this);
        queueRow.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams queueRowLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        queueRowLp.topMargin = dp(14);
        queueRow.setLayoutParams(queueRowLp);
        TextView queueLabel = new TextView(this);
        queueLabel.setText("Pending upload queue");
        queueLabel.setTextColor(TEXT_HINT);
        queueLabel.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        queueRow.addView(queueLabel);
        queueRow.addView(queueValue);
        View queueDivider = new View(this);
        queueDivider.setBackgroundColor(DIVIDER);
        queueDivider.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));
        queueRow.addView(queueDivider);
        page.addView(queueRow);

        new Thread(() -> {
            try {
                AppDatabase db = AppDatabase.get(this);
                int pending = db.queuedEventDao().count();
                int parseFailures = db.parseFailureDao().count();
                String text = pending + " event" + (pending == 1 ? "" : "s") + " waiting to upload"
                        + (parseFailures > 0 ? " · " + parseFailures + " unparsed format(s) logged" : "");
                runOnUiThread(() -> queueValue.setText(text));
            } catch (Exception e) {
                runOnUiThread(() -> queueValue.setText("Unavailable"));
            }
        }).start();

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

        Button exportLogs = new Button(this);
        exportLogs.setText("Export logs as .txt");
        exportLogs.setAllCaps(false);
        exportLogs.setTextColor(Color.WHITE);
        exportLogs.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        exportLogs.setBackground(rounded(BLUE_PRIMARY, dp(10)));
        exportLogs.setStateListAnimator(null);
        LinearLayout.LayoutParams elLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
        elLp.topMargin = dp(12);
        exportLogs.setLayoutParams(elLp);
        exportLogs.setOnClickListener(v -> exportLogsAsTxt());
        page.addView(exportLogs);

        Button logoutBtn = new Button(this);
        logoutBtn.setText("Log out / deactivate device");
        logoutBtn.setAllCaps(false);
        logoutBtn.setTextColor(Color.WHITE);
        logoutBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        logoutBtn.setBackground(rounded(0xFFD32F2F, dp(10)));
        logoutBtn.setStateListAnimator(null);
        LinearLayout.LayoutParams loLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
        loLp.topMargin = dp(28);
        logoutBtn.setLayoutParams(loLp);
        logoutBtn.setOnClickListener(v -> confirmLogout());
        page.addView(logoutBtn);

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
     * Builds the exportable log text from LogStore — the full persisted
     * history (up to LogStore's retention cap), not just the in-memory
     * allMessages rolling window (capped at MAX_ENTRIES=200) — since the
     * whole point of persisting captures is that export shouldn't be
     * limited to whatever happens to still be in memory. Does the DB read
     * on a background thread and delivers the result on the UI thread.
     */
    private void buildLogTextAsync(java.util.function.Consumer<String> onReady) {
        new Thread(() -> {
            List<SMSData> rows = LogStore.get(this).loadAll();
            StringBuilder sb = new StringBuilder();
            // loadAll() returns newest-first; export reads naturally oldest-first.
            for (int i = rows.size() - 1; i >= 0; i--) {
                SMSData d = rows.get(i);
                sb.append(TimeFormatter.toDisplay(d.timestamp))
                        .append(" [").append(d.source).append("] ")
                        .append(orDash(d.sender)).append(": ")
                        .append(orDash(d.body)).append('\n');
            }
            final String text = sb.toString();
            runOnUiThread(() -> onReady.accept(text));
        }).start();
    }

    /**
     * "Download logs" — shares the persisted capture history (see
     * buildLogTextAsync) via the system share sheet, the simplest way to get
     * a log off-device without adding new permissions or file-storage code.
     */
    private void shareLogs() {
        buildLogTextAsync(text -> {
            if (text.isEmpty()) {
                Toast.makeText(this, "No captures yet", Toast.LENGTH_SHORT).show();
                return;
            }
            Intent share = new Intent(Intent.ACTION_SEND);
            share.setType("text/plain");
            share.putExtra(Intent.EXTRA_SUBJECT, "MaxPay logs");
            share.putExtra(Intent.EXTRA_TEXT, text);
            startActivity(Intent.createChooser(share, "Download logs"));
        });
    }

    // ---------------------------------------------------------------------
    // .txt export — alongside (not replacing) the share-sheet button above.
    // Uses the Storage Access Framework (ACTION_CREATE_DOCUMENT) so the user
    // picks the destination themselves and no WRITE_EXTERNAL_STORAGE / other
    // new manifest permission is needed.
    // ---------------------------------------------------------------------
    private static final int EXPORT_TXT_REQUEST_CODE = 1002;
    private String pendingExportText;

    private void exportLogsAsTxt() {
        buildLogTextAsync(text -> {
            if (text.isEmpty()) {
                Toast.makeText(this, "No captures yet", Toast.LENGTH_SHORT).show();
                return;
            }
            pendingExportText = text;
            String filename = "maxpay-logs-" + System.currentTimeMillis() + ".txt";
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("text/plain");
            intent.putExtra(Intent.EXTRA_TITLE, filename);
            try {
                startActivityForResult(intent, EXPORT_TXT_REQUEST_CODE);
            } catch (Exception e) {
                Toast.makeText(this, "No file manager available to save to", Toast.LENGTH_LONG).show();
            }
        });
    }

    /**
     * User-triggered version of the same clear-pairing logic HeartbeatService
     * already runs automatically when the server confirms this device no
     * longer exists (RegistrationManager.clearRegistration) — this is just
     * that, exposed as an explicit action instead of only firing on a failed
     * status check.
     */
    private void confirmLogout() {
        new AlertDialog.Builder(this)
                .setTitle("Log out this device?")
                .setMessage("This clears local pairing and stops capture until you pair again with a new code.")
                .setNegativeButton("Cancel", (d, w) -> d.dismiss())
                .setPositiveButton("Log out", (d, w) -> {
                    RegistrationManager.clearRegistration(this);
                    Intent intent = new Intent(this, PermissionActivity.class);
                    intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                    startActivity(intent);
                    finish();
                })
                .show();
    }

    /** Writes the already-built log text to the Uri the user picked via ACTION_CREATE_DOCUMENT. */
    private void writeExportedTxt(final Uri uri, final String text) {
        new Thread(() -> {
            boolean ok = true;
            try (java.io.OutputStream os = getContentResolver().openOutputStream(uri)) {
                if (os == null) throw new java.io.IOException("openOutputStream returned null");
                os.write(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            } catch (Exception e) {
                ok = false;
            }
            final boolean success = ok;
            runOnUiThread(() -> Toast.makeText(this,
                    success ? "Logs saved" : "Failed to save logs",
                    Toast.LENGTH_SHORT).show());
        }).start();
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
        logsTab = buildNavTab("📋", "Logs", false);
        settingsTab = buildNavTab("⚙️", "Settings", false);
        homeTab.setOnClickListener(v -> showHome());
        logsTab.setOnClickListener(v -> showLogs());
        settingsTab.setOnClickListener(v -> showSettings());
        nav.addView(homeTab);
        nav.addView(logsTab);
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
        logsPage.setVisibility(View.GONE);
        settingsPage.setVisibility(View.GONE);
        homeTab.setTextColor(GREEN_PRIMARY);
        logsTab.setTextColor(TEXT_HINT);
        settingsTab.setTextColor(TEXT_HINT);
    }

    private void showLogs() {
        homePage.setVisibility(View.GONE);
        logsPage.setVisibility(View.VISIBLE);
        settingsPage.setVisibility(View.GONE);
        homeTab.setTextColor(TEXT_HINT);
        logsTab.setTextColor(GREEN_PRIMARY);
        settingsTab.setTextColor(TEXT_HINT);
    }

    private void showSettings() {
        homePage.setVisibility(View.GONE);
        logsPage.setVisibility(View.GONE);
        settingsPage.setVisibility(View.VISIBLE);
        homeTab.setTextColor(TEXT_HINT);
        logsTab.setTextColor(TEXT_HINT);
        settingsTab.setTextColor(GREEN_PRIMARY);
    }

    // ---------------------------------------------------------------------
    // Logs tab — live capture feed (every SMS/notification card), visible.
    // ---------------------------------------------------------------------
    private LinearLayout buildLogsPage() {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        page.addView(buildLogsHeader());
        page.addView(buildFeed(), new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        return page;
    }

    /** Logs tab header: title + a trash-icon button (item 3) that clears the
     *  on-screen log history and the underlying LogStore table. */
    private View buildLogsHeader() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(20), dp(16), dp(12), dp(4));
        row.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView title = new TextView(this);
        title.setText("Logs");
        title.setTextColor(TEXT_PRIMARY);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        title.setLayoutParams(titleLp);
        row.addView(title);

        TextView trash = new TextView(this);
        trash.setText("🗑");
        trash.setTextSize(20);
        trash.setPadding(dp(10), dp(8), dp(10), dp(8));
        trash.setOnClickListener(v -> confirmClearLogs());
        row.addView(trash);

        return row;
    }

    /** Same ConfirmModal-style AlertDialog pattern as confirmLogout(). */
    private void confirmClearLogs() {
        new AlertDialog.Builder(this)
                .setTitle("Clear all logs?")
                .setMessage("This permanently deletes the on-screen log history from this device. "
                        + "This can't be undone.")
                .setNegativeButton("Cancel", (d, w) -> d.dismiss())
                .setPositiveButton("Clear", (d, w) -> clearLogs())
                .show();
    }

    /** Clears both the underlying LogStore table and the in-memory feed. */
    private void clearLogs() {
        new Thread(() -> {
            LogStore.get(this).clearAll();
            synchronized (allMessages) {
                allMessages.clear();
            }
            runOnUiThread(() -> {
                rebuildFeed();
                Toast.makeText(this, "Logs cleared", Toast.LENGTH_SHORT).show();
            });
        }).start();
    }

    private View buildFeed() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0);
        scroll.setLayoutParams(lp);
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

        // Persist first, off the calling thread — this is the real fix for
        // history not surviving process death; the in-memory list below is
        // only ever a same-process cache of it. Uses the static application
        // Context (PaymentBotApplication) rather than MainActivity's, since
        // most captures happen with no UI open at all (NotificationService/
        // SMSReceiver run in the background) — instanceRef is very often
        // null exactly when this matters most.
        final Context ctx = PaymentBotApplication.get();
        if (ctx != null) {
            new Thread(() -> LogStore.get(ctx).insert(data)).start();
        }

        final MainActivity a = instanceRef.get();
        if (a == null) {
            // No UI yet (e.g. captured by a background service); still record it
            // so it appears once the screen opens, but keep the rolling window.
            synchronized (allMessages) {
                allMessages.add(0, data);
                trimMessages();
            }
            return;
        }
        a.runOnUiThread(() -> {
            synchronized (allMessages) {
                allMessages.add(0, data);
                trimMessages();
            }
            if (a.messageContainer != null) {
                // Remove the empty placeholder if present, then prepend.
                if (a.messageContainer.getChildCount() == 1
                        && a.messageContainer.getChildAt(0) == a.emptyView) {
                    a.messageContainer.removeAllViews();
                }
                a.messageContainer.addView(a.buildCard(data), 0);
                // Cap the card view tree to match the rolling window.
                while (a.messageContainer.getChildCount() > MAX_ENTRIES) {
                    a.messageContainer.removeViewAt(a.messageContainer.getChildCount() - 1);
                }
            }
        });
    }

    /** Drops oldest entries beyond MAX_ENTRIES. Caller must hold allMessages. */
    private static void trimMessages() {
        while (allMessages.size() > MAX_ENTRIES) {
            allMessages.remove(allMessages.size() - 1);
        }
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
