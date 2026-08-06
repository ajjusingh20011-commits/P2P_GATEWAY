package com.example.paymentbot;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.service.notification.NotificationListenerService;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;

public class HeartbeatService extends Service {

  private static final String TAG = "MaxPay";
  private static final String CHANNEL_ID = "PaymentBot";
  private static final String CHANNEL_NAME = "PaymentBot";
  private static final int REPAIR_NOTIF_ID = 1002;
  private Handler handler;
  private Runnable heartbeatRunnable;
  private static final int INTERVAL = 4000;

  // Don't call requestRebind() on every 4s tick while disconnected — a rebind
  // isn't instantaneous, so retrying that fast would just spam the OS with
  // redundant requests before the previous one has had a chance to land.
  private static final long REBIND_COOLDOWN_MS = 60000;

  @Override
  public void onCreate() {
    super.onCreate();
    handler = new Handler(Looper.getMainLooper());
    heartbeatRunnable = new Runnable() {
      @Override
      public void run() {
        sendHeartbeat();
        checkListenerHealth();
        handler.postDelayed(this, INTERVAL);
      }
    };
    handler.post(heartbeatRunnable);
    Log.d(TAG, "HeartbeatService started");
  }

  /**
   * Piggybacks on the existing 4s heartbeat tick: if the notification-access
   * permission is granted (MainActivity.isNotificationListenerEnabled) but
   * NotificationService itself has reported disconnected (ListenerHealthStore
   * — set from onListenerConnected/onListenerDisconnected), that's exactly
   * the ColorOS-style silent-unbind case — the user never revoked anything,
   * the OS just killed the binding. Ask the OS to restore it.
   */
  private void checkListenerHealth() {
    try {
      boolean permissionGranted = MainActivity.isNotificationListenerEnabled(this);
      boolean reportedConnected = ListenerHealthStore.isConnected(this);
      if (!permissionGranted || reportedConnected) {
        // Either genuinely not granted (nothing to rebind — user has to grant
        // it via Settings, requestRebind() can't fix that) or healthy.
        return;
      }
      long sinceLastAttempt = System.currentTimeMillis() - ListenerHealthStore.lastRebindAttemptAt(this);
      if (sinceLastAttempt < REBIND_COOLDOWN_MS) {
        return;
      }
      Log.w(TAG, "Notification listener permission granted but disconnected — requesting rebind");
      ListenerHealthStore.markRebindAttempt(this);
      NotificationListenerService.requestRebind(
              new ComponentName(this, NotificationService.class));
    } catch (Exception e) {
      Log.d(TAG, "checkListenerHealth failed: " + e.getMessage());
    }
  }

  private void sendHeartbeat() {
    if (!RegistrationManager.isRegistered(this))
      return;

    new Thread(() -> {
      HttpURLConnection conn = null;
      try {
        String serverUrl =
          RegistrationManager.getServerUrl(this);
        String licenseKey =
          RegistrationManager.getLicenseKey(this);
        String deviceId =
          RegistrationManager.getDeviceId(this);
        String deviceToken =
          RegistrationManager.getDeviceToken(this);

        JSONObject json = new JSONObject();
        json.put("licenseKey", licenseKey);
        json.put("deviceId", deviceId);
        json.put("status", "active");
        // Third status field (alongside the existing online-via-lastSeen
        // check) — lets the trader panel show "online but not capturing"
        // instead of a blanket green dot. See ListenerHealthStore.
        json.put("listenerConnected", ListenerHealthStore.isConnected(this));
        json.put("timestamp",
          TimeFormatter.toUTC(
            System.currentTimeMillis()
          )
        );

        URL url = new URL(
          serverUrl + "/api/apk/heartbeat"
        );
        conn =
          (HttpURLConnection)
          url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty(
          "Content-Type", "application/json");
        // Server now validates deviceId+deviceToken match a real,
        // still-existing device before accepting the heartbeat (see
        // ngo-backend/src/routes/apk.js) — send the token so a 404 here
        // actually means something instead of never being reachable.
        conn.setRequestProperty("devicetoken", deviceToken);
        conn.setDoOutput(true);
        conn.setConnectTimeout(3000);
        conn.setReadTimeout(3000);
        conn.getOutputStream().write(
          json.toString().getBytes("utf-8"));

        int code = conn.getResponseCode();
        if (code == 404) {
          // Server has confirmed — not a flake — this device no longer
          // exists (deleted from the trader panel, or the deviceToken
          // doesn't match). Clear local pairing now rather than waiting
          // for the next app open, and tell whoever's watching this phone
          // instead of quietly going dark with no explanation.
          Log.d(TAG, "Heartbeat rejected (404) — device no longer valid, clearing pairing");
          RegistrationManager.clearRegistration(this);
          showRepairNotification();
        }
        // Any other non-2xx (5xx, network hiccup surfaced as an HTTP
        // error, etc.) is treated as transient, same as before — just
        // retry on the next tick, don't force a re-pair over a flake.

      } catch (Exception e) {
        Log.d(TAG, "Heartbeat failed: "
          + e.getMessage());
      } finally {
        if (conn != null) {
          conn.disconnect();
        }
      }
    }).start();
  }

  private void showRepairNotification() {
    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null) return;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationChannel channel = new NotificationChannel(
              CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_DEFAULT);
      nm.createNotificationChannel(channel);
    }
    Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("⚠ PaymentBot needs re-pairing")
            .setContentText("This device was disconnected from the trader panel. Open the app to pair again.")
            .setSmallIcon(android.R.drawable.stat_notify_error)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build();
    nm.notify(REPAIR_NOTIF_ID, notification);
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
