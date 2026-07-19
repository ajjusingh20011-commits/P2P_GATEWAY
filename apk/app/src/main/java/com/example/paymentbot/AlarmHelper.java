package com.example.paymentbot;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;

/**
 * Schedules a repeating exact alarm that fires every ~15 minutes to restart the
 * bot's services. On MIUI and other aggressive OEM skins the foreground service
 * can still be killed; this alarm is the watchdog that brings it back.
 */
public class AlarmHelper {

    public static final String ACTION_WATCHDOG = "com.example.paymentbot.WATCHDOG";
    private static final long INTERVAL_MS = 15 * 60 * 1000L;

    public static void scheduleWatchdog(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        Intent i = new Intent(context, WatchdogReceiver.class);
        i.setAction(ACTION_WATCHDOG);
        PendingIntent pi = PendingIntent.getBroadcast(context, 0, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        long triggerAt = SystemClock.elapsedRealtime() + INTERVAL_MS;
        am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi);
    }
}
