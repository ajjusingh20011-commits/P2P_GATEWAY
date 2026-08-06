package com.example.paymentbot;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Durable, checkable record of NotificationService's actual bound/connected
 * state — separate from {@link MainActivity#isNotificationListenerEnabled}
 * (which only reflects whether the OS *permission* is granted, not whether
 * the listener is currently bound). On several OEM skins (ColorOS in
 * particular) the OS silently unbinds a notification listener in the
 * background while leaving the permission grant untouched, so the
 * permission-only check stays green even while capture has stopped.
 *
 * {@link NotificationService#onListenerConnected()} /
 * {@link NotificationService#onListenerDisconnected()} write here;
 * {@link HeartbeatService}'s periodic health check reads it to decide
 * whether to request a rebind. A separate SharedPreferences file (not
 * RegistrationManager's "paymentbot" one) so this is purely a runtime
 * health signal, never touched by clearRegistration()/register().
 */
final class ListenerHealthStore {

    private static final String PREFS = "listener_health";
    private static final String KEY_CONNECTED = "connected";
    private static final String KEY_LAST_CHANGE_AT = "last_change_at";
    private static final String KEY_LAST_REBIND_ATTEMPT_AT = "last_rebind_attempt_at";

    static void setConnected(Context ctx, boolean connected) {
        prefs(ctx).edit()
                .putBoolean(KEY_CONNECTED, connected)
                .putLong(KEY_LAST_CHANGE_AT, System.currentTimeMillis())
                .apply();
    }

    /**
     * Defaults to true (not false) when never reported: on first app start
     * onListenerConnected() typically fires within a second or two of the
     * service binding, but the health check on HeartbeatService's 4s tick
     * could plausibly run before that first callback lands. Assuming
     * "disconnected" in that narrow window would trigger a spurious
     * requestRebind() on an app that was never actually broken.
     */
    static boolean isConnected(Context ctx) {
        return prefs(ctx).getBoolean(KEY_CONNECTED, true);
    }

    static long lastChangeAt(Context ctx) {
        return prefs(ctx).getLong(KEY_LAST_CHANGE_AT, 0L);
    }

    static long lastRebindAttemptAt(Context ctx) {
        return prefs(ctx).getLong(KEY_LAST_REBIND_ATTEMPT_AT, 0L);
    }

    static void markRebindAttempt(Context ctx) {
        prefs(ctx).edit().putLong(KEY_LAST_REBIND_ATTEMPT_AT, System.currentTimeMillis()).apply();
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private ListenerHealthStore() {
    }
}
