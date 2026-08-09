package com.example.paymentbot;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;

/**
 * Real "update available" screen — previously this app had no such screen
 * at all (see the migration report's screen-mapping table): the real flow
 * was purely background-worker + system notification + system installer.
 * This is purely additive UI on top of that unchanged flow — reads
 * {@link UpdateStore#getAvailableVersionCode} (set by
 * {@link UpdateCheckWorker} right after it parses the real
 * GET /api/apk/latest-version response) rather than any invented value, and
 * "Update now" launches the exact same FileProvider install-intent
 * ApkDownloadWorker's own notification already uses once the update has
 * finished downloading. Nothing here changes the check/download/install
 * behavior itself.
 *
 * Not part of the normal launch chain (Splash never routes here
 * automatically) — reached only from a Settings banner that itself only
 * appears when UpdateStore actually has something to report, so this screen
 * is never shown unless the backend/version source genuinely says so.
 */
public class UpdateAvailableActivity extends Activity {

  private static final int BRAND_PRIMARY = 0xFF0F6B5C;

  @Override
  protected void onCreate(Bundle saved) {
    super.onCreate(saved);

    int availableVersionCode = UpdateStore.getAvailableVersionCode(this);
    String availableVersionName = UpdateStore.getAvailableVersionName(this);

    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setBackgroundColor(Color.WHITE);
    root.setLayoutParams(new ViewGroup.LayoutParams(-1, -1));

    TextView closeBtn = new TextView(this);
    closeBtn.setText("✕");
    closeBtn.setTextColor(0xFF333333);
    closeBtn.setTextSize(20);
    closeBtn.setPadding(dp(20), dp(40), dp(20), dp(20));
    closeBtn.setOnClickListener(v -> finish());
    root.addView(closeBtn);

    LinearLayout content = new LinearLayout(this);
    content.setOrientation(LinearLayout.VERTICAL);
    content.setGravity(Gravity.CENTER);
    content.setLayoutParams(new LinearLayout.LayoutParams(-1, 0, 1f));

    TextView icon = new TextView(this);
    icon.setText("⬆️");
    icon.setTextSize(56);
    icon.setGravity(Gravity.CENTER);
    LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(-2, -2);
    ip.gravity = Gravity.CENTER;
    ip.bottomMargin = dp(24);
    content.addView(icon, ip);

    TextView title = new TextView(this);
    title.setText("Update available");
    title.setTextColor(0xFF1A1A1A);
    title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
    title.setTypeface(null, Typeface.BOLD);
    title.setGravity(Gravity.CENTER);
    LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(-1, -2);
    tp.bottomMargin = dp(8);
    content.addView(title, tp);

    TextView versionLine = new TextView(this);
    String currentName = "1.0.0";
    try {
      currentName = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
    } catch (Exception ignored) {
    }
    String availableLabel = availableVersionName.isEmpty()
        ? String.valueOf(availableVersionCode) : availableVersionName;
    versionLine.setText(currentName + " → " + availableLabel);
    versionLine.setTextColor(0xFF666666);
    versionLine.setTextSize(15);
    versionLine.setGravity(Gravity.CENTER);
    content.addView(versionLine);

    root.addView(content);

    boolean downloaded = availableVersionCode > 0
        && UpdateStore.getDownloadedVersionCode(this) == availableVersionCode
        && new File(UpdateStore.getDownloadedFilePath(this)).exists();

    Button updateBtn = new Button(this);
    updateBtn.setText(downloaded ? "Install now" : "Downloading…");
    updateBtn.setEnabled(downloaded);
    updateBtn.setTextColor(Color.WHITE);
    updateBtn.setTextSize(16);
    updateBtn.setTypeface(null, Typeface.BOLD);
    updateBtn.setAllCaps(false);
    android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable();
    bg.setColor(downloaded ? BRAND_PRIMARY : 0xFF9E9E9E);
    bg.setCornerRadius(dp(12));
    updateBtn.setBackground(bg);
    LinearLayout.LayoutParams btnLp = new LinearLayout.LayoutParams(-1, dp(56));
    btnLp.setMargins(dp(24), dp(16), dp(24), dp(12));
    updateBtn.setLayoutParams(btnLp);
    updateBtn.setOnClickListener(v -> launchInstaller());
    root.addView(updateBtn);

    TextView laterBtn = new TextView(this);
    laterBtn.setText("Later");
    laterBtn.setTextColor(0xFF666666);
    laterBtn.setTextSize(15);
    laterBtn.setGravity(Gravity.CENTER);
    laterBtn.setPadding(dp(24), dp(12), dp(24), dp(32));
    laterBtn.setOnClickListener(v -> finish());
    root.addView(laterBtn);

    setContentView(root);
  }

  /**
   * Reuses the exact install path ApkDownloadWorker.showInstallNotification
   * already uses — same FileProvider authority, same ACTION_VIEW intent
   * shape — just triggered from a tap in this screen instead of a
   * notification tap.
   */
  private void launchInstaller() {
    String path = UpdateStore.getDownloadedFilePath(this);
    if (path.isEmpty()) {
      Toast.makeText(this, "Still downloading — try again shortly", Toast.LENGTH_SHORT).show();
      return;
    }
    File apkFile = new File(path);
    if (!apkFile.exists()) {
      Toast.makeText(this, "Update file not found — still downloading", Toast.LENGTH_SHORT).show();
      return;
    }
    try {
      Uri apkUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", apkFile);
      Intent installIntent = new Intent(Intent.ACTION_VIEW);
      installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
      installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
      startActivity(installIntent);
    } catch (Exception e) {
      Toast.makeText(this, "Couldn't open installer", Toast.LENGTH_SHORT).show();
    }
  }

  private int dp(int v) {
    return Math.round(v * getResources().getDisplayMetrics().density);
  }
}
