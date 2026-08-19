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
import android.os.PowerManager;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;

/**
 * MaxPay main screen.
 *
 * The visible UI is the "Working" home screen + an Activity tab (the live
 * capture feed of every SMS/notification/screen event) + Settings (Device /
 * Permissions / Floating overlay / Download logs / Logout). Engines push
 * captures in via the thread-safe static {@link #addSMS(SMSData)} hook;
 * {@link #addLog(String)} and {@link #addPayment(PaymentData)} are
 * compatibility shims kept so the accessibility engine ({@link PaymentBotService})
 * and {@link APIClient} still compile and keep recording captures, unchanged
 * from before.
 */
public class MainActivity extends AppCompatActivity {

    private static final String TAG = "MaxPay";
    private static final String NOTIF_LISTENER_SETTING = "enabled_notification_listeners";

    // Brand palette — approved MaxPay direction (primary emerald / soft
    // emerald / white). Previously this screen mixed a blue accent
    // (buttons) with a separate green accent (status/nav) — both now unify
    // on the one approved brand color so there's a single consistent accent
    // across every action and status element on this screen.
    private static final int BG_WHITE = 0xFFFFFFFF;
    private static final int TEXT_PRIMARY = 0xFF1A1A1A;
    private static final int TEXT_SECONDARY = 0xFF666666;
    private static final int TEXT_HINT = 0xFF999999;
    private static final int BRAND_PRIMARY = 0xFF0F6B5C;
    private static final int BRAND_SOFT = 0xFFE8F5F1;
    // Kept as aliases (rather than a mechanical rename of every call site)
    // so the diff stays focused on color *values*, not identifiers.
    private static final int BLUE_PRIMARY = BRAND_PRIMARY;
    private static final int GREEN_PRIMARY = BRAND_PRIMARY;
    private static final int GREEN_LIGHT_BG = BRAND_SOFT;
    private static final int DIVIDER = 0xFFE0E0E0;

    // Category accent colors — still used by the Activity tab's per-row
    // left accent, now against a light card instead of the old dark theme.
    private static final int YELLOW = 0xFFB26A00;
    private static final int RED = 0xFFC62828;
    private static final int BLUE = 0xFF3B6FB6;
    private static final int GREEN_ACCENT = 0xFF0F6B5C;
    private static final int OTHER_GREY = 0xFF71717A;
    private static final int CARD_BG = 0xFFFFFFFF;
    private static final int CARD_BORDER = 0xFFEDEDED;
    private static final int BODY_TEXT = 0xFF444444;
    private static final int TIME_GREY = 0xFF999999;

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
    // Log-storage audit, item 2: this is also the Activity tab's default
    // on-screen view size. Full history beyond this is never lost — it's
    // independently persisted in LogStore (5,000-row cap) and stays
    // reachable via the Download logs action (buildLogTextAsync() reads
    // LogStore.loadAll() directly, not this in-memory list) — only what's
    // *displayed* by default is capped here.
    private static final int MAX_ENTRIES = 100;

    private LinearLayout messageContainer;
    private TextView emptyView;

    // Page state. homePage / logsPage / settingsPage are the 3 bottom-nav
    // sections; deviceInfoPage / permissionsPage / overlayPage are Settings
    // drill-downs (reached only from settingsPage, returned to it via a
    // back arrow) — kept as sibling pages in the same swap container rather
    // than new Activities, matching this screen's existing architecture.
    private LinearLayout homePage;
    private LinearLayout logsPage;
    private LinearLayout settingsPage;
    private LinearLayout deviceInfoPage;
    private LinearLayout permissionsPage;
    private LinearLayout overlayPage;
    private TextView deviceNameLabel;
    private TextView homeTab;
    private TextView logsTab;
    private TextView settingsTab;
    private TextView statusBadge;

    // A third accent color for "online but not capturing" — distinct from
    // the brand green (capturing fine) and the red used for permission
    // errors elsewhere in the app.
    private static final int AMBER_PRIMARY = 0xFFB26A00;
    private static final int AMBER_LIGHT_BG = 0xFFFFF3E0;

    // Auto-refresh the "x min ago" labels on the feed once a minute.
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
        startPayoutOverlayIfEnabled();
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
        if (permissionsPage != null && permissionsPage.getVisibility() == View.VISIBLE) {
            refreshPermissionsPage();
        }
        if (overlayPage != null && overlayPage.getVisibility() == View.VISIBLE) {
            refreshOverlayPage();
        }
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
                ((TextView) timeView).setText(TimeFormatter.toRelative(ts));
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

    /** Restores the payout overlay across app/process restarts if the
     *  trader had Payment Mode on — mirrors startOverlayService() above. */
    private void startPayoutOverlayIfEnabled() {
        if (!PaymentModeState.isEnabled(this)) return;
        syncPayoutOverlayVisibility(true);
    }

    /** Shared by the restore-on-launch path above and the Payment Mode
     *  toggle handler (buildSettingsPage) so both start/show or hide the
     *  overlay identically. */
    private void syncPayoutOverlayVisibility(boolean enabled) {
        if (enabled) {
            try {
                startService(new Intent(this, PayoutOverlayService.class));
            } catch (Exception ignored) {
            }
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                PayoutOverlayService svc = PayoutOverlayService.getInstance();
                if (svc != null) svc.show();
            }, 200);
        } else {
            PayoutOverlayService svc = PayoutOverlayService.getInstance();
            if (svc != null) svc.hide();
        }
    }

    // ---------------------------------------------------------------------
    // MediaProjection (screenshot) permission
    // ---------------------------------------------------------------------
    private static final int SCREENSHOT_REQUEST_CODE = 1001;
    // Tracks the one-time MediaProjection grant locally now that
    // OverlayService.hasProjection() no longer exists — PayoutOverlayService
    // holds the actual token in its own static field (untouched here per
    // scope), this just remembers whether the grant happened, for the
    // Permissions page row below.
    private static boolean screenCaptureGranted = false;

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

            // Screen-capture consent grant, handed to the payout-evidence
            // overlay's own static holder (PayoutOverlayService).
            screenCaptureGranted = true;
            PayoutOverlayService.setMediaProjection(
                    mp, metrics.widthPixels, metrics.heightPixels, metrics.densityDpi);

            Toast.makeText(this, "Screenshot ready!", Toast.LENGTH_SHORT).show();
            if (permissionsPage != null && permissionsPage.getVisibility() == View.VISIBLE) {
                refreshPermissionsPage();
            }
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
    // UI construction (all programmatic) — approved MaxPay brand
    // ---------------------------------------------------------------------
    private View buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG_WHITE);
        root.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        root.addView(buildTopBar());

        // Page container: one visible at a time.
        LinearLayout.LayoutParams pageLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        homePage = buildHomePage();
        logsPage = buildLogsPage();
        settingsPage = buildSettingsPage();
        deviceInfoPage = buildDeviceInfoPage();
        permissionsPage = buildPermissionsPage();
        overlayPage = buildOverlayPage();
        root.addView(homePage, pageLp);
        root.addView(logsPage, pageLp);
        root.addView(settingsPage, pageLp);
        root.addView(deviceInfoPage, pageLp);
        root.addView(permissionsPage, pageLp);
        root.addView(overlayPage, pageLp);

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

        deviceNameLabel = new TextView(this);
        String name = RegistrationManager.getDeviceName(this);
        deviceNameLabel.setText(name.isEmpty() ? "This device" : name);
        deviceNameLabel.setTextColor(TEXT_PRIMARY);
        deviceNameLabel.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        deviceNameLabel.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams nameLp = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
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
     * Real 3-state signal, not a hardcoded "Active": distinguishes
     * "capturing fine" from "notification access granted but the listener
     * isn't actually bound right now" (the exact ColorOS silent-unbind
     * case) from "permission missing entirely". These labels are kept as
     * the honest description of what's actually known rather than force-fit
     * onto the prototype's "Active / Connecting / Offline" wording — there
     * is no real "Connecting" or server-reported "Offline" signal read back
     * into this app today (the heartbeat is one-directional, app → server;
     * see the migration report). HeartbeatService's own health check
     * (checkListenerHealth) is what actually tries to fix a degraded state
     * via requestRebind(); this just makes that same state visible.
     */
    private void updateStatusBadge() {
        if (statusBadge == null) return;
        boolean permissionGranted = isNotificationListenerEnabled(this);
        boolean listenerConnected = ListenerHealthStore.isConnected(this);
        if (permissionGranted && listenerConnected) {
            statusBadge.setText("Active");
            statusBadge.setTextColor(BRAND_PRIMARY);
            statusBadge.setBackground(rounded(BRAND_SOFT, dp(20)));
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

        // Content area: centered brand icon + "Working" text. Intentional
        // white space around it — no capture count / health score / graphs
        // / success rate / last-sync cards per the approved direction.
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER);
        content.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        android.widget.FrameLayout iconCircle = new android.widget.FrameLayout(this);
        int iconSize = dp(88);
        LinearLayout.LayoutParams iconLp = new LinearLayout.LayoutParams(iconSize, iconSize);
        iconLp.gravity = Gravity.CENTER;
        iconLp.bottomMargin = dp(20);
        iconCircle.setBackground(circle(BRAND_SOFT));
        TextView check = new TextView(this);
        check.setText("✓");
        check.setTextColor(BRAND_PRIMARY);
        check.setTextSize(TypedValue.COMPLEX_UNIT_SP, 40);
        check.setTypeface(Typeface.DEFAULT_BOLD);
        check.setGravity(Gravity.CENTER);
        iconCircle.addView(check, new android.widget.FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        content.addView(iconCircle, iconLp);

        TextView working = new TextView(this);
        working.setText("Working");
        working.setTextColor(TEXT_SECONDARY);
        working.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        working.setGravity(Gravity.CENTER);
        content.addView(working);
        page.addView(content);

        return page;
    }

    // ---------------------------------------------------------------------
    // Settings page — a plain nav list (Device / Permissions / Floating
    // overlay / Download logs / Logout) per the approved direction, no
    // section headings, no long descriptions. The fields this page used to
    // dump flat (device name, server URL, license key, app version, Android
    // ID, pending-upload queue) now live in the Device drill-down; the
    // permission checks that used to be invisible now live in Permissions.
    // ---------------------------------------------------------------------
    private LinearLayout buildSettingsPage() {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(0, dp(8), 0, 0);
        page.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // Only shown when UpdateCheckWorker's last real check actually found
        // a newer version (UpdateStore.setAvailable) — never unconditional.
        int availableVersionCode = UpdateStore.getAvailableVersionCode(this);
        if (availableVersionCode > 0) {
            page.addView(updateBanner());
        }

        page.addView(navRow("Device", v -> showSubPage(deviceInfoPage)));
        page.addView(navRow("Permissions", v -> {
            refreshPermissionsPage();
            showSubPage(permissionsPage);
        }));
        page.addView(navRow("Floating overlay", v -> {
            refreshOverlayPage();
            showSubPage(overlayPage);
        }));
        page.addView(paymentModeRow());
        page.addView(navRow("Web Login (Beta)", v -> startActivity(new Intent(this, WebLoginActivity.class))));
        page.addView(navRow("Download logs", v -> pickDownloadLogsAction()));
        page.addView(navRow("Logout", v -> confirmLogout()));

        return page;
    }

    /** Payout evidence overlay toggle — persistent, trader-controlled,
     *  independent of any server signal. The Home page used to have a
     *  separate "Enable Screenshot Capture" button for the older,
     *  now-removed OverlayService floating capture feature (an orphaned,
     *  never-consumed NGO-dashboard capture flow) — that button and the
     *  naming collision it once had with this switch are both gone. See
     *  PaymentModeState / PayoutOverlayService. */
    private View paymentModeRow() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        LinearLayout inner = new LinearLayout(this);
        inner.setOrientation(LinearLayout.HORIZONTAL);
        inner.setGravity(Gravity.CENTER_VERTICAL);
        inner.setPadding(dp(24), dp(16), dp(20), dp(16));

        TextView labelView = new TextView(this);
        labelView.setText("Payment Mode");
        labelView.setTextColor(TEXT_PRIMARY);
        labelView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        labelView.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        inner.addView(labelView);

        Switch toggle = new Switch(this);
        toggle.setChecked(PaymentModeState.isEnabled(this));
        toggle.setOnCheckedChangeListener((buttonView, isChecked) -> {
            PaymentModeState.setEnabled(this, isChecked);
            syncPayoutOverlayVisibility(isChecked);
        });
        inner.addView(toggle);

        row.addView(inner);

        View divider = new View(this);
        divider.setBackgroundColor(DIVIDER);
        LinearLayout.LayoutParams dividerLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(1));
        dividerLp.leftMargin = dp(24);
        divider.setLayoutParams(dividerLp);
        row.addView(divider);

        return row;
    }

    private View updateBanner() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(16), dp(12), dp(16), dp(12));
        row.setBackground(rounded(BRAND_SOFT, dp(10)));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(dp(20), dp(4), dp(20), dp(16));
        row.setLayoutParams(lp);
        row.setOnClickListener(v -> startActivity(new Intent(this, UpdateAvailableActivity.class)));

        TextView label = new TextView(this);
        label.setText("Update available");
        label.setTextColor(BRAND_PRIMARY);
        label.setTypeface(Typeface.DEFAULT_BOLD);
        label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        row.addView(label, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        TextView chevron = new TextView(this);
        chevron.setText("›");
        chevron.setTextColor(BRAND_PRIMARY);
        chevron.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        row.addView(chevron);

        return row;
    }

    /** A single tappable Settings row: label + chevron, divider below. */
    private View navRow(String label, View.OnClickListener onClick) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        LinearLayout inner = new LinearLayout(this);
        inner.setOrientation(LinearLayout.HORIZONTAL);
        inner.setGravity(Gravity.CENTER_VERTICAL);
        inner.setPadding(dp(24), dp(16), dp(20), dp(16));
        inner.setClickable(true);
        inner.setFocusable(true);
        android.util.TypedValue outValue = new android.util.TypedValue();
        getTheme().resolveAttribute(android.R.attr.selectableItemBackground, outValue, true);
        inner.setBackgroundResource(outValue.resourceId != 0 ? outValue.resourceId : 0);
        inner.setOnClickListener(onClick);

        TextView labelView = new TextView(this);
        labelView.setText(label);
        labelView.setTextColor(TEXT_PRIMARY);
        labelView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        LinearLayout.LayoutParams labelLp = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        labelView.setLayoutParams(labelLp);
        inner.addView(labelView);

        boolean isDestructive = "Logout".equals(label);
        TextView chevron = new TextView(this);
        chevron.setText(isDestructive ? "" : "›");
        chevron.setTextColor(TEXT_HINT);
        chevron.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        inner.addView(chevron);
        if (isDestructive) {
            labelView.setTextColor(0xFFD32F2F);
        }

        row.addView(inner);

        View divider = new View(this);
        divider.setBackgroundColor(DIVIDER);
        LinearLayout.LayoutParams dividerLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(1));
        dividerLp.leftMargin = dp(24);
        divider.setLayoutParams(dividerLp);
        row.addView(divider);

        return row;
    }

    /** Header shared by every Settings drill-down: back arrow + title. */
    private View subPageHeader(String title) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(12), dp(16), dp(20), dp(8));
        row.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView back = new TextView(this);
        back.setText("←");
        back.setTextColor(TEXT_PRIMARY);
        back.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        back.setPadding(dp(8), dp(8), dp(16), dp(8));
        back.setOnClickListener(v -> showSettings());
        row.addView(back);

        TextView titleView = new TextView(this);
        titleView.setText(title);
        titleView.setTextColor(TEXT_PRIMARY);
        titleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        titleView.setTypeface(Typeface.DEFAULT_BOLD);
        row.addView(titleView);

        return row;
    }

    // ---------------------------------------------------------------------
    // Settings → Device
    // ---------------------------------------------------------------------
    private LinearLayout buildDeviceInfoPage() {
        ScrollView scroll = new ScrollView(this);
        scroll.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(dp(24), dp(4), dp(24), dp(24));
        page.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        String deviceName = RegistrationManager.getDeviceName(this);
        String appVersion = BuildConfig.VERSION_NAME;
        String androidId = Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID);

        page.addView(settingsRow("Device name", deviceName.isEmpty() ? "—" : deviceName));
        page.addView(settingsRow("App version", appVersion));
        page.addView(settingsRow("Device identifier", androidId == null ? "—" : androidId));

        // Support-diagnostic fields, kept (not new) — previously shown flat
        // on this same screen, now grouped under Device since they're
        // device-level operational state a support agent would ask for.
        String serverUrl = RegistrationManager.getServerUrl(this);
        String licenseKey = RegistrationManager.getLicenseKey(this);
        String maskedKey = licenseKey.length() >= 2 ? licenseKey.substring(0, 2) + "****" : "N/A";
        page.addView(settingsRow("Server", serverUrl));
        page.addView(settingsRow("License key", maskedKey));

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

        scroll.addView(page);

        LinearLayout wrapper = new LinearLayout(this);
        wrapper.setOrientation(LinearLayout.VERTICAL);
        wrapper.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        wrapper.addView(subPageHeader("Device"));
        wrapper.addView(scroll);
        return wrapper;
    }

    // ---------------------------------------------------------------------
    // Settings → Permissions — real granted/not-granted state per
    // permission, re-checked every time this page becomes visible
    // (refreshPermissionsPage) so it never shows a stale answer after the
    // user comes back from the Android Settings app.
    // ---------------------------------------------------------------------
    private LinearLayout permissionsListContainer;

    private LinearLayout buildPermissionsPage() {
        ScrollView scroll = new ScrollView(this);
        scroll.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        permissionsListContainer = new LinearLayout(this);
        permissionsListContainer.setOrientation(LinearLayout.VERTICAL);
        permissionsListContainer.setPadding(dp(24), dp(4), dp(24), dp(24));
        permissionsListContainer.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        scroll.addView(permissionsListContainer);

        LinearLayout wrapper = new LinearLayout(this);
        wrapper.setOrientation(LinearLayout.VERTICAL);
        wrapper.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        wrapper.addView(subPageHeader("Permissions"));
        wrapper.addView(scroll);
        return wrapper;
    }

    private void refreshPermissionsPage() {
        if (permissionsListContainer == null) return;
        permissionsListContainer.removeAllViews();

        boolean notifGranted = isNotificationListenerEnabled(this);
        boolean smsGranted = ContextCompat.checkSelfPermission(this, android.Manifest.permission.RECEIVE_SMS)
                == android.content.pm.PackageManager.PERMISSION_GRANTED;
        boolean overlayGranted = android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.M
                || Settings.canDrawOverlays(this);
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        boolean batteryExempt = pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
        boolean accessibilityGranted = isAccessibilityEnabled(this);
        boolean screenCaptureGrantedNow = screenCaptureGranted;

        permissionsListContainer.addView(permissionStatusRow("Notification access", notifGranted,
                () -> startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))));
        permissionsListContainer.addView(permissionStatusRow("SMS access", smsGranted,
                () -> androidx.core.app.ActivityCompat.requestPermissions(this,
                        new String[]{android.Manifest.permission.RECEIVE_SMS, android.Manifest.permission.READ_SMS}, 200)));
        permissionsListContainer.addView(permissionStatusRow("Overlay", overlayGranted,
                () -> {
                    try {
                        startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                Uri.parse("package:" + getPackageName())));
                    } catch (Exception ignored) {
                    }
                }));
        permissionsListContainer.addView(permissionStatusRow("Battery / background", batteryExempt,
                () -> {
                    try {
                        Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                        i.setData(Uri.parse("package:" + getPackageName()));
                        startActivity(i);
                    } catch (Exception ignored) {
                    }
                }));
        permissionsListContainer.addView(permissionStatusRow("Accessibility", accessibilityGranted,
                () -> {
                    try {
                        startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
                    } catch (Exception ignored) {
                    }
                }));
        // Not one of the approved list's 5 named permissions, but a real,
        // separate runtime consent this build depends on for the
        // screen-capture engine — kept visible rather than hidden.
        permissionsListContainer.addView(permissionStatusRow("Screen capture", screenCaptureGrantedNow,
                this::requestScreenshotPermission));
    }

    private View permissionStatusRow(String label, boolean granted, Runnable onFix) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams rowLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rowLp.topMargin = dp(14);
        row.setLayoutParams(rowLp);

        LinearLayout textCol = new LinearLayout(this);
        textCol.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams textColLp = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        textCol.setLayoutParams(textColLp);

        TextView labelView = new TextView(this);
        labelView.setText(label);
        labelView.setTextColor(TEXT_PRIMARY);
        labelView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        textCol.addView(labelView);

        TextView stateView = new TextView(this);
        stateView.setText(granted ? "Granted" : "Not granted");
        stateView.setTextColor(granted ? BRAND_PRIMARY : 0xFFC62828);
        stateView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        textCol.addView(stateView);

        row.addView(textCol);

        if (!granted) {
            TextView fix = new TextView(this);
            fix.setText("Fix");
            fix.setTextColor(BRAND_PRIMARY);
            fix.setTypeface(Typeface.DEFAULT_BOLD);
            fix.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            fix.setPadding(dp(14), dp(6), dp(4), dp(6));
            fix.setOnClickListener(v -> onFix.run());
            row.addView(fix);
        }

        LinearLayout wrapper = new LinearLayout(this);
        wrapper.setOrientation(LinearLayout.VERTICAL);
        wrapper.addView(row);
        View divider = new View(this);
        divider.setBackgroundColor(DIVIDER);
        LinearLayout.LayoutParams dividerLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(1));
        dividerLp.topMargin = dp(10);
        divider.setLayoutParams(dividerLp);
        wrapper.addView(divider);
        return wrapper;
    }

    // ---------------------------------------------------------------------
    // Settings → Floating overlay
    // ---------------------------------------------------------------------
    private LinearLayout overlayPageContent;

    private LinearLayout buildOverlayPage() {
        overlayPageContent = new LinearLayout(this);
        overlayPageContent.setOrientation(LinearLayout.VERTICAL);
        overlayPageContent.setPadding(dp(24), dp(8), dp(24), dp(24));
        overlayPageContent.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        LinearLayout wrapper = new LinearLayout(this);
        wrapper.setOrientation(LinearLayout.VERTICAL);
        wrapper.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        wrapper.addView(subPageHeader("Floating overlay"));
        wrapper.addView(overlayPageContent);
        return wrapper;
    }

    private void refreshOverlayPage() {
        if (overlayPageContent == null) return;
        overlayPageContent.removeAllViews();

        boolean granted = android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.M
                || Settings.canDrawOverlays(this);

        TextView state = new TextView(this);
        state.setText(granted ? "Permission granted" : "Permission not granted");
        state.setTextColor(granted ? BRAND_PRIMARY : 0xFFC62828);
        state.setTypeface(Typeface.DEFAULT_BOLD);
        state.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        overlayPageContent.addView(state);

        TextView desc = new TextView(this);
        desc.setText("Shown automatically over supported payment apps once this is granted — no separate on/off switch, it follows the permission.");
        desc.setTextColor(TEXT_SECONDARY);
        desc.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        LinearLayout.LayoutParams descLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        descLp.topMargin = dp(8);
        descLp.bottomMargin = dp(24);
        overlayPageContent.addView(desc, descLp);

        if (!granted) {
            Button openBtn = new Button(this);
            openBtn.setText("Open settings");
            openBtn.setAllCaps(false);
            openBtn.setTextColor(Color.WHITE);
            openBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
            openBtn.setBackground(rounded(BRAND_PRIMARY, dp(10)));
            openBtn.setStateListAnimator(null);
            openBtn.setLayoutParams(new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));
            openBtn.setOnClickListener(v -> {
                try {
                    startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.parse("package:" + getPackageName())));
                } catch (Exception ignored) {
                }
            });
            overlayPageContent.addView(openBtn);
        }
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
     * allMessages rolling window (capped at MAX_ENTRIES) — since the whole
     * point of persisting captures is that export shouldn't be limited to
     * whatever happens to still be in memory. Does the DB read on a
     * background thread and delivers the result on the UI thread.
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
     * "Download logs" — a single Settings row covering both real,
     * already-existing export paths (share sheet / save-as-.txt) via a
     * small chooser, rather than dropping either real capability to fit one
     * row.
     */
    private void pickDownloadLogsAction() {
        new AlertDialog.Builder(this)
                .setTitle("Download logs")
                .setItems(new CharSequence[]{"Share", "Save as .txt file"}, (d, which) -> {
                    if (which == 0) shareLogs(); else exportLogsAsTxt();
                })
                .show();
    }

    /**
     * Shares the persisted capture history (see buildLogTextAsync) via the
     * system share sheet, the simplest way to get a log off-device without
     * adding new permissions or file-storage code.
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
    // .txt export — alongside (not replacing) the share-sheet path above.
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
    // Bottom nav (Home | Activity | Settings)
    // ---------------------------------------------------------------------
    private View buildBottomNav() {
        LinearLayout nav = new LinearLayout(this);
        nav.setOrientation(LinearLayout.HORIZONTAL);
        nav.setBackground(rounded(BG_WHITE, 0));
        LinearLayout.LayoutParams navLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        nav.setLayoutParams(navLp);

        View topDivider = new View(this);
        LinearLayout wrapper = new LinearLayout(this);
        wrapper.setOrientation(LinearLayout.VERTICAL);
        wrapper.setLayoutParams(navLp);
        topDivider.setBackgroundColor(DIVIDER);
        topDivider.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));
        wrapper.addView(topDivider);
        wrapper.addView(nav);

        homeTab = buildNavTab("Home", true);
        logsTab = buildNavTab("Activity", false);
        settingsTab = buildNavTab("Settings", false);
        homeTab.setOnClickListener(v -> showHome());
        logsTab.setOnClickListener(v -> showLogs());
        settingsTab.setOnClickListener(v -> showSettings());
        nav.addView(homeTab);
        nav.addView(logsTab);
        nav.addView(settingsTab);

        return wrapper;
    }

    private TextView buildNavTab(String label, boolean active) {
        TextView tab = new TextView(this);
        tab.setText(label);
        tab.setGravity(Gravity.CENTER);
        tab.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        tab.setTypeface(active ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
        tab.setTextColor(active ? BRAND_PRIMARY : TEXT_HINT);
        tab.setPadding(0, dp(14), 0, dp(14));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        tab.setLayoutParams(lp);
        return tab;
    }

    /** Hides every page (bottom-nav sections + Settings drill-downs). */
    private void hideAllPages() {
        homePage.setVisibility(View.GONE);
        logsPage.setVisibility(View.GONE);
        settingsPage.setVisibility(View.GONE);
        deviceInfoPage.setVisibility(View.GONE);
        permissionsPage.setVisibility(View.GONE);
        overlayPage.setVisibility(View.GONE);
    }

    /** Shows a Settings drill-down page; bottom nav stays on "Settings". */
    private void showSubPage(LinearLayout page) {
        hideAllPages();
        page.setVisibility(View.VISIBLE);
        homeTab.setTextColor(TEXT_HINT);
        homeTab.setTypeface(Typeface.DEFAULT);
        logsTab.setTextColor(TEXT_HINT);
        logsTab.setTypeface(Typeface.DEFAULT);
        settingsTab.setTextColor(BRAND_PRIMARY);
        settingsTab.setTypeface(Typeface.DEFAULT_BOLD);
    }

    private void showHome() {
        hideAllPages();
        homePage.setVisibility(View.VISIBLE);
        homeTab.setTextColor(BRAND_PRIMARY);
        homeTab.setTypeface(Typeface.DEFAULT_BOLD);
        logsTab.setTextColor(TEXT_HINT);
        logsTab.setTypeface(Typeface.DEFAULT);
        settingsTab.setTextColor(TEXT_HINT);
        settingsTab.setTypeface(Typeface.DEFAULT);
    }

    private void showLogs() {
        hideAllPages();
        logsPage.setVisibility(View.VISIBLE);
        homeTab.setTextColor(TEXT_HINT);
        homeTab.setTypeface(Typeface.DEFAULT);
        logsTab.setTextColor(BRAND_PRIMARY);
        logsTab.setTypeface(Typeface.DEFAULT_BOLD);
        settingsTab.setTextColor(TEXT_HINT);
        settingsTab.setTypeface(Typeface.DEFAULT);
    }

    private void showSettings() {
        hideAllPages();
        settingsPage.setVisibility(View.VISIBLE);
        homeTab.setTextColor(TEXT_HINT);
        homeTab.setTypeface(Typeface.DEFAULT);
        logsTab.setTextColor(TEXT_HINT);
        logsTab.setTypeface(Typeface.DEFAULT);
        settingsTab.setTextColor(BRAND_PRIMARY);
        settingsTab.setTypeface(Typeface.DEFAULT_BOLD);
    }

    // ---------------------------------------------------------------------
    // Activity tab — real capture feed (every SMS/notification/screen
    // event), light row layout: icon, event title, short detail, time.
    // No search / filters / charts / summary cards / tabs, per the approved
    // direction — this page never had any of those, only the visual theme
    // changes here (previous dark "hacker terminal" cards → light rows).
    // ---------------------------------------------------------------------
    private LinearLayout buildLogsPage() {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(BG_WHITE);
        page.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        page.addView(buildLogsHeader());
        page.addView(buildFeed(), new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        return page;
    }

    /** Activity tab header: title + a trash-icon button that clears the
     *  on-screen log history and the underlying LogStore table. */
    private View buildLogsHeader() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(20), dp(16), dp(12), dp(4));
        row.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView title = new TextView(this);
        title.setText("Activity");
        title.setTextColor(TEXT_PRIMARY);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        title.setLayoutParams(titleLp);
        row.addView(title);

        TextView clear = new TextView(this);
        clear.setText("Clear");
        clear.setTextColor(TEXT_HINT);
        clear.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        clear.setPadding(dp(10), dp(8), dp(10), dp(8));
        clear.setOnClickListener(v -> confirmClearLogs());
        row.addView(clear);

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
        messageContainer.setPadding(dp(16), dp(6), dp(16), dp(10));
        messageContainer.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        emptyView = buildEmptyView();
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

    /** Rebuild the whole feed from allMessages (newest first). */
    private void rebuildFeed() {
        if (messageContainer == null) return;
        messageContainer.removeAllViews();

        for (SMSData data : allMessages) {
            messageContainer.addView(buildCard(data));
        }

        if (allMessages.isEmpty()) {
            messageContainer.addView(buildEmptyView());
        }
    }

    private TextView buildEmptyView() {
        emptyView = new TextView(this);
        emptyView.setText("Waiting for banking SMS\nand notifications...");
        emptyView.setTextColor(TEXT_HINT);
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
    // Card rendering — light row: icon, real event title, short detail, time
    // ---------------------------------------------------------------------
    private View buildCard(final SMSData data) {
        int accent = "SMS".equals(data.source) ? BLUE
                : "NOTIFICATION".equals(data.source) ? GREEN_ACCENT
                : categoryColor(data.category);
        String icon = "SMS".equals(data.source) ? "💬"
                : "NOTIFICATION".equals(data.source) ? "🔔"
                : "📸";

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.HORIZONTAL);
        card.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams cardLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        cardLp.setMargins(0, dp(4), 0, dp(4));
        card.setLayoutParams(cardLp);
        card.setPadding(dp(14), dp(12), dp(14), dp(12));
        android.graphics.drawable.GradientDrawable bg = rounded(CARD_BG, dp(10));
        bg.setStroke(dp(1), CARD_BORDER);
        card.setBackground(bg);
        card.setTag(data.timestamp);

        android.widget.FrameLayout iconCircle = new android.widget.FrameLayout(this);
        int iconSize = dp(36);
        LinearLayout.LayoutParams iconLp = new LinearLayout.LayoutParams(iconSize, iconSize);
        iconLp.rightMargin = dp(12);

        // The source app's own icon, straight from the OS, so a row is
        // recognisable at a glance the way the notification itself is. Every
        // notification row used to get the same generic bell, which told the
        // trader nothing about which account the money landed in. Falls back
        // to the emoji when there is no package to ask about (SMS, screen
        // captures) or the app has since been uninstalled.
        android.graphics.drawable.Drawable appIcon = appIconFor(data.packageName);
        if (appIcon != null) {
            android.widget.ImageView iconImage = new android.widget.ImageView(this);
            iconImage.setImageDrawable(appIcon);
            iconCircle.addView(iconImage, new android.widget.FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        } else {
            iconCircle.setBackground(circle(withAlpha(accent, 0x1F)));
            TextView iconView = new TextView(this);
            iconView.setText(icon);
            iconView.setTextSize(16);
            iconView.setGravity(Gravity.CENTER);
            iconCircle.addView(iconView, new android.widget.FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        card.addView(iconCircle, iconLp);

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams contentLp = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        content.setLayoutParams(contentLp);

        TextView titleView = new TextView(this);
        titleView.setText(eventTitle(data));
        titleView.setTextColor(TEXT_PRIMARY);
        titleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        titleView.setTypeface(Typeface.DEFAULT_BOLD);
        content.addView(titleView);

        TextView detailView = new TextView(this);
        detailView.setText(eventDetail(data));
        detailView.setTextColor(BODY_TEXT);
        detailView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        detailView.setMaxLines(2);
        detailView.setEllipsize(android.text.TextUtils.TruncateAt.END);
        detailView.setPadding(0, dp(2), 0, 0);
        content.addView(detailView);

        // The buttons the real notification offered ("All payments",
        // "Settings"). Shown as labels, not controls — this is a record of
        // what was captured, and tapping through to another app from a log
        // entry would be inventing behaviour the capture never had.
        if (data.actions != null && data.actions.length > 0) {
            TextView actionsView = new TextView(this);
            actionsView.setText(android.text.TextUtils.join("  ·  ", data.actions));
            actionsView.setTextColor(TIME_GREY);
            actionsView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
            actionsView.setMaxLines(1);
            actionsView.setEllipsize(android.text.TextUtils.TruncateAt.END);
            actionsView.setPadding(0, dp(3), 0, 0);
            content.addView(actionsView);
        }

        card.addView(content);

        TextView timeView = new TextView(this);
        timeView.setTag("time_ago");
        timeView.setText(orDash(data.relativeTime));
        timeView.setTextColor(TIME_GREY);
        timeView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        timeView.setPadding(dp(8), 0, 0, 0);
        card.addView(timeView);

        return card;
    }

    /**
     * Real event title derived from the actual capture source + category —
     * no fabricated event types (e.g. no "backend submission/result" row:
     * addLog() only writes to Logcat today, nothing beyond a capture itself
     * is currently surfaced into LogStore/this feed — see migration report).
     */
    private static String eventTitle(SMSData data) {
        boolean isScreen = "Screen".equals(data.sender) || (data.source != null && !"SMS".equals(data.source) && !"NOTIFICATION".equals(data.source));
        // The app the notification actually came from, titled the way the
        // notification shade titles it. This used to read "Payment
        // notification detected" over a detail line beginning "merchant:" —
        // our own capture vocabulary plus a package fragment, neither of which
        // identifies the account the money arrived in.
        if (data.appName != null && !data.appName.isEmpty()) {
            return data.appName;
        }
        if ("NOTIFICATION".equals(data.source)) {
            if (SMSData.CATEGORY_PAYMENT.equals(data.category)) return "Payment notification detected";
            return "Notification detected";
        }
        if ("SMS".equals(data.source)) {
            if (SMSData.CATEGORY_BANK.equals(data.category)) return "Bank SMS detected";
            if (SMSData.CATEGORY_PAYMENT.equals(data.category)) return "Payment SMS detected";
            if (SMSData.CATEGORY_DEBIT.equals(data.category)) return "Debit SMS detected";
            if (SMSData.CATEGORY_OTP.equals(data.category)) return "OTP SMS detected";
            if (SMSData.CATEGORY_ALERT.equals(data.category)) return "Bank alert SMS detected";
            return "Bank SMS detected";
        }
        return "Capture event";
    }

    /** Short detail line: sender + amount if extracted, else the body text. */
    private static String eventDetail(SMSData data) {
        // For a notification we know the app of, the title already names the
        // app, so this is the notification's own text and nothing else — the
        // sender string would only repeat the app name and re-add the
        // "merchant:" prefix this row exists to get rid of.
        if (data.appName != null && !data.appName.isEmpty()
                && data.body != null && !data.body.isEmpty()) {
            return data.body;
        }
        String sender = orDash(data.sender);
        if (data.amount != null && !data.amount.isEmpty()) {
            return sender + " · ₹" + data.amount;
        }
        return sender + (data.body != null && !data.body.isEmpty() ? " · " + data.body : "");
    }

    /**
     * The source app's launcher icon, asked of the OS by package name.
     * Returns null when there is no package (SMS/screen captures) or the app
     * is not installed, so the caller can fall back to the generic badge.
     */
    private android.graphics.drawable.Drawable appIconFor(String packageName) {
        if (packageName == null || packageName.isEmpty()) {
            return null;
        }
        try {
            return getPackageManager().getApplicationIcon(packageName);
        } catch (Exception e) {
            // Uninstalled since capture, or not visible to us under the
            // package-visibility rules on API 30+. Not an error worth a log
            // line on a display path that has a working fallback.
            return null;
        }
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

    /** Builds a solid circular background drawable. */
    private android.graphics.drawable.GradientDrawable circle(int color) {
        android.graphics.drawable.GradientDrawable d =
                new android.graphics.drawable.GradientDrawable();
        d.setShape(android.graphics.drawable.GradientDrawable.OVAL);
        d.setColor(color);
        return d;
    }

    private static int withAlpha(int color, int alpha) {
        return (color & 0x00FFFFFF) | (alpha << 24);
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
