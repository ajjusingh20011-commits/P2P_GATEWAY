package com.example.paymentbot;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.core.app.ActivityCompat;

public class PermissionActivity extends Activity {

  private int currentPage = 1;

  @Override
  protected void onCreate(Bundle saved) {
    super.onCreate(saved);
    showPage(1);
  }

  private void showPage(int page) {
    currentPage = page;
    LinearLayout root = buildRoot();

    switch (page) {
      case 1: buildNotificationPage(root); break;
      case 2: buildBatteryPage(root); break;
      case 3: buildSmsPage(root); break;
      case 4: buildAutoStartPage(root); break;
    }

    setContentView(root);
  }

  private LinearLayout buildRoot() {
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setBackgroundColor(Color.WHITE);
    root.setLayoutParams(new ViewGroup
      .LayoutParams(-1, -1));

    // X close button top left
    TextView closeBtn = new TextView(this);
    closeBtn.setText("✕");
    closeBtn.setTextColor(0xFF333333);
    closeBtn.setTextSize(20);
    closeBtn.setPadding(dp(20), dp(40),
      dp(20), dp(20));
    closeBtn.setOnClickListener(
      v -> finish()
    );
    root.addView(closeBtn);

    return root;
  }

  private void buildNotificationPage(
    LinearLayout root
  ) {
    // Center content area
    LinearLayout content = new LinearLayout(this);
    content.setOrientation(LinearLayout.VERTICAL);
    content.setGravity(Gravity.CENTER);
    LinearLayout.LayoutParams cp =
      new LinearLayout.LayoutParams(-1, 0, 1f);
    content.setLayoutParams(cp);

    // Warning icon (blue triangle)
    TextView icon = new TextView(this);
    icon.setText("🔔");
    icon.setTextSize(64);
    icon.setGravity(Gravity.CENTER);
    LinearLayout.LayoutParams ip =
      new LinearLayout.LayoutParams(-2, -2);
    ip.gravity = Gravity.CENTER;
    ip.bottomMargin = dp(32);
    content.addView(icon, ip);

    // Title
    TextView title = new TextView(this);
    title.setText("Notification access required");
    title.setTextColor(0xFF1A1A1A);
    title.setTextSize(20);
    title.setTypeface(null,
      android.graphics.Typeface.BOLD);
    title.setGravity(Gravity.CENTER);
    title.setPadding(dp(32), 0, dp(32), 0);
    LinearLayout.LayoutParams tp =
      new LinearLayout.LayoutParams(-1, -2);
    tp.bottomMargin = dp(16);
    content.addView(title, tp);

    // Description
    TextView desc = new TextView(this);
    desc.setText(
      "To handle incoming notifications,\n" +
      "please allow access to notifications."
    );
    desc.setTextColor(0xFF666666);
    desc.setTextSize(15);
    desc.setGravity(Gravity.CENTER);
    desc.setPadding(dp(32), 0, dp(32), 0);
    content.addView(desc);

    root.addView(content);

    // Bottom button
    Button btn = buildBottomButton("Allow");
    btn.setOnClickListener(v -> {
      startActivity(new Intent(
        Settings
          .ACTION_NOTIFICATION_LISTENER_SETTINGS
      ));
    });
    root.addView(btn);
  }

  private void buildBatteryPage(
    LinearLayout root
  ) {
    LinearLayout content = new LinearLayout(this);
    content.setOrientation(LinearLayout.VERTICAL);
    content.setGravity(Gravity.CENTER);
    LinearLayout.LayoutParams cp =
      new LinearLayout.LayoutParams(-1, 0, 1f);
    content.setLayoutParams(cp);

    TextView icon = new TextView(this);
    icon.setText("⚠️");
    icon.setTextSize(64);
    icon.setGravity(Gravity.CENTER);
    LinearLayout.LayoutParams ip =
      new LinearLayout.LayoutParams(-2, -2);
    ip.gravity = Gravity.CENTER;
    ip.bottomMargin = dp(32);
    content.addView(icon, ip);

    TextView title = new TextView(this);
    title.setText("Battery optimization enabled");
    title.setTextColor(0xFF1A1A1A);
    title.setTextSize(20);
    title.setTypeface(null,
      android.graphics.Typeface.BOLD);
    title.setGravity(Gravity.CENTER);
    title.setPadding(dp(32), 0, dp(32), 0);
    LinearLayout.LayoutParams tp =
      new LinearLayout.LayoutParams(-1, -2);
    tp.bottomMargin = dp(16);
    content.addView(title, tp);

    TextView desc = new TextView(this);
    desc.setText(
      "To prevent the system from stopping\n" +
      "the application in the background,\n" +
      "disable battery optimization for the app."
    );
    desc.setTextColor(0xFF666666);
    desc.setTextSize(15);
    desc.setGravity(Gravity.CENTER);
    desc.setPadding(dp(32), 0, dp(32), 0);
    content.addView(desc);

    root.addView(content);

    Button btn = buildBottomButton("Disable");
    btn.setOnClickListener(v -> {
      Intent i = new Intent(
        Settings
          .ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
      );
      i.setData(Uri.parse(
        "package:" + getPackageName()
      ));
      startActivity(i);
    });
    root.addView(btn);
  }

  private void buildSmsPage(LinearLayout root) {
    LinearLayout content = new LinearLayout(this);
    content.setOrientation(LinearLayout.VERTICAL);
    content.setGravity(Gravity.CENTER);
    LinearLayout.LayoutParams cp =
      new LinearLayout.LayoutParams(-1, 0, 1f);
    content.setLayoutParams(cp);

    TextView icon = new TextView(this);
    icon.setText("💬");
    icon.setTextSize(64);
    icon.setGravity(Gravity.CENTER);
    LinearLayout.LayoutParams ip =
      new LinearLayout.LayoutParams(-2, -2);
    ip.gravity = Gravity.CENTER;
    ip.bottomMargin = dp(32);
    content.addView(icon, ip);

    TextView title = new TextView(this);
    title.setText("Additional permissions required");
    title.setTextColor(0xFF1A1A1A);
    title.setTextSize(20);
    title.setTypeface(null,
      android.graphics.Typeface.BOLD);
    title.setGravity(Gravity.CENTER);
    title.setPadding(dp(32), 0, dp(32), 0);
    LinearLayout.LayoutParams tp =
      new LinearLayout.LayoutParams(-1, -2);
    tp.bottomMargin = dp(16);
    content.addView(title, tp);

    TextView desc = new TextView(this);
    desc.setText(
      "Please provide the appropriate\n" +
      "permission for the proper handling\n" +
      "of incoming SMS messages."
    );
    desc.setTextColor(0xFF666666);
    desc.setTextSize(15);
    desc.setGravity(Gravity.CENTER);
    desc.setPadding(dp(32), 0, dp(32), 0);
    content.addView(desc);

    root.addView(content);

    Button btn = buildBottomButton("Grant");
    btn.setOnClickListener(v -> {
      ActivityCompat.requestPermissions(
        this,
        new String[]{
          android.Manifest.permission.RECEIVE_SMS,
          android.Manifest.permission.READ_SMS
        },
        100
      );
    });
    root.addView(btn);
  }

  @Override
  public void onRequestPermissionsResult(
    int requestCode,
    String[] permissions,
    int[] grantResults
  ) {
    super.onRequestPermissionsResult(
      requestCode, permissions, grantResults
    );
    if (requestCode == 100) {
      if (detectOem() != null) {
        // A known aggressive-background-kill OEM — guide through its
        // specific autostart/protected-app step before registration.
        // Distinct from every permission requested on the previous 3
        // pages, and not something Android's standard permission APIs
        // (battery-optimization exemption included) cover at all.
        showPage(4);
      } else {
        goToRegistration();
      }
    }
  }

  private void goToRegistration() {
    startActivity(new Intent(
      this, RegistrationActivity.class
    ));
    finish();
  }

  /**
   * Item 1 — per-manufacturer background-kill behavior, reference:
   * dontkillmyapp.com's documented settings paths per OEM. Every intent
   * below is a best-effort deep link into an undocumented OEM activity —
   * these component names are not a stable public API, change across
   * firmware versions, and dontkillmyapp.com itself documents them as
   * such. {@link #launchOemAutostartSettings} always tries the specific
   * intent first, then falls back to the app's own details page (which,
   * unlike the specific screens, is a real, stable Android API on every
   * device) if the specific one isn't present on this exact firmware.
   * NOT independently verified against real hardware for every entry here
   * — see the audit report for exactly which ones still need a real-device
   * confirmation pass per manufacturer.
   */
  private enum Oem {
    // Xiaomi / Redmi / POCO (MIUI) — Security app's Autostart manager.
    XIAOMI("xiaomi|redmi|poco",
        "MIUI stops background apps unless\nAutostart is turned on.\n\n" +
        "Open Autostart settings below, find\nMaxPay in the list, and turn it ON.",
        "com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),

    // Oppo / Realme (ColorOS) — the case already built and shipped tonight.
    COLOROS("oppo|realme",
        "Realme/Oppo phones stop background apps\n" +
        "unless Auto-start is turned on.\n\n" +
        "Open App info below, then look for\n" +
        "\"Auto-start\" (sometimes under Battery\n" +
        "or App Management) and turn it ON.",
        null, null),

    // Vivo / iQOO — Permission Manager's background-startup whitelist.
    VIVO("vivo|iqoo",
        "Vivo phones stop background apps unless\n" +
        "they're added to the Autostart whitelist.\n\n" +
        "Open Autostart settings below, find\nMaxPay in the list, and turn it ON.",
        "com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),

    // Huawei / Honor (EMUI) — Phone Manager's Protected/Startup apps list.
    HUAWEI("huawei|honor",
        "Huawei/Honor phones stop background apps\n" +
        "unless they're a Protected App.\n\n" +
        "Open Startup Manager below, find MaxPay,\n" +
        "and enable Manage manually / Protected.",
        "com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),

    // Samsung (One UI) — no stable component across versions; Samsung's
    // "Put unused apps to sleep" / battery background-usage limits are the
    // relevant setting, but the deep link into it changes often enough
    // between One UI releases that a direct app-details fallback is safer
    // as the PRIMARY path here rather than a secondary fallback.
    SAMSUNG("samsung",
        "Samsung phones can put unused apps to\n" +
        "sleep, stopping background monitoring.\n\n" +
        "Open Battery settings below, find MaxPay\n" +
        "under \"Never sleeping apps\" or similar,\n" +
        "and make sure it's excluded from sleep.",
        null, null),

    // OnePlus (OxygenOS) — older, pre-ColorOS-merge builds have their own
    // advanced-optimization battery chain manager. Newer OnePlus phones run
    // a ColorOS-based OxygenOS and may actually need the COLOROS case
    // instead — Build.MANUFACTURER doesn't distinguish this, so this is the
    // most likely of all six entries to need real-device correction.
    ONEPLUS("oneplus",
        "OnePlus phones can restrict background\n" +
        "apps under Battery Optimization.\n\n" +
        "Open Battery settings below, find MaxPay,\n" +
        "and set it to \"Don't optimize\" and\n" +
        "disable \"Advanced Optimization\" for it.",
        "com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity");

    final String manufacturerPattern;
    final String instructions;
    final String intentPackage;
    final String intentClass;

    Oem(String manufacturerPattern, String instructions, String intentPackage, String intentClass) {
      this.manufacturerPattern = manufacturerPattern;
      this.instructions = instructions;
      this.intentPackage = intentPackage;
      this.intentClass = intentClass;
    }
  }

  /** Returns the matching OEM profile for this device, or null on stock/unknown Android. */
  private Oem detectOem() {
    String manufacturer = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase();
    for (Oem oem : Oem.values()) {
      for (String token : oem.manufacturerPattern.split("\\|")) {
        if (manufacturer.contains(token)) {
          return oem;
        }
      }
    }
    return null;
  }

  private void buildAutoStartPage(LinearLayout root) {
    Oem oem = detectOem();
    // Defensive only — this page is never shown unless detectOem() already
    // matched in onRequestPermissionsResult, but a fallback keeps this
    // method from crashing if that assumption is ever violated.
    if (oem == null) {
      goToRegistration();
      return;
    }

    LinearLayout content = new LinearLayout(this);
    content.setOrientation(LinearLayout.VERTICAL);
    content.setGravity(Gravity.CENTER);
    LinearLayout.LayoutParams cp =
      new LinearLayout.LayoutParams(-1, 0, 1f);
    content.setLayoutParams(cp);

    TextView icon = new TextView(this);
    icon.setText("🚀");
    icon.setTextSize(64);
    icon.setGravity(Gravity.CENTER);
    LinearLayout.LayoutParams ip =
      new LinearLayout.LayoutParams(-2, -2);
    ip.gravity = Gravity.CENTER;
    ip.bottomMargin = dp(32);
    content.addView(icon, ip);

    TextView title = new TextView(this);
    title.setText("Enable Auto-start");
    title.setTextColor(0xFF1A1A1A);
    title.setTextSize(20);
    title.setTypeface(null,
      android.graphics.Typeface.BOLD);
    title.setGravity(Gravity.CENTER);
    title.setPadding(dp(32), 0, dp(32), 0);
    LinearLayout.LayoutParams tp =
      new LinearLayout.LayoutParams(-1, -2);
    tp.bottomMargin = dp(16);
    content.addView(title, tp);

    // No manufacturer here has a single universal settings screen or intent
    // guaranteed stable across every firmware version — the on-screen text
    // spells out the manual path as the source of truth; the button below
    // is a best-effort shortcut into it, not a guarantee.
    TextView desc = new TextView(this);
    desc.setText(oem.instructions);
    desc.setTextColor(0xFF666666);
    desc.setTextSize(15);
    desc.setGravity(Gravity.CENTER);
    desc.setPadding(dp(32), 0, dp(32), 0);
    content.addView(desc);

    root.addView(content);

    Button openSettingsBtn = buildSecondaryButton("Open " + (oem.intentClass != null ? "autostart settings" : "battery settings"));
    openSettingsBtn.setOnClickListener(v -> launchOemAutostartSettings(oem));
    root.addView(openSettingsBtn);

    // There is no OS API to verify any of these OEM-specific toggles' state
    // (that's exactly why no universal intent exists either), so — unlike
    // pages 1-3, which auto-advance in onResume() once the real permission
    // state flips — this step needs an explicit, manual confirmation to
    // move on.
    Button doneBtn = buildBottomButton("I've enabled it");
    doneBtn.setOnClickListener(v -> goToRegistration());
    root.addView(doneBtn);
  }

  /**
   * Tries the OEM's specific autostart-manager activity first (fastest path
   * when it exists on this exact firmware); falls back to the app's own
   * details page — a real, stable Android API on every device — if that
   * specific activity isn't present, throws a SecurityException (some OEMs
   * block launching these directly on newer firmware), or the OEM has no
   * known specific intent at all (Samsung, and ColorOS's own established
   * behavior from tonight's fix).
   */
  private void launchOemAutostartSettings(Oem oem) {
    if (oem.intentPackage != null && oem.intentClass != null) {
      try {
        Intent intent = new Intent();
        intent.setComponent(new ComponentName(oem.intentPackage, oem.intentClass));
        startActivity(intent);
        return;
      } catch (Exception e) {
        // Falls through to the app-details fallback below — expected on
        // firmware versions where this specific activity has moved/renamed.
      }
    }
    try {
      Intent intent = new Intent(
        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
        Uri.parse("package:" + getPackageName())
      );
      startActivity(intent);
    } catch (Exception e) {
      // No-op — the "I've enabled it" button is still reachable even if
      // this device has no app-details screen at all.
    }
  }

  private Button buildSecondaryButton(String text) {
    Button btn = new Button(this);
    btn.setText(text);
    btn.setTextColor(0xFF1565C0);
    btn.setTextSize(15);
    btn.setTypeface(null, android.graphics.Typeface.BOLD);
    btn.setAllCaps(false);
    btn.setBackgroundColor(Color.TRANSPARENT);

    LinearLayout.LayoutParams lp =
      new LinearLayout.LayoutParams(-1, dp(48));
    lp.setMargins(dp(24), 0, dp(24), 0);
    btn.setLayoutParams(lp);
    return btn;
  }

  @Override
  protected void onResume() {
    super.onResume();
    // Check if notification permission given
    // and advance pages
    if (currentPage == 1) {
      String flat = Settings.Secure.getString(
        getContentResolver(),
        "enabled_notification_listeners"
      );
      boolean notifEnabled = flat != null &&
        flat.contains(getPackageName());
      if (notifEnabled) showPage(2);
    } else if (currentPage == 2) {
      PowerManager pm = (PowerManager)
        getSystemService(POWER_SERVICE);
      if (pm.isIgnoringBatteryOptimizations(
          getPackageName())) {
        showPage(3);
      }
    }
  }

  private Button buildBottomButton(String text) {
    Button btn = new Button(this);
    btn.setText(text);
    btn.setTextColor(Color.WHITE);
    btn.setTextSize(16);
    btn.setTypeface(null,
      android.graphics.Typeface.BOLD);
    btn.setAllCaps(false);

    android.graphics.drawable.GradientDrawable bg =
      new android.graphics.drawable
        .GradientDrawable();
    bg.setColor(0xFF1565C0);
    bg.setCornerRadius(dp(12));
    btn.setBackground(bg);

    LinearLayout.LayoutParams lp =
      new LinearLayout.LayoutParams(-1, dp(56));
    lp.setMargins(dp(24), dp(16),
      dp(24), dp(40));
    btn.setLayoutParams(lp);
    return btn;
  }

  private int dp(int dp) {
    return Math.round(dp *
      getResources().getDisplayMetrics().density);
  }
}
