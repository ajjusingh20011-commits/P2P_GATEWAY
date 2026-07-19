package com.example.paymentbot;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.os.AsyncTask;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;

public class SetDeviceNameActivity
  extends Activity {

  private EditText nameInput;
  private Button confirmBtn;

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
    title.setText("Set device name");
    title.setTextColor(0xFF1A1A1A);
    title.setTextSize(22);
    title.setTypeface(null,
      android.graphics.Typeface.BOLD);
    title.setPadding(dp(24), dp(8),
      dp(24), dp(32));
    root.addView(title);

    // Spacer
    root.addView(new android.view.View(this),
      new LinearLayout.LayoutParams(-1, 0, 1f));

    // Name input
    nameInput = new EditText(this);
    nameInput.setHint("Device name");
    nameInput.setHintTextColor(0xFF999999);
    nameInput.setTextColor(0xFF1A1A1A);
    nameInput.setTextSize(16);
    nameInput.setBackgroundColor(
      Color.TRANSPARENT
    );
    nameInput.setPadding(0, dp(8), 0, dp(8));

    LinearLayout.LayoutParams inputParams =
      new LinearLayout.LayoutParams(-1, -2);
    inputParams.setMargins(dp(24), 0,
      dp(24), dp(4));
    root.addView(nameInput, inputParams);

    // Underline
    android.view.View underline =
      new android.view.View(this);
    underline.setBackgroundColor(0xFF1565C0);
    LinearLayout.LayoutParams ulp =
      new LinearLayout.LayoutParams(-1, dp(2));
    ulp.setMargins(dp(24), 0, dp(24), dp(8));
    root.addView(underline, ulp);

    // Hint text
    TextView hint = new TextView(this);
    hint.setText(
      "Device name will be displayed\n" +
      "in your Trader Cabinet"
    );
    hint.setTextColor(0xFF999999);
    hint.setTextSize(12);
    LinearLayout.LayoutParams hp =
      new LinearLayout.LayoutParams(-1, -2);
    hp.setMargins(dp(24), 0, dp(24), 0);
    root.addView(hint, hp);

    // Bottom spacer
    root.addView(new android.view.View(this),
      new LinearLayout.LayoutParams(-1, 0, 1f));

    // Confirm button
    confirmBtn = new Button(this);
    confirmBtn.setText("Confirm");
    confirmBtn.setTextColor(Color.WHITE);
    confirmBtn.setTextSize(16);
    confirmBtn.setTypeface(null,
      android.graphics.Typeface.BOLD);
    confirmBtn.setAllCaps(false);

    android.graphics.drawable.GradientDrawable
      btnBg =
      new android.graphics.drawable
        .GradientDrawable();
    btnBg.setColor(0xFF9E9E9E);
    btnBg.setCornerRadius(dp(12));
    confirmBtn.setBackground(btnBg);

    nameInput.addTextChangedListener(
      new android.text.TextWatcher() {
        @Override
        public void beforeTextChanged(
          CharSequence s, int st,
          int c, int a) {}
        @Override
        public void onTextChanged(
          CharSequence s, int st,
          int b, int c) {
          boolean hasName =
            s.toString().trim().length() > 0;
          confirmBtn.setEnabled(hasName);
          android.graphics.drawable
            .GradientDrawable bg =
            new android.graphics.drawable
              .GradientDrawable();
          bg.setColor(hasName ?
            0xFF1565C0 : 0xFF9E9E9E);
          bg.setCornerRadius(dp(12));
          confirmBtn.setBackground(bg);
        }
        @Override
        public void afterTextChanged(
          android.text.Editable s) {}
      }
    );

    confirmBtn.setOnClickListener(
      v -> saveDeviceName()
    );
    confirmBtn.setEnabled(false);

    LinearLayout.LayoutParams btnParams =
      new LinearLayout.LayoutParams(-1, dp(56));
    btnParams.setMargins(dp(24), dp(16),
      dp(24), dp(40));
    root.addView(confirmBtn, btnParams);

    setContentView(root);
  }

  private void saveDeviceName() {
    String name = nameInput.getText()
      .toString().trim();
    String serverUrl =
      RegistrationManager.getServerUrl(this);
    String licenseKey =
      RegistrationManager.getLicenseKey(this);
    String deviceId =
      RegistrationManager.getDeviceId(this);

    confirmBtn.setEnabled(false);

    new AsyncTask<Void, Void, Boolean>() {
      @Override
      protected Boolean doInBackground(Void... v) {
        try {
          JSONObject json = new JSONObject();
          json.put("licenseKey", licenseKey);
          json.put("deviceId", deviceId);
          json.put("deviceName", name);

          URL url = new URL(serverUrl +
            "/api/apk/update-device-name");
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
          conn.getResponseCode();
          return true;
        } catch (Exception e) {
          return false;
        }
      }

      @Override
      protected void onPostExecute(Boolean ok) {
        // Save name locally
        RegistrationManager.register(
          SetDeviceNameActivity.this,
          licenseKey,
          name,
          serverUrl
        );

        // Show success dialog
        new AlertDialog.Builder(
          SetDeviceNameActivity.this
        )
        .setTitle("Registration complete")
        .setMessage(
          "The device is successfully " +
          "registered and ready to work. " +
          "Please keep your phone charged " +
          "and connected to the internet."
        )
        .setPositiveButton("Ok", (d, w) -> {
          d.dismiss();
          // Go to main activity
          startActivity(new Intent(
            SetDeviceNameActivity.this,
            MainActivity.class
          ));
          finish();
        })
        .setCancelable(false)
        .show();
      }
    }.execute();
  }

  private int dp(int dp) {
    return Math.round(dp *
      getResources().getDisplayMetrics().density);
  }
}
