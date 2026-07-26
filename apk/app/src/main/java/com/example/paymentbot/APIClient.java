package com.example.paymentbot;

import android.content.Context;
import android.os.AsyncTask;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Minimal HTTP client. Serialises a {@link PaymentData} to JSON and POSTs it to
 * the backend on a background thread (AsyncTask).
 *
 * The client is deliberately fault-tolerant: if the server is offline or the
 * request fails, it logs the failure locally and returns — it never crashes the
 * app or blocks an engine.
 *
 * Posts to the same POST /api/apk/event endpoint NotificationService uses (the
 * one matchingEngine.checkMatch actually reads) via the real, per-install
 * Config.SERVER_BASE_URL / RegistrationManager override — the previous
 * SERVER_URL constant pointed at a placeholder "your-server.onrender.com"
 * domain under a "/api/payment" path that doesn't exist on this backend at
 * all, so every screen-capture POST was silently failing offline.
 */
public final class APIClient {

    private static final String TAG = "PaymentBot";

    private static final int CONNECT_TIMEOUT_MS = 8000;
    private static final int READ_TIMEOUT_MS = 8000;

    private APIClient() { }

    /** Fire-and-forget send. Safe to call from any thread. */
    public static void send(Context context, PaymentData data) {
        if (data == null || context == null) {
            return;
        }
        String serverUrl = RegistrationManager.getServerUrl(context);
        String deviceToken = RegistrationManager.getDeviceToken(context);
        new PostTask(serverUrl, deviceToken).execute(data);
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

    @SuppressWarnings("deprecation")
    private static class PostTask extends AsyncTask<PaymentData, Void, String> {
        private final String serverUrl;
        private final String deviceToken;

        PostTask(String serverUrl, String deviceToken) {
            this.serverUrl = serverUrl;
            this.deviceToken = deviceToken;
        }

        @Override
        protected String doInBackground(PaymentData... params) {
            if (params == null || params.length == 0 || params[0] == null) {
                return "no-data";
            }
            if (deviceToken == null || deviceToken.isEmpty()) {
                Log.w(TAG, "No deviceToken yet — skipping server post");
                return "no-token";
            }
            PaymentData data = params[0];
            String body = toJson(data).toString();

            HttpURLConnection conn = null;
            try {
                URL url = new URL(serverUrl + "/api/apk/event");
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
                conn.setReadTimeout(READ_TIMEOUT_MS);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                conn.setRequestProperty("Accept", "application/json");
                conn.setRequestProperty("devicetoken", deviceToken);

                byte[] payload = body.getBytes(StandardCharsets.UTF_8);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(payload);
                }

                int code = conn.getResponseCode();
                if (code >= 200 && code < 300) {
                    Log.d(TAG, "POST ok (" + code + ") amount=" + data.getAmount());
                    return "ok:" + code;
                } else {
                    // Drain error stream so the connection can be reused/closed cleanly.
                    readAndClose(conn.getErrorStream());
                    Log.w(TAG, "POST rejected (" + code + ")");
                    return "http:" + code;
                }
            } catch (Exception e) {
                // Server offline / no network — fail silently, keep local log.
                Log.w(TAG, "POST failed (offline?): " + e.getMessage());
                return "offline:" + e.getMessage();
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        }

        @Override
        protected void onPostExecute(String result) {
            if (result == null) {
                return;
            }
            if (result.startsWith("ok:")) {
                MainActivity.addLog("✓ Sent to server (" + result.substring(3) + ")");
            } else if (result.startsWith("http:")) {
                MainActivity.addLog("⚠ Server error " + result.substring(5) + " (kept locally)");
            } else if (result.startsWith("offline:")) {
                MainActivity.addLog("⚠ Server offline — payment kept locally");
            }
        }
    }

    private static void readAndClose(java.io.InputStream in) {
        if (in == null) return;
        try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            while (r.readLine() != null) { /* drain */ }
        } catch (Exception ignored) {
        }
    }
}
