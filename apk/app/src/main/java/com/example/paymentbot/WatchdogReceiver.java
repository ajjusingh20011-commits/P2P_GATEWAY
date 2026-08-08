package com.example.paymentbot;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

/**
 * Fires on the watchdog alarm scheduled by {@link AlarmHelper}. Restarts the
 * keep-alive foreground service and reschedules the next alarm so the loop
 * survives even if the OS killed the service in between.
 */
public class WatchdogReceiver extends BroadcastReceiver {

    private static final String TAG = "PaymentBot";

    @Override
    public void onReceive(Context context, Intent intent) {
        Log.d(TAG, "Watchdog: restarting services");

        try {
            Intent svc = new Intent(context, KeepAliveService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(svc);
            } else {
                context.startService(svc);
            }
        } catch (Exception e) {
            Log.e(TAG, "Watchdog: failed to start service", e);
        }

        // Overlay investigation, item 1: re-arm the overlay services on every
        // watchdog tick too — they're ordinary, non-foreground services with
        // no restart protection of their own, so the OS can background-kill
        // them independent of KeepAliveService. startService() is a safe
        // no-op if either is already running (only onStartCommand() re-runs,
        // not onCreate()).
        try {
            context.startService(new Intent(context, PaymentOverlayService.class));
            context.startService(new Intent(context, OverlayService.class));
        } catch (Exception e) {
            Log.e(TAG, "Watchdog: failed to start overlay services", e);
        }

        // Reschedule the next watchdog tick.
        AlarmHelper.scheduleWatchdog(context);
    }
}
