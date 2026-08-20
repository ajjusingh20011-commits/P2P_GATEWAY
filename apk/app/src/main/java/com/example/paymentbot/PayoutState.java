package com.example.paymentbot;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;

/**
 * FEATURE 2 — Payout evidence capture: local state for the single "active
 * payout" this device may be working on, plus the evidence (recorded input /
 * screenshot / linked debit SMS) captured for it.
 *
 * Detection, capture, packaging, upload ONLY — no matching, scoring, or
 * approve/reject logic here or anywhere in this feature; that is entirely
 * the backend/admin's job.
 *
 * Persisted to the same "paymentbot" SharedPreferences RegistrationManager
 * uses, so it survives process death across the 40-minute window.
 */
public final class PayoutState {

    private static final String TAG = "PaymentBot";
    private static final String PREFS = "paymentbot";

    // Local display/expiry fallback only — the server is the real source of
    // truth for whether the window is still open. Package-visible (not
    // private) so PayoutStateTest can exercise the boundary directly.
    static final long WINDOW_MS = 40 * 60 * 1000L;

    private PayoutState() {
    }

    // ---------------------------------------------------------------------
    // Activation — HeartbeatService, reading the heartbeat response
    // ---------------------------------------------------------------------

    /**
     * Applies the server's current activePayout (or null) to local state.
     * A NEW orderId activates fresh evidence state (discarding any leftover
     * evidence from a previous payout that was never cleared). The SAME
     * orderId repeating is a no-op — don't reset evidence just because the
     * heartbeat re-sent the same descriptor. Empty/null orderId clears.
     */
    public static synchronized void applyServerState(Context ctx, String orderId, String payeeName,
                                                       String accountNumber, String ifsc, String amount) {
        if (orderId == null || orderId.isEmpty()) {
            clear(ctx);
            return;
        }
        if (orderId.equals(prefs(ctx).getString("order_id", ""))) {
            return;
        }
        prefs(ctx).edit()
                .putString("order_id", orderId)
                .putString("payee_name", payeeName == null ? "" : payeeName)
                .putString("account_number", accountNumber == null ? "" : accountNumber)
                .putString("ifsc", ifsc == null ? "" : ifsc)
                .putString("amount", amount == null ? "" : amount)
                .putLong("activated_at", System.currentTimeMillis())
                .remove("recorded_at")
                .remove("screenshot_path")
                .remove("screenshot_at")
                .remove("linked_sms_raw")
                .remove("linked_sms_at")
                .putBoolean("uploaded_initial", false)
                .putBoolean("uploaded_final", false)
                .putBoolean("click_triggered", false)
                .apply();
        Log.d(TAG, "PayoutState activated: " + orderId);
    }

    public static synchronized void clear(Context ctx) {
        String orderId = prefs(ctx).getString("order_id", "");
        if (orderId.isEmpty()) {
            return;
        }
        // Delete any local screenshot file — it must never outlive its payout.
        String path = prefs(ctx).getString("screenshot_path", "");
        if (!path.isEmpty()) {
            try {
                new File(path).delete();
            } catch (Exception ignored) {
            }
        }
        prefs(ctx).edit()
                .remove("order_id").remove("payee_name").remove("account_number")
                .remove("ifsc").remove("amount").remove("activated_at")
                .remove("recorded_at").remove("screenshot_path").remove("screenshot_at")
                .remove("linked_sms_raw").remove("linked_sms_at").remove("extracted_fields")
                .remove("uploaded_initial").remove("uploaded_final").remove("click_triggered")
                .apply();
        Log.d(TAG, "PayoutState cleared: " + orderId);
    }

    // ---------------------------------------------------------------------
    // Phase 1a — the LIST of up to 3 active payouts mirrored from the server
    // (Scenario 10). The device now KNOWS every armed payout, not just one, so
    // a second arm can never overwrite a first. The single working slot above
    // stays the payout evidence is captured against for the common one-payout
    // case; resolving WHICH of several a capture belongs to (by success-screen /
    // debit-SMS content) is Phase 2c and is where per-order evidence lands.
    // ---------------------------------------------------------------------

    /**
     * Apply the server's full activePayouts list. Always stores the list (so
     * Phase 2c can match a capture to the right one). For the single-payout case
     * it activates the working slot exactly as before; with several active it
     * stores the list but does NOT guess a working slot — a wrong guess would
     * capture evidence against the wrong payout.
     */
    public static synchronized void applyServerStateList(Context ctx, org.json.JSONArray list) {
        final int n = (list == null) ? 0 : list.length();
        prefs(ctx).edit().putString("active_payouts_json", n == 0 ? "[]" : list.toString()).apply();

        if (n == 0) {
            clear(ctx);
            return;
        }

        final java.util.Set<String> ids = new java.util.HashSet<>();
        for (int i = 0; i < n; i++) {
            org.json.JSONObject p = list.optJSONObject(i);
            if (p != null) ids.add(p.optString("orderId", ""));
        }

        final String working = orderId(ctx);
        if (!working.isEmpty() && ids.contains(working)) {
            return; // working payout still armed — keep its evidence untouched
        }

        if (n == 1) {
            org.json.JSONObject p = list.optJSONObject(0);
            applyServerState(ctx,
                    p.optString("orderId", ""), p.optString("payeeName", ""),
                    p.optString("accountNumber", ""), p.optString("ifsc", ""),
                    p.optString("amount", ""));
        } else if (!working.isEmpty()) {
            // Several armed and the working payout is no longer among them: clear
            // the working slot (its evidence), keep the list — Phase 2c reselects
            // by content at capture time. clear() leaves active_payouts_json.
            clear(ctx);
        }
    }

    /** The full mirrored list of up to 3 active payouts (descriptors only). */
    public static org.json.JSONArray activePayouts(Context ctx) {
        try {
            return new org.json.JSONArray(prefs(ctx).getString("active_payouts_json", "[]"));
        } catch (Exception e) {
            return new org.json.JSONArray();
        }
    }

    /** Order ids of every currently-armed payout (up to 3). */
    public static java.util.List<String> activeOrderIds(Context ctx) {
        java.util.List<String> out = new java.util.ArrayList<>();
        org.json.JSONArray arr = activePayouts(ctx);
        for (int i = 0; i < arr.length(); i++) {
            org.json.JSONObject p = arr.optJSONObject(i);
            if (p != null) {
                String id = p.optString("orderId", "");
                if (!id.isEmpty()) out.add(id);
            }
        }
        return out;
    }

    /** How many payouts are armed right now (0-3). Drives the overlay indicator. */
    public static int activeCount(Context ctx) {
        return activeOrderIds(ctx).size();
    }

    public static boolean isActive(Context ctx) {
        return !prefs(ctx).getString("order_id", "").isEmpty();
    }

    public static String orderId(Context ctx) {
        return prefs(ctx).getString("order_id", "");
    }

    public static String payeeName(Context ctx) {
        return prefs(ctx).getString("payee_name", "");
    }

    public static String accountNumber(Context ctx) {
        return prefs(ctx).getString("account_number", "");
    }

    public static String ifsc(Context ctx) {
        return prefs(ctx).getString("ifsc", "");
    }

    public static String amount(Context ctx) {
        return prefs(ctx).getString("amount", "");
    }

    /** Local 40-min countdown for UI display only. */
    public static long msRemaining(Context ctx) {
        return computeMsRemaining(prefs(ctx).getLong("activated_at", 0L), System.currentTimeMillis());
    }

    /** Pure — package-visible for PayoutStateTest. */
    static long computeMsRemaining(long activatedAt, long now) {
        if (activatedAt == 0L) return 0L;
        return Math.max(0L, WINDOW_MS - (now - activatedAt));
    }

    public static boolean isExpired(Context ctx) {
        return isActive(ctx) && msRemaining(ctx) <= 0L;
    }

    // ---------------------------------------------------------------------
    // RECORD — PayoutOverlayService
    // ---------------------------------------------------------------------

    /** Trader confirmation tap: snapshots the already-known payout fields +
     *  a timestamp. Not uploaded here — held until the upload trigger. */
    public static synchronized void recordConfirmation(Context ctx) {
        if (!isActive(ctx)) return;
        prefs(ctx).edit().putLong("recorded_at", System.currentTimeMillis()).apply();
    }

    public static boolean isRecorded(Context ctx) {
        return prefs(ctx).getLong("recorded_at", 0L) != 0L;
    }

    // ---------------------------------------------------------------------
    // SCREENSHOT — PayoutOverlayService
    // ---------------------------------------------------------------------

    /**
     * Saves the JPEG bytes to internal storage, overwriting any previous
     * successful screenshot for this payout — only the most recent survives.
     * The caller has already gated this on a matched success keyword; this
     * method does no gating itself.
     */
    public static synchronized boolean saveScreenshot(Context ctx, byte[] jpegBytes) {
        if (!isActive(ctx)) return false;
        File dir = new File(ctx.getFilesDir(), "payout_evidence");
        if (!dir.exists()) dir.mkdirs();
        File file = new File(dir, "screenshot_" + orderId(ctx) + ".jpg");
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(jpegBytes);
        } catch (Exception e) {
            Log.e(TAG, "saveScreenshot error: " + e.getMessage());
            return false;
        }
        prefs(ctx).edit()
                .putString("screenshot_path", file.getAbsolutePath())
                .putLong("screenshot_at", System.currentTimeMillis())
                .apply();
        return true;
    }

    public static String screenshotPath(Context ctx) {
        return prefs(ctx).getString("screenshot_path", "");
    }

    public static boolean hasScreenshot(Context ctx) {
        return !screenshotPath(ctx).isEmpty();
    }

    // ---------------------------------------------------------------------
    // Extracted success-screen fields — captured ONLY at the trader's Capture
    // tap (SuccessScreenParser), saved here alongside the screenshot, uploaded
    // with the evidence bundle. Never populated passively.
    // ---------------------------------------------------------------------
    public static synchronized void saveExtractedFields(Context ctx, String json) {
        if (!isActive(ctx)) return;
        prefs(ctx).edit().putString("extracted_fields", json == null ? "" : json).apply();
    }

    public static String extractedFields(Context ctx) {
        return prefs(ctx).getString("extracted_fields", "");
    }

    // ---------------------------------------------------------------------
    // SMS linking — SMSReceiver
    // ---------------------------------------------------------------------

    /**
     * Holds a DEBIT-classified SMS against the active payout instead of it
     * being pushed as an independent DEBIT event. If the initial bundle
     * already uploaded (trader clicked "I have transferred" before this SMS
     * arrived), fires the follow-up upload immediately.
     */
    public static synchronized void linkDebitSms(Context ctx, String sender, String body, long timestamp) {
        if (!isActive(ctx)) return;
        prefs(ctx).edit()
                .putString("linked_sms_raw", sender + ": " + body)
                .putLong("linked_sms_at", timestamp)
                .apply();
        Log.d(TAG, "PayoutState linked SMS to payout " + orderId(ctx));
        if (prefs(ctx).getBoolean("uploaded_initial", false)
                && !prefs(ctx).getBoolean("uploaded_final", false)) {
            uploadBundle(ctx, "sms_followup");
        }
    }

    // ---------------------------------------------------------------------
    // Upload trigger dedup — PaymentBotService ("I have transferred") and
    // HeartbeatService (window expiry) share this flag so only ONE of them
    // fires the initial upload, whichever happens first.
    // ---------------------------------------------------------------------

    public static boolean isUploadTriggered(Context ctx) {
        return prefs(ctx).getBoolean("click_triggered", false);
    }

    public static synchronized void markUploadTriggered(Context ctx) {
        prefs(ctx).edit().putBoolean("click_triggered", true).apply();
    }

    // ---------------------------------------------------------------------
    // Upload — builds and enqueues the evidence bundle
    // ---------------------------------------------------------------------

    /**
     * Safe to call more than once for the same payout — each call is its
     * own independent upload of whatever exists NOW (EventQueue has no
     * concept of a mutable server-side row to PATCH, so a follow-up is a
     * second, separate POST carrying the same orderId, not an edit of the
     * first — matches the spec's "upload now, follow up later" model).
     */
    public static synchronized void uploadBundle(Context ctx, String reason) {
        if (!isActive(ctx)) return;
        String orderId = orderId(ctx);
        try {
            JSONObject json = new JSONObject();
            // Server resolves traderId from deviceId (same convention every
            // other endpoint in this app uses) — the APK has no local
            // knowledge of its own numeric traderId.
            json.put("deviceId", RegistrationManager.getDeviceId(ctx));
            json.put("orderId", orderId);
            json.put("reason", reason);

            if (isRecorded(ctx)) {
                JSONObject recorded = new JSONObject();
                recorded.put("accountNumber", accountNumber(ctx));
                recorded.put("ifsc", ifsc(ctx));
                recorded.put("amount", amount(ctx));
                json.put("recordedInput", recorded);
                json.put("recordTimestamp", TimeFormatter.toUTC(prefs(ctx).getLong("recorded_at", 0L)));
            }

            if (hasScreenshot(ctx)) {
                byte[] bytes = readFile(screenshotPath(ctx));
                if (bytes != null) {
                    json.put("screenshotBase64", android.util.Base64.encodeToString(bytes, android.util.Base64.DEFAULT));
                    json.put("screenshotTimestamp", TimeFormatter.toUTC(prefs(ctx).getLong("screenshot_at", 0L)));
                }
            }

            // Fields extracted at the Capture tap (tap-only), sent alongside the
            // screenshot so the trader panel / admin queue can show both.
            String extracted = extractedFields(ctx);
            if (!extracted.isEmpty()) {
                try {
                    json.put("extractedFields", new JSONObject(extracted));
                } catch (Exception e) {
                    json.put("extractedFields", extracted);
                }
            }

            String smsRaw = prefs(ctx).getString("linked_sms_raw", "");
            if (!smsRaw.isEmpty()) {
                json.put("linkedSmsRaw", smsRaw);
                json.put("smsTimestamp", TimeFormatter.toUTC(prefs(ctx).getLong("linked_sms_at", 0L)));
            }

            EventQueue.enqueue(ctx, "/api/apk/payout-evidence", json.toString(), false);

            SharedPreferences.Editor editor = prefs(ctx).edit().putBoolean("uploaded_initial", true);
            if (!smsRaw.isEmpty() || "expiry".equals(reason)) {
                editor.putBoolean("uploaded_final", true);
            }
            editor.apply();
            Log.d(TAG, "PayoutState evidence uploaded (" + reason + ") for " + orderId);
        } catch (Exception e) {
            Log.e(TAG, "uploadBundle error: " + e.getMessage());
        }
    }

    private static byte[] readFile(String path) {
        try (FileInputStream in = new FileInputStream(path)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            return out.toByteArray();
        } catch (Exception e) {
            return null;
        }
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
