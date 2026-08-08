package com.example.paymentbot;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

/**
 * Restarts the keep-alive service and watchdog alarm after the device reboots
 * so monitoring resumes automatically without the user reopening the app.
 */
public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "PaymentBot";
    private static final String QUICKBOOT_POWERON = "android.intent.action.QUICKBOOT_POWERON";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        if (action == null) return;

        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || QUICKBOOT_POWERON.equals(action)) {
            Log.d(TAG, "Boot: starting services");
            try {
                Intent svc = new Intent(context, KeepAliveService.class);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(svc);
                } else {
                    context.startService(svc);
                }
            } catch (Exception e) {
                Log.e(TAG, "Boot: failed to start service", e);
            }
            // Overlay investigation, item 1: PaymentOverlayService/OverlayService
            // used to only ever start from MainActivity.onCreate() — after a
            // reboot (before the app is reopened) the first payment-app-open
            // would find both not yet created and silently skip the overlay.
            // Re-arm both here too, same as KeepAliveService. Plain
            // startService() (not startForegroundService()): neither service
            // calls startForeground() in onCreate(), and BOOT_COMPLETED
            // receivers get the same background-start exemption this already
            // relies on for KeepAliveService.
            try {
                context.startService(new Intent(context, PaymentOverlayService.class));
                context.startService(new Intent(context, OverlayService.class));
            } catch (Exception e) {
                Log.e(TAG, "Boot: failed to start overlay services", e);
            }
            AlarmHelper.scheduleWatchdog(context);
        }
    }
}
