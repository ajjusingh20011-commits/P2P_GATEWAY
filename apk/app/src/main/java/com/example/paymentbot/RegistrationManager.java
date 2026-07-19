package com.example.paymentbot;

import android.content.Context;
import android.provider.Settings;

/**
 * Lightweight accessor for the device's server config + identity, used by the
 * networking paths. Values are read from the "paymentbot" SharedPreferences,
 * falling back to {@link Config} / the Android id when unset.
 */
public final class RegistrationManager {

    private static final String PREFS = "paymentbot";

    /** Server base URL — a stored override, else {@link Config#SERVER_BASE_URL}. */
    public static String getServerUrl(Context ctx) {
        String url = prefs(ctx).getString("server_url", "");
        return (url == null || url.isEmpty()) ? Config.SERVER_BASE_URL : url;
    }

    /** Optional license key (empty when the device isn't license-registered). */
    public static String getLicenseKey(Context ctx) {
        String key = prefs(ctx).getString("license_key", "");
        return key == null ? "" : key;
    }

    /** Human-assigned device name set during the pairing flow. */
    public static String getDeviceName(Context ctx) {
        String name = prefs(ctx).getString("device_name", "");
        return name == null ? "" : name;
    }

    /** True once a license key has been claimed via /register-device. */
    public static boolean isRegistered(Context ctx) {
        return !getLicenseKey(ctx).isEmpty();
    }

    /**
     * Persists the pairing result: the claimed license key, a device name
     * (initially the hardware model, later overwritten with the trader's
     * chosen name), and — if supplied — a server URL override.
     */
    public static void register(Context ctx, String licenseKey, String deviceName, String serverUrl) {
        android.content.SharedPreferences.Editor editor = prefs(ctx).edit();
        editor.putString("license_key", licenseKey == null ? "" : licenseKey);
        editor.putString("device_name", deviceName == null ? "" : deviceName);
        if (serverUrl != null && !serverUrl.isEmpty()) {
            editor.putString("server_url", serverUrl);
        }
        editor.apply();
    }

    /** Stable device id (Android id). */
    @SuppressWarnings("HardwareIds")
    public static String getDeviceId(Context ctx) {
        String id = Settings.Secure.getString(
                ctx.getContentResolver(), Settings.Secure.ANDROID_ID);
        return id == null ? "" : id;
    }

    private static android.content.SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private RegistrationManager() {
    }
}
