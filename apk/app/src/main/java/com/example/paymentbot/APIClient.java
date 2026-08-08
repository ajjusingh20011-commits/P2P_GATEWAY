package com.example.paymentbot;

import android.content.Context;
import android.util.Log;

import org.json.JSONObject;

/**
 * Serialises a {@link PaymentData} to JSON and hands it to {@link EventQueue}
 * for durable, offline-first delivery (item 3).
 *
 * Previously this opened an HttpURLConnection directly (via an AsyncTask) and
 * simply logged+dropped the payment on any failure — a screen capture taken
 * while offline, or during a brief server outage, was lost outright. Now the
 * event is Room-persisted the instant this method returns, regardless of
 * connectivity; EventUploadWorker is what actually delivers it, with retries.
 *
 * Posts to the same POST /api/apk/event endpoint NotificationService uses
 * (the one matchingEngine.checkMatch actually reads) via the real, per-install
 * Config.SERVER_BASE_URL / RegistrationManager override — the previous
 * SERVER_URL constant pointed at a placeholder "your-server.onrender.com"
 * domain under a "/api/payment" path that doesn't exist on this backend at
 * all, so every screen-capture POST was silently failing offline.
 */
public final class APIClient {

    private static final String TAG = "PaymentBot";

    private APIClient() { }

    /** Queues for delivery. Safe to call from any thread. */
    public static void send(Context context, PaymentData data) {
        if (data == null || context == null) {
            return;
        }
        String deviceToken = RegistrationManager.getDeviceToken(context);
        if (deviceToken == null || deviceToken.isEmpty()) {
            Log.w(TAG, "No deviceToken yet — skipping queue for this screen capture");
            return;
        }
        EventQueue.enqueue(context, "/api/apk/event", toJson(data).toString(), true);
    }

    /** Maps a screen-captured PaymentData onto the shared /api/apk/event shape. */
    static JSONObject toJson(PaymentData d) {
        JSONObject o = new JSONObject();
        try {
            o.put("type", "SCREEN");
            o.put("sender", d.getApp());
            o.put("body", d.getRawText());
            o.put("category", "PAYMENT");
            o.put("amount", d.getAmount());
            o.put("utr", d.getUtr());
            o.put("utcTimestamp", TimeFormatter.toUTC(
                    d.getTimestamp() > 0 ? d.getTimestamp() : System.currentTimeMillis()));
        } catch (Exception e) {
            Log.e(TAG, "toJson failed", e);
        }
        return o;
    }
}
