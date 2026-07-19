package com.example.paymentbot;

import android.app.Service;
import android.content.Intent;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;

public class HeartbeatService extends Service {

  private static final String TAG = "MaxPay";
  private Handler handler;
  private Runnable heartbeatRunnable;
  private static final int INTERVAL = 4000;

  @Override
  public void onCreate() {
    super.onCreate();
    handler = new Handler(Looper.getMainLooper());
    heartbeatRunnable = new Runnable() {
      @Override
      public void run() {
        sendHeartbeat();
        handler.postDelayed(this, INTERVAL);
      }
    };
    handler.post(heartbeatRunnable);
    Log.d(TAG, "HeartbeatService started");
  }

  private void sendHeartbeat() {
    if (!RegistrationManager.isRegistered(this))
      return;

    new Thread(() -> {
      try {
        String serverUrl =
          RegistrationManager.getServerUrl(this);
        String licenseKey =
          RegistrationManager.getLicenseKey(this);
        String deviceId =
          RegistrationManager.getDeviceId(this);

        JSONObject json = new JSONObject();
        json.put("licenseKey", licenseKey);
        json.put("deviceId", deviceId);
        json.put("status", "active");
        json.put("timestamp",
          TimeFormatter.toUTC(
            System.currentTimeMillis()
          )
        );

        URL url = new URL(
          serverUrl + "/api/apk/heartbeat"
        );
        HttpURLConnection conn =
          (HttpURLConnection)
          url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty(
          "Content-Type", "application/json");
        conn.setDoOutput(true);
        conn.setConnectTimeout(3000);
        conn.setReadTimeout(3000);
        conn.getOutputStream().write(
          json.toString().getBytes("utf-8"));
        conn.getResponseCode();
        conn.disconnect();

      } catch (Exception e) {
        Log.d(TAG, "Heartbeat failed: "
          + e.getMessage());
      }
    }).start();
  }

  @Override
  public int onStartCommand(
    Intent intent, int flags, int startId
  ) {
    return START_STICKY;
  }

  @Override
  public void onDestroy() {
    super.onDestroy();
    if (handler != null && heartbeatRunnable != null)
      handler.removeCallbacks(heartbeatRunnable);
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
