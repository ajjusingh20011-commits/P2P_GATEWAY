package com.example.paymentbot;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.util.Log;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import java.net.HttpURLConnection;
import java.net.URL;

public class SplashActivity extends Activity {

  private static final String TAG = "MaxPay";
  private static final int STATUS_CHECK_TIMEOUT_MS = 5000;
  // Approved MaxPay brand — primary emerald, replacing the previous
  // slightly-different green (#1B5E3B).
  private static final int BRAND_PRIMARY = 0xFF0F6B5C;

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
    gd.setColor(BRAND_PRIMARY);
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

    // App name — minimal branding only, per the approved direction (no
    // tagline copy, no extra descriptive text on this screen).
    TextView appName = new TextView(this);
    appName.setText("MaxPay");
    appName.setTextColor(BRAND_PRIMARY);
    appName.setTextSize(32);
    appName.setTypeface(null,
      android.graphics.Typeface.BOLD);
    appName.setGravity(Gravity.CENTER);
    LinearLayout.LayoutParams np =
      new LinearLayout.LayoutParams(-2, -2);
    np.gravity = Gravity.CENTER;
    np.bottomMargin = dp(40);
    root.addView(appName, np);

    // Progress spinner
    ProgressBar spinner = new ProgressBar(this);
    android.graphics.PorterDuff.Mode mode =
      android.graphics.PorterDuff.Mode.SRC_IN;
    spinner.getIndeterminateDrawable()
      .setColorFilter(BRAND_PRIMARY, mode);
    LinearLayout.LayoutParams sp =
      new LinearLayout.LayoutParams(dp(40), dp(40));
    sp.gravity = Gravity.CENTER;
    root.addView(spinner, sp);

    setContentView(root);

    // Check registration after 2 seconds
    new Handler().postDelayed(this::checkRegistrationAndProceed, 2000);
  }

  /**
   * A non-empty license_key in SharedPreferences used to be trusted forever
   * — including a value silently restored by Android's app-data backup on
   * reinstall (see AndroidManifest's dataExtractionRules), long after the
   * trader may have deleted this device from the panel. Confirm with the
   * server before trusting it: only a definite "not found" clears local
   * state and sends the user back through pairing. A network error/timeout
   * fails open (trusts local state) — a phone with no signal shouldn't be
   * forced to re-pair.
   */
  private void checkRegistrationAndProceed() {
    if (!RegistrationManager.isRegistered(this)) {
      goTo(PermissionActivity.class);
      return;
    }

    new Thread(() -> {
      String result = confirmRegisteredOnServer();
      runOnUiThread(() -> {
        if ("not_found".equals(result)) {
          Log.d(TAG, "Device no longer exists server-side — clearing local pairing");
          RegistrationManager.clearRegistration(this);
          goTo(PermissionActivity.class);
        } else {
          // "found" or "unknown" (network error/timeout) — both proceed
          // as before; only a confirmed absence forces re-pairing.
          goTo(MainActivity.class);
        }
      });
    }).start();
  }

  /** @return "found", "not_found", or "unknown" (network/parse failure). */
  private String confirmRegisteredOnServer() {
    HttpURLConnection conn = null;
    try {
      String serverUrl = RegistrationManager.getServerUrl(this);
      String deviceId = RegistrationManager.getDeviceId(this);
      URL url = new URL(serverUrl + "/api/apk/status/" + deviceId);
      conn = (HttpURLConnection) url.openConnection();
      conn.setRequestMethod("GET");
      conn.setConnectTimeout(STATUS_CHECK_TIMEOUT_MS);
      conn.setReadTimeout(STATUS_CHECK_TIMEOUT_MS);

      int code = conn.getResponseCode();
      if (code == 404) {
        return "not_found";
      }
      if (code >= 200 && code < 300) {
        return "found";
      }
      Log.d(TAG, "Status check unexpected response: " + code);
      return "unknown";
    } catch (Exception e) {
      Log.d(TAG, "Status check failed (offline?): " + e.getMessage());
      return "unknown";
    } finally {
      if (conn != null) {
        conn.disconnect();
      }
    }
  }

  private void goTo(Class<?> activity) {
    startActivity(new Intent(this, activity));
    finish();
  }

  private int dp(int dp) {
    return Math.round(dp *
      getResources().getDisplayMetrics().density);
  }
}
