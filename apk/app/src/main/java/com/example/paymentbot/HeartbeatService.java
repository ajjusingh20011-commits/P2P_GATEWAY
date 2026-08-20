package com.example.paymentbot;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.service.notification.NotificationListenerService;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

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

  // Item 2 (this pass): SMS permission has no rebind equivalent — a runtime
  // permission revocation (manual, or Android's unused-app auto-reset after
  // ~3 months of no app open on API 30+) can only be fixed by the user
  // re-granting it, Android won't let an app silently re-request a dangerous
  // permission. So this just needs to (a) not spam a notification every 4s
  // and (b) actually detect the revocation at all, which nothing did before.
  private static final long SMS_PERMISSION_CHECK_INTERVAL_MS = 60000;
  private static final int SMS_REPAIR_NOTIF_ID = 1003;
  private long lastSmsPermissionCheckAt = 0L;

  @Override
  public void onCreate() {
    super.onCreate();
    handler = new Handler(Looper.getMainLooper());
    heartbeatRunnable = new Runnable() {
      @Override
      public void run() {
        sendHeartbeat();
        checkListenerHealth();
        checkSmsPermissionHealth();
        checkPayoutExpiry();
        handler.postDelayed(this, INTERVAL);
      }
    };
    handler.post(heartbeatRunnable);
    Log.d(TAG, "HeartbeatService started");
  }

  /**
   * Item 2 — SMS permission auto-reset detection. Unlike the notification
   * listener (which the OS can rebind on request), a revoked dangerous
   * permission has no programmatic fix — READ_SMS/RECEIVE_SMS can only be
   * re-granted by the user via a real permission dialog or Settings. This
   * detects the revocation (previously nothing did — SMSReceiver would just
   * silently stop being invoked by the OS with zero indication anywhere)
   * and raises a persistent notification prompting the user to re-open the
   * app and re-grant, instead of the device going dark with no explanation.
   */
  private void checkSmsPermissionHealth() {
    long now = System.currentTimeMillis();
    if (now - lastSmsPermissionCheckAt < SMS_PERMISSION_CHECK_INTERVAL_MS) {
      return;
    }
    lastSmsPermissionCheckAt = now;
    try {
      boolean hasReceive = ContextCompat.checkSelfPermission(this, Manifest.permission.RECEIVE_SMS)
              == PackageManager.PERMISSION_GRANTED;
      boolean hasRead = ContextCompat.checkSelfPermission(this, Manifest.permission.READ_SMS)
              == PackageManager.PERMISSION_GRANTED;
      if (hasReceive && hasRead) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
          nm.cancel(SMS_REPAIR_NOTIF_ID);
        }
        return;
      }
      Log.w(TAG, "SMS permission missing (receive=" + hasReceive + " read=" + hasRead
              + ") — was granted at some point since this is a registered device; likely revoked "
              + "manually or by Android's unused-app auto-reset");
      showSmsPermissionNotification();
    } catch (Exception e) {
      Log.d(TAG, "checkSmsPermissionHealth failed: " + e.getMessage());
    }
  }

  private void showSmsPermissionNotification() {
    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null) return;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationChannel channel = new NotificationChannel(
              CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_DEFAULT);
      nm.createNotificationChannel(channel);
    }
    Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("⚠ SMS permission needed")
            .setContentText("MaxPay can no longer read bank SMS. Open the app to re-grant permission.")
            .setSmallIcon(android.R.drawable.stat_notify_error)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build();
    nm.notify(SMS_REPAIR_NOTIF_ID, notification);
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

  /**
   * FEATURE 2 — local 40-min-window fallback: if the trader never clicked
   * "I have transferred" (PaymentBotService's detector) and the window
   * closes, upload whatever evidence exists as a partial bundle rather than
   * holding it hostage to a click that never came. Runs on the same 4s tick
   * as the rest of this service's health checks — no new scheduling
   * machinery needed. Shares click_triggered with PaymentBotService's click
   * detector so only whichever fires first wins.
   */
  private void checkPayoutExpiry() {
    if (PayoutState.isExpired(this) && !PayoutState.isUploadTriggered(this)) {
      PayoutState.markUploadTriggered(this);
      PayoutState.uploadBundle(this, "expiry");
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
        // Feature 2 — APK Device Verification. Distinct from listenerConnected
        // above: this is "was notification access ever granted at all",
        // already computed on-device for checkListenerHealth()'s own rebind
        // decision (line ~133) but never previously sent to the server, so
        // "never granted" and "granted, then silently unbound" were
        // indistinguishable server-side.
        json.put("notificationAccessGranted", MainActivity.isNotificationListenerEnabled(this));
        // BUG-53 — report the REAL installed build (BuildConfig, set by Gradle's
        // versionName) on every heartbeat, so a device updated in place (no
        // re-registration) refreshes its version server-side instead of keeping
        // the stale value it registered with.
        json.put("appVersion", BuildConfig.VERSION_NAME);
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
        } else if (code >= 200 && code < 300) {
          // FEATURE 2 — read the activePayout descriptor the server may now
          // send back (previously this response body was never read at
          // all). Absent/null clears any locally-active payout. A
          // parse/read failure here — older server predating this field, or
          // a transient hiccup — must never touch local pairing or the
          // payout state, so it's swallowed rather than propagated.
          try {
            java.io.InputStream in = conn.getInputStream();
            java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
            byte[] chunk = new byte[1024];
            int n;
            while ((n = in.read(chunk)) != -1) {
              buf.write(chunk, 0, n);
            }
            JSONObject resp = new JSONObject(buf.toString("utf-8"));
            // Phase 1a — the server mirrors a LIST of up to 3 active payouts.
            org.json.JSONArray payouts = resp.optJSONArray("activePayouts");
            if (payouts == null && !resp.isNull("activePayout")) {
              // Old server sending a single descriptor — wrap it as a 1-element
              // list so the device path is uniform.
              JSONObject one = resp.optJSONObject("activePayout");
              payouts = new org.json.JSONArray();
              if (one != null) payouts.put(one);
            }
            PayoutState.applyServerStateList(this, payouts == null ? new org.json.JSONArray() : payouts);
          } catch (Exception e) {
            Log.d(TAG, "Heartbeat response parse skipped: " + e.getMessage());
          }
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
