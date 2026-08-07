package com.example.paymentbot;

import android.content.Context;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

/**
 * Auto-update step 1: checks GET /api/apk/latest-version and compares it
 * against BuildConfig.VERSION_CODE (the actual installed build — not a
 * stored/cached value, so this is always checking against what's really
 * running). Two triggers, same shape as EventUploadWorker's
 * immediate+periodic pair:
 *   - {@link #checkNow} — fired on every app open (MainActivity.onCreate),
 *     so a device that's opened regularly picks up updates promptly.
 *   - {@link #schedulePeriodic} — a once-a-day safety net for a device that
 *     runs in the background for days without the app being opened at all
 *     (this app is designed to; see PaymentBotApplication's javadoc).
 */
public class UpdateCheckWorker extends Worker {

    private static final String TAG = "PaymentBot";
    private static final String IMMEDIATE_WORK_NAME = "update_check_immediate";
    private static final String PERIODIC_WORK_NAME = "update_check_periodic";

    public UpdateCheckWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    /** Call once (e.g. from the Application class) to arm the daily check. */
    public static void schedulePeriodic(Context context) {
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();

        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                        UpdateCheckWorker.class, 1, TimeUnit.DAYS)
                .setConstraints(constraints)
                .build();

        WorkManager.getInstance(context.getApplicationContext())
                .enqueueUniquePeriodicWork(PERIODIC_WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request);
    }

    /** Call on every app open for a prompt, opportunistic check. */
    public static void checkNow(Context context) {
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();

        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(UpdateCheckWorker.class)
                .setConstraints(constraints)
                .build();

        // KEEP: several app-opens in quick succession (or an open racing the
        // daily periodic tick) don't need to stack up duplicate checks.
        WorkManager.getInstance(context.getApplicationContext())
                .enqueueUniqueWork(IMMEDIATE_WORK_NAME, ExistingWorkPolicy.KEEP, request);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        HttpURLConnection conn = null;
        try {
            String serverUrl = RegistrationManager.getServerUrl(ctx);
            URL url = new URL(serverUrl + "/api/apk/latest-version");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);

            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                Log.d(TAG, "UpdateCheckWorker: HTTP " + code);
                return Result.success();
            }

            StringBuilder sb = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line);
                }
            }

            JSONObject json = new JSONObject(sb.toString());
            int latestVersionCode = json.optInt("versionCode", 0);
            String latestVersionName = json.optString("versionName", "");
            String downloadUrl = json.optString("downloadUrl", "");

            if (latestVersionCode > BuildConfig.VERSION_CODE && !downloadUrl.isEmpty()) {
                Log.i(TAG, "UpdateCheckWorker: newer version available (" + BuildConfig.VERSION_CODE
                        + " -> " + latestVersionCode + ")");
                ApkDownloadWorker.enqueue(ctx, downloadUrl, latestVersionCode, latestVersionName);
            }
        } catch (Exception e) {
            // Best-effort, same as every other periodic/immediate networking
            // path in this app — a failed check just waits for the next
            // trigger (tomorrow's periodic tick, or the next app open).
            Log.d(TAG, "UpdateCheckWorker failed: " + e.getMessage());
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
        return Result.success();
    }
}
