package com.example.paymentbot;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * FEATURE 2 (overlay revision) — the trader's own persistent "Payment Mode"
 * toggle. Fully trader-controlled, independent of any server signal: when
 * ON, the payout overlay stays present (subject to its own minimize state)
 * regardless of whether a payout is currently active or which app is
 * foregrounded. See PayoutState for the separate "is a payout active"
 * concern the overlay's buttons additionally check on tap.
 */
public final class PaymentModeState {

    private static final String PREFS = "paymentbot";
    private static final String KEY_ENABLED = "payment_mode_enabled";

    private PaymentModeState() {
    }

    public static boolean isEnabled(Context ctx) {
        return prefs(ctx).getBoolean(KEY_ENABLED, false);
    }

    public static void setEnabled(Context ctx, boolean enabled) {
        prefs(ctx).edit().putBoolean(KEY_ENABLED, enabled).apply();
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
