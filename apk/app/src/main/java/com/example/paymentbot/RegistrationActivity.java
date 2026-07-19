package com.example.paymentbot;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.AsyncTask;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

public class RegistrationActivity extends Activity {

  private EditText codeInput;
  private Button continueBtn;
  private TextView statusText;
  private TextView androidIdText;

  @Override
  protected void onCreate(Bundle saved) {
    super.onCreate(saved);

    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setBackgroundColor(Color.WHITE);
    root.setLayoutParams(new ViewGroup
      .LayoutParams(-1, -1));

    // Back button
    TextView backBtn = new TextView(this);
    backBtn.setText("←");
    backBtn.setTextColor(0xFF333333);
    backBtn.setTextSize(24);
    backBtn.setPadding(dp(20), dp(40),
      dp(20), dp(10));
    backBtn.setOnClickListener(v -> finish());
    root.addView(backBtn);

    // Title
    TextView title = new TextView(this);
    title.setText("Device registration");
    title.setTextColor(0xFF1A1A1A);
    title.setTextSize(22);
    title.setTypeface(null,
      android.graphics.Typeface.BOLD);
    title.setPadding(dp(24), dp(8),
      dp(24), dp(4));
    root.addView(title);

    // Android ID display
    String androidId = Settings.Secure.getString(
      getContentResolver(),
      Settings.Secure.ANDROID_ID
    );
    androidIdText = new TextView(this);
    androidIdText.setText(
      "for androidId: " + androidId
    );
    androidIdText.setTextColor(0xFF666666);
    androidIdText.setTextSize(13);
    androidIdText.setPadding(dp(24), 0,
      dp(24), dp(32));
    root.addView(androidIdText);

    // Spacer
    LinearLayout.LayoutParams spacer =
      new LinearLayout.LayoutParams(-1, 0, 1f);
    root.addView(new android.view.View(this),
      spacer);

    // Code input
    codeInput = new EditText(this);
    codeInput.setHint("Registration code");
    codeInput.setHintTextColor(0xFF999999);
    codeInput.setTextColor(0xFF1A1A1A);
    codeInput.setTextSize(16);
    codeInput.setBackgroundColor(
      Color.TRANSPARENT
    );

    android.view.View underline =
      new android.view.View(this);
    underline.setBackgroundColor(0xFF1565C0);
    LinearLayout.LayoutParams ulp =
      new LinearLayout.LayoutParams(-1, dp(2));
    ulp.setMargins(dp(24), 0, dp(24), 0);

    LinearLayout inputWrapper =
      new LinearLayout(this);
    inputWrapper.setOrientation(
      LinearLayout.VERTICAL
    );
    LinearLayout.LayoutParams iwp =
      new LinearLayout.LayoutParams(-1, -2);
    iwp.setMargins(dp(24), 0, dp(24), dp(4));

    codeInput.setPadding(0, dp(8), 0, dp(8));
    inputWrapper.addView(codeInput);
    root.addView(inputWrapper, iwp);
    root.addView(underline, ulp);

    // Status text
    statusText = new TextView(this);
    statusText.setText("");
    statusText.setTextSize(13);
    statusText.setPadding(dp(24), dp(8),
      dp(24), 0);
    root.addView(statusText);

    // Bottom spacer
    LinearLayout.LayoutParams spacer2 =
      new LinearLayout.LayoutParams(-1, 0, 1f);
    root.addView(new android.view.View(this),
      spacer2);

    // Continue button
    continueBtn = new Button(this);
    continueBtn.setText("Continue");
    continueBtn.setTextColor(Color.WHITE);
    continueBtn.setTextSize(16);
    continueBtn.setTypeface(null,
      android.graphics.Typeface.BOLD);
    continueBtn.setAllCaps(false);
    continueBtn.setEnabled(false);

    android.graphics.drawable.GradientDrawable
      btnBg =
      new android.graphics.drawable
        .GradientDrawable();
    btnBg.setColor(0xFF9E9E9E);
    btnBg.setCornerRadius(dp(12));
    continueBtn.setBackground(btnBg);

    LinearLayout.LayoutParams btnParams =
      new LinearLayout.LayoutParams(-1, dp(56));
    btnParams.setMargins(dp(24), dp(16),
      dp(24), dp(40));

    codeInput.addTextChangedListener(
      new android.text.TextWatcher() {
        @Override
        public void beforeTextChanged(
          CharSequence s, int st, int c, int a) {}
        @Override
        public void onTextChanged(
          CharSequence s, int st, int b, int c) {
          boolean hasCode = s.toString()
            .trim().length() >= 4;
          continueBtn.setEnabled(hasCode);
          android.graphics.drawable
            .GradientDrawable bg =
            new android.graphics.drawable
              .GradientDrawable();
          bg.setColor(hasCode ?
            0xFF1565C0 : 0xFF9E9E9E);
          bg.setCornerRadius(dp(12));
          continueBtn.setBackground(bg);
        }
        @Override
        public void afterTextChanged(
          android.text.Editable s) {}
      }
    );

    continueBtn.setOnClickListener(
      v -> attemptRegistration()
    );
    root.addView(continueBtn, btnParams);

    setContentView(root);
  }

  private void attemptRegistration() {
    String code = codeInput.getText()
      .toString().trim().toUpperCase();

    if (code.isEmpty()) {
      showStatus("Please enter code", 0xFFE53935);
      return;
    }

    continueBtn.setEnabled(false);
    showStatus("Verifying code...", 0xFF666666);

    String deviceId = Settings.Secure.getString(
      getContentResolver(),
      Settings.Secure.ANDROID_ID
    );
    String model = android.os.Build.MODEL;
    String androidVer =
      android.os.Build.VERSION.RELEASE;
    // Config.SERVER_BASE_URL / a stored override — the app's one source of
    // truth for the backend address (see RegistrationManager, Config).
    String serverUrl = RegistrationManager.getServerUrl(this);

    new AsyncTask<Void, Void, String>() {
      @Override
      protected String doInBackground(Void... v) {
        try {
          JSONObject json = new JSONObject();
          json.put("licenseKey", code);
          json.put("deviceId", deviceId);
          json.put("deviceModel", model);
          json.put("androidVersion", androidVer);
          json.put("appVersion", "1.0.0");

          URL url = new URL(serverUrl +
            "/api/apk/register-device");
          HttpURLConnection conn =
            (HttpURLConnection)
            url.openConnection();
          conn.setRequestMethod("POST");
          conn.setRequestProperty(
            "Content-Type", "application/json");
          conn.setDoOutput(true);
          conn.setConnectTimeout(10000);
          conn.getOutputStream().write(
            json.toString().getBytes("utf-8"));

          BufferedReader reader =
            new BufferedReader(
              new InputStreamReader(
                conn.getInputStream()));
          StringBuilder sb = new StringBuilder();
          String line;
          while ((line = reader.readLine())
              != null) sb.append(line);
          return sb.toString();
        } catch (Exception e) {
          return "ERROR:" + e.getMessage();
        }
      }

      @Override
      protected void onPostExecute(String result) {
        continueBtn.setEnabled(true);
        if (result.startsWith("ERROR:")) {
          showStatus(
            "Connection failed. Check server.",
            0xFFE53935
          );
          return;
        }
        try {
          JSONObject resp = new JSONObject(result);
          if (resp.optBoolean("success")) {
            RegistrationManager.register(
              RegistrationActivity.this,
              code,
              android.os.Build.MODEL,
              serverUrl
            );
            // Go to set device name
            startActivity(new Intent(
              RegistrationActivity.this,
              SetDeviceNameActivity.class
            ));
            finish();
          } else {
            showStatus(
              resp.optString("message",
                "Invalid code. Try again."),
              0xFFE53935
            );
          }
        } catch (Exception e) {
          showStatus(
            "Error: " + e.getMessage(),
            0xFFE53935
          );
        }
      }
    }.execute();
  }

  private void showStatus(
    String msg, int color
  ) {
    statusText.setText(msg);
    statusText.setTextColor(color);
  }

  private int dp(int dp) {
    return Math.round(dp *
      getResources().getDisplayMetrics().density);
  }
}
