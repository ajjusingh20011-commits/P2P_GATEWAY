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
            AlarmHelper.scheduleWatchdog(context);
        }
    }
}
