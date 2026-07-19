package com.example.paymentbot;

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
 */
public final class APIClient {

    private static final String TAG = "PaymentBot";

    // Backend ingestion endpoint. Change to your deployed server.
    public static final String SERVER_URL = "https://your-server.onrender.com/api/payment";

    private static final int CONNECT_TIMEOUT_MS = 8000;
    private static final int READ_TIMEOUT_MS = 8000;

    private APIClient() { }

    /** Fire-and-forget send. Safe to call from any thread. */
    public static void send(PaymentData data) {
        if (data == null) {
            return;
        }
        new PostTask().execute(data);
    }

    static JSONObject toJson(PaymentData d) {
        JSONObject o = new JSONObject();
        try {
            o.put("app", d.getApp());
            o.put("amount", d.getAmount());
            o.put("sender", d.getSender());
            o.put("utr", d.getUtr());
            o.put("upi_id", d.getUpiId());
            o.put("status", d.getStatus());
            o.put("mode", d.getMode());
            o.put("raw_text", d.getRawText());
            o.put("timestamp", d.getTimestamp());
            o.put("confidence", d.getConfidence());
            o.put("captured_by_sms", d.isCapturedBySMS());
            o.put("captured_by_notification", d.isCapturedByNotification());
            o.put("captured_by_screen", d.isCapturedByScreen());
            o.put("engines", d.enginesLabel());
        } catch (Exception e) {
            Log.e(TAG, "toJson failed", e);
        }
        return o;
    }

    @SuppressWarnings("deprecation")
    private static class PostTask extends AsyncTask<PaymentData, Void, String> {
        @Override
        protected String doInBackground(PaymentData... params) {
            if (params == null || params.length == 0 || params[0] == null) {
                return "no-data";
            }
            PaymentData data = params[0];
            String body = toJson(data).toString();

            HttpURLConnection conn = null;
            try {
                URL url = new URL(SERVER_URL);
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
                conn.setReadTimeout(READ_TIMEOUT_MS);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                conn.setRequestProperty("Accept", "application/json");

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
