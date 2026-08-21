package com.example.paymentbot;

import android.content.Context;
import android.util.Base64;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * REDESIGN — synchronous capture upload + server match verdict.
 *
 * The device no longer decides which payout a capture belongs to (its local
 * mirror can be stale). It POSTs the tap-extracted fields with NO orderId; the
 * SERVER cross-matches them against the trader's real in_processing payouts and
 * enforces the global receipt lock, then returns the verdict this reads back:
 * matched (which order), ambiguous (tie → review), or Invalid Receipt.
 *
 * Runs on a background thread (the caller is already off the main thread in the
 * screenshot callback).
 */
final class PayoutCaptureClient {
    private static final String TAG = "PaymentBot";

    private PayoutCaptureClient() {
    }

    static final class Verdict {
        boolean ok;         // reached the server and parsed a body
        boolean matched;
        boolean ambiguous;
        String orderId = "";
        String message = "";
        String reason = "";
    }

    static Verdict submit(Context ctx, JSONObject extractedFields, byte[] screenshotJpeg) {
        Verdict v = new Verdict();
        HttpURLConnection conn = null;
        try {
            String serverUrl = RegistrationManager.getServerUrl(ctx);
            JSONObject body = new JSONObject();
            body.put("deviceId", RegistrationManager.getDeviceId(ctx));
            body.put("reason", "capture");
            if (extractedFields != null) body.put("extractedFields", extractedFields);
            if (screenshotJpeg != null) {
                body.put("screenshotBase64", Base64.encodeToString(screenshotJpeg, Base64.DEFAULT));
                body.put("screenshotTimestamp", TimeFormatter.toUTC(System.currentTimeMillis()));
            }

            URL url = new URL(serverUrl + "/api/apk/payout-evidence");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setDoOutput(true);
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.getOutputStream().write(body.toString().getBytes("utf-8"));

            int code = conn.getResponseCode();
            InputStream is = (code >= 200 && code < 300) ? conn.getInputStream() : conn.getErrorStream();
            StringBuilder sb = new StringBuilder();
            if (is != null) {
                BufferedReader br = new BufferedReader(new InputStreamReader(is, "utf-8"));
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
                br.close();
            }
            JSONObject resp = sb.length() > 0 ? new JSONObject(sb.toString()) : new JSONObject();
            v.ok = code >= 200 && code < 300;
            v.matched = resp.optBoolean("matched", false);
            v.ambiguous = resp.optBoolean("ambiguous", false);
            v.orderId = resp.optString("orderId", "");
            v.message = resp.optString("message", "");
            v.reason = resp.optString("reason", "");
            // A 409 (already submitted from another device) is a real rejection,
            // not a transport failure — surface its message rather than "ok".
            if (!v.ok && code == 409) {
                v.matched = false;
                if (v.message.isEmpty()) v.message = "This payout was already submitted from another device";
                v.ok = true;
            }
        } catch (Exception e) {
            Log.e(TAG, "payout capture submit failed: " + e.getMessage());
            v.ok = false;
        } finally {
            if (conn != null) conn.disconnect();
        }
        return v;
    }
}
