package com.example.paymentbot;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.AnimationUtils;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.widget.ViewFlipper;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;

import java.util.ArrayList;
import java.util.List;

/**
 * First-run onboarding. Walks the user page-by-page through the permissions the
 * bot needs to monitor payments 24/7. Shown only until "onboarding_done" is set
 * in the "paymentbot" SharedPreferences; after that {@link MainActivity} skips it.
 */
public class OnboardingActivity extends AppCompatActivity {

    // Palette.
    private static final int BG = 0xFF000000;
    private static final int GREEN = 0xFF34D399;
    private static final int WHITE = 0xFFFFFFFF;
    private static final int GREY = 0xFFA1A1AA;
    private static final int DOT_INACTIVE = 0xFF27272A;

    private static final int PAGE_COUNT = 4;
    private static final int REQ_SMS = 101;

    private ViewFlipper flipper;
    private final List<View> dots = new ArrayList<>();
    private TextView pageCounter;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);
        root.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        flipper = new ViewFlipper(this);
        flipper.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        flipper.setInAnimation(AnimationUtils.loadAnimation(this, android.R.anim.slide_in_left));
        flipper.setOutAnimation(AnimationUtils.loadAnimation(this, android.R.anim.slide_out_right));

        flipper.addView(buildWelcomePage());
        flipper.addView(buildSmsPage());
        flipper.addView(buildNotificationPage());
        flipper.addView(buildBatteryPage());
        root.addView(flipper);

        root.addView(buildFooter());

        setContentView(root);
        updateIndicator();
    }

    // ---------------------------------------------------------------------
    // Pages
    // ---------------------------------------------------------------------
    private View buildWelcomePage() {
        LinearLayout page = newPage();
        page.addView(emoji("💳")); // 💳
        page.addView(title("Welcome to PaymentBot"));
        page.addView(subtitle("Monitor all payments, SMS and notifications in one place"));
        page.addView(spacer(dp(28)));
        Button next = greenButton("NEXT");
        next.setOnClickListener(v -> goToPage(1));
        page.addView(next);
        return page;
    }

    private View buildSmsPage() {
        LinearLayout page = newPage();
        page.addView(emoji("📱")); // 📱
        page.addView(title("Allow SMS Access"));
        page.addView(subtitle("To read payment confirmations and bank alerts"));
        page.addView(spacer(dp(28)));
        Button grant = greenButton("Grant SMS Permission");
        grant.setOnClickListener(v -> requestSmsPermission());
        page.addView(grant);
        page.addView(skipLink(2));
        return page;
    }

    private View buildNotificationPage() {
        LinearLayout page = newPage();
        page.addView(emoji("🔔")); // 🔔
        page.addView(title("Allow Notifications"));
        page.addView(subtitle("To capture payment notifications from Paytm, PhonePe, GPay and all apps"));
        page.addView(spacer(dp(28)));
        Button enable = greenButton("Enable Notification Access");
        enable.setOnClickListener(v -> {
            safeStart(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
        });
        page.addView(enable);
        page.addView(skipLink(3));
        return page;
    }

    private View buildBatteryPage() {
        LinearLayout page = newPage();
        page.addView(emoji("🔋")); // 🔋
        page.addView(title("Disable Battery Saver"));
        page.addView(subtitle("Prevents MIUI from stopping the bot after a few hours. "
                + "Required for 24/7 monitoring"));
        page.addView(spacer(dp(28)));

        Button battery = greenButton("Disable Battery Optimization");
        battery.setOnClickListener(v -> requestIgnoreBatteryOptimizations());
        page.addView(battery);

        page.addView(spacer(dp(14)));

        Button done = greenButton("✓ Done! Start Monitoring");
        done.setOnClickListener(v -> finishOnboarding());
        page.addView(done);
        return page;
    }

    // ---------------------------------------------------------------------
    // Footer: page dots + "N of 4"
    // ---------------------------------------------------------------------
    private View buildFooter() {
        LinearLayout footer = new LinearLayout(this);
        footer.setOrientation(LinearLayout.VERTICAL);
        footer.setGravity(Gravity.CENTER_HORIZONTAL);
        footer.setPadding(dp(16), dp(12), dp(16), dp(24));
        footer.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        LinearLayout dotRow = new LinearLayout(this);
        dotRow.setOrientation(LinearLayout.HORIZONTAL);
        dotRow.setGravity(Gravity.CENTER);
        dots.clear();
        for (int i = 0; i < PAGE_COUNT; i++) {
            View dot = new View(this);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(8), dp(8));
            lp.setMargins(dp(5), 0, dp(5), 0);
            dot.setLayoutParams(lp);
            dot.setBackground(circle(DOT_INACTIVE));
            dots.add(dot);
            dotRow.addView(dot);
        }
        footer.addView(dotRow);

        pageCounter = new TextView(this);
        pageCounter.setTextColor(GREY);
        pageCounter.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        pageCounter.setPadding(0, dp(10), 0, 0);
        pageCounter.setGravity(Gravity.CENTER);
        footer.addView(pageCounter);

        return footer;
    }

    private void updateIndicator() {
        int current = flipper.getDisplayedChild();
        for (int i = 0; i < dots.size(); i++) {
            dots.get(i).setBackground(circle(i == current ? GREEN : DOT_INACTIVE));
        }
        if (pageCounter != null) {
            pageCounter.setText((current + 1) + " of " + PAGE_COUNT);
        }
    }

    private void goToPage(int index) {
        if (index < 0 || index >= flipper.getChildCount()) return;
        int current = flipper.getDisplayedChild();
        if (index > current) {
            flipper.setInAnimation(AnimationUtils.loadAnimation(this, android.R.anim.slide_in_left));
            flipper.setOutAnimation(AnimationUtils.loadAnimation(this, android.R.anim.slide_out_right));
        }
        flipper.setDisplayedChild(index);
        updateIndicator();
    }

    // ---------------------------------------------------------------------
    // Permission actions
    // ---------------------------------------------------------------------
    private void requestSmsPermission() {
        ActivityCompat.requestPermissions(this,
                new String[]{Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS},
                REQ_SMS);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions,
                                           @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_SMS) {
            goToPage(2);
        }
    }

    private void requestIgnoreBatteryOptimizations() {
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + getPackageName()));
            startActivity(intent);
        } catch (Exception e) {
            safeStart(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
        }
    }

    private void finishOnboarding() {
        SharedPreferences prefs = getSharedPreferences("paymentbot", MODE_PRIVATE);
        prefs.edit().putBoolean("onboarding_done", true).apply();

        // Kick off the keep-alive service + watchdog now that setup is complete.
        try {
            Intent svc = new Intent(this, KeepAliveService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(svc);
            } else {
                startService(svc);
            }
            AlarmHelper.scheduleWatchdog(this);
        } catch (Exception ignored) {
        }

        startActivity(new Intent(this, MainActivity.class));
        finish();
    }

    private void safeStart(Intent intent) {
        try {
            startActivity(intent);
        } catch (Exception e) {
            Toast.makeText(this, "Open Settings and grant access manually", Toast.LENGTH_LONG).show();
        }
    }

    // ---------------------------------------------------------------------
    // View builders
    // ---------------------------------------------------------------------
    private LinearLayout newPage() {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setGravity(Gravity.CENTER);
        page.setBackgroundColor(BG);
        page.setPadding(dp(32), dp(24), dp(32), dp(24));
        page.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        return page;
    }

    private TextView emoji(String e) {
        TextView tv = new TextView(this);
        tv.setText(e);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 72);
        tv.setGravity(Gravity.CENTER);
        tv.setPadding(0, 0, 0, dp(24));
        return tv;
    }

    private TextView title(String text) {
        TextView tv = new TextView(this);
        tv.setText(text);
        tv.setTextColor(WHITE);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26);
        tv.setTypeface(Typeface.DEFAULT_BOLD);
        tv.setGravity(Gravity.CENTER);
        return tv;
    }

    private TextView subtitle(String text) {
        TextView tv = new TextView(this);
        tv.setText(text);
        tv.setTextColor(GREY);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        tv.setGravity(Gravity.CENTER);
        tv.setLineSpacing(dp(4), 1f);
        tv.setPadding(dp(8), dp(12), dp(8), 0);
        return tv;
    }

    private Button greenButton(String text) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextColor(0xFF000000);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setBackground(rounded(GREEN, dp(12)));
        b.setPadding(dp(24), dp(16), dp(24), dp(16));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        b.setLayoutParams(lp);
        b.setStateListAnimator(null);
        return b;
    }

    private TextView skipLink(final int targetPage) {
        TextView tv = new TextView(this);
        tv.setText("Skip");
        tv.setTextColor(GREY);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        tv.setGravity(Gravity.CENTER);
        tv.setPadding(dp(12), dp(18), dp(12), dp(12));
        tv.setOnClickListener(v -> goToPage(targetPage));
        return tv;
    }

    private View spacer(int height) {
        View v = new View(this);
        v.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, height));
        return v;
    }

    private GradientDrawable rounded(int color, int radius) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(radius);
        return d;
    }

    private GradientDrawable circle(int color) {
        GradientDrawable d = new GradientDrawable();
        d.setShape(GradientDrawable.OVAL);
        d.setColor(color);
        return d;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    /** Convenience used by MainActivity's gate check. */
    static boolean isOnboardingDone(Context ctx) {
        return ctx.getSharedPreferences("paymentbot", MODE_PRIVATE)
                .getBoolean("onboarding_done", false);
    }
}
