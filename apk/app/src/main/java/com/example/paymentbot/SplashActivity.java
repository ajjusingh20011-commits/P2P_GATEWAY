package com.example.paymentbot;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

public class SplashActivity extends Activity {

  @Override
  protected void onCreate(Bundle saved) {
    super.onCreate(saved);

    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setGravity(Gravity.CENTER);
    root.setBackgroundColor(Color.WHITE);
    root.setLayoutParams(new ViewGroup
      .LayoutParams(-1, -1));

    // Logo circle
    android.widget.FrameLayout circle =
      new android.widget.FrameLayout(this);
    int size = dp(120);
    LinearLayout.LayoutParams cp =
      new LinearLayout.LayoutParams(size, size);
    cp.gravity = Gravity.CENTER;
    cp.bottomMargin = dp(24);

    android.graphics.drawable.GradientDrawable gd =
      new android.graphics.drawable
        .GradientDrawable();
    gd.setShape(android.graphics.drawable
      .GradientDrawable.OVAL);
    gd.setColor(0xFF1B5E3B);
    circle.setBackground(gd);

    TextView logoIcon = new TextView(this);
    logoIcon.setText("₹");
    logoIcon.setTextColor(Color.WHITE);
    logoIcon.setTextSize(48);
    logoIcon.setGravity(Gravity.CENTER);
    android.widget.FrameLayout.LayoutParams fp =
      new android.widget.FrameLayout
        .LayoutParams(-1, -1);
    circle.addView(logoIcon, fp);
    root.addView(circle, cp);

    // App name
    TextView appName = new TextView(this);
    appName.setText("MaxPay");
    appName.setTextColor(0xFF1B5E3B);
    appName.setTextSize(32);
    appName.setTypeface(null,
      android.graphics.Typeface.BOLD);
    appName.setGravity(Gravity.CENTER);
    LinearLayout.LayoutParams np =
      new LinearLayout.LayoutParams(-2, -2);
    np.gravity = Gravity.CENTER;
    np.bottomMargin = dp(8);
    root.addView(appName, np);

    // Tagline
    TextView tagline = new TextView(this);
    tagline.setText("Simplifying Payments");
    tagline.setTextColor(0xFF666666);
    tagline.setTextSize(14);
    tagline.setGravity(Gravity.CENTER);
    LinearLayout.LayoutParams tp =
      new LinearLayout.LayoutParams(-2, -2);
    tp.gravity = Gravity.CENTER;
    tp.bottomMargin = dp(48);
    root.addView(tagline, tp);

    // Progress spinner
    ProgressBar spinner = new ProgressBar(this);
    android.graphics.PorterDuff.Mode mode =
      android.graphics.PorterDuff.Mode.SRC_IN;
    spinner.getIndeterminateDrawable()
      .setColorFilter(0xFF1B5E3B, mode);
    LinearLayout.LayoutParams sp =
      new LinearLayout.LayoutParams(dp(40), dp(40));
    sp.gravity = Gravity.CENTER;
    root.addView(spinner, sp);

    setContentView(root);

    // Check registration after 2 seconds
    new Handler().postDelayed(() -> {
      if (!RegistrationManager
          .isRegistered(this)) {
        startActivity(new Intent(this,
          PermissionActivity.class));
      } else {
        startActivity(new Intent(this,
          MainActivity.class));
      }
      finish();
    }, 2000);
  }

  private int dp(int dp) {
    return Math.round(dp *
      getResources().getDisplayMetrics().density);
  }
}
