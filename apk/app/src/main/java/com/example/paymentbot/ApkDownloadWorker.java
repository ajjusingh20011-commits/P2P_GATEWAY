package com.example.paymentbot;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.content.FileProvider;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Auto-update step 2: downloads a newer APK in the background, triggered by
 * UpdateCheckWorker once it finds versionCode > BuildConfig.VERSION_CODE.
 *
 * Deliberately its own Worker rather than routed through EventQueue/
 * EventUploadWorker (item 3's offline-delivery pipeline) — that pipeline is
 * built around small JSON rows persisted to Room and retried indefinitely;
 * an APK download is a single multi-MB binary transfer with no sensible
 * "queue a row per byte" analog. What IS reused, per the actual ask, is the
 * WorkManager pattern itself: NetworkType.CONNECTED constraint, a unique
 * work name so repeated triggers don't stack duplicate downloads, and
 * survival across process death/reboot — same shape as EventUploadWorker,
 * just a plain one-shot job instead of a Room-backed retry loop.
 */
public class ApkDownloadWorker extends Worker {

    private static final String TAG = "PaymentBot";
    private static final String WORK_NAME = "apk_download";
    private static final String CHANNEL_ID = "PaymentBotUpdates";
    private static final int NOTIF_ID = 1003;

    private static final String KEY_DOWNLOAD_URL = "downloadUrl";
    private static final String KEY_VERSION_CODE = "versionCode";
    private static final String KEY_VERSION_NAME = "versionName";

    public ApkDownloadWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    /** Call once UpdateCheckWorker has confirmed a newer version is available. */
    public static void enqueue(Context context, String downloadUrl, int versionCode, String versionName) {
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();

        Data input = new Data.Builder()
                .putString(KEY_DOWNLOAD_URL, downloadUrl)
                .putInt(KEY_VERSION_CODE, versionCode)
                .putString(KEY_VERSION_NAME, versionName)
                .build();

        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(ApkDownloadWorker.class)
                .setConstraints(constraints)
                .setInputData(input)
                .build();

        // KEEP, not REPLACE: the daily check + every app-open check can both
        // fire for the same available version before the user ever taps
        // install — no need to restart an in-flight (or already-finished,
        // see the already-downloaded short-circuit below) download for it.
        WorkManager.getInstance(context.getApplicationContext())
                .enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.KEEP, request);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        String downloadUrl = getInputData().getString(KEY_DOWNLOAD_URL);
        int versionCode = getInputData().getInt(KEY_VERSION_CODE, 0);
        String versionName = getInputData().getString(KEY_VERSION_NAME);
        if (downloadUrl == null || downloadUrl.isEmpty() || versionCode <= 0) {
            Log.e(TAG, "ApkDownloadWorker: missing input data");
            return Result.failure();
        }

        // Already downloaded and still on disk — re-show the notification
        // (the user may have dismissed it without installing) instead of
        // re-downloading multiple megabytes for nothing.
        if (UpdateStore.getDownloadedVersionCode(ctx) == versionCode) {
            File existing = new File(UpdateStore.getDownloadedFilePath(ctx));
            if (existing.exists() && existing.length() > 0) {
                showInstallNotification(ctx, existing, versionName);
                return Result.success();
            }
        }

        File updatesDir = new File(ctx.getFilesDir(), "updates");
        if (!updatesDir.exists() && !updatesDir.mkdirs()) {
            Log.e(TAG, "ApkDownloadWorker: could not create updates dir");
            return Result.retry();
        }

        File target = new File(updatesDir, "maxpay-update-" + versionCode + ".apk");
        // Download to a temp file first — a download interrupted mid-write
        // (killed process, connection drop) must never leave a partial file
        // sitting at the real target name where a later run's exists()/
        // length()>0 short-circuit above would treat it as a good, complete
        // download.
        File temp = new File(updatesDir, target.getName() + ".part");

        HttpURLConnection conn = null;
        try {
            URL url = new URL(downloadUrl);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            conn.setRequestMethod("GET");

            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                Log.w(TAG, "ApkDownloadWorker: HTTP " + code + " downloading update");
                return Result.retry();
            }

            try (InputStream in = conn.getInputStream();
                 OutputStream out = new FileOutputStream(temp)) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                }
            }

            if (temp.length() == 0) {
                temp.delete();
                Log.w(TAG, "ApkDownloadWorker: downloaded file was empty");
                return Result.retry();
            }

            // Drop any previously-downloaded (older) update file before
            // committing this one — nothing else reads the updates/
            // directory, so there's no reason to let it accumulate.
            File[] stale = updatesDir.listFiles((dir, name) -> name.endsWith(".apk") && !name.equals(target.getName()));
            if (stale != null) {
                for (File f : stale) {
                    f.delete();
                }
            }

            if (!temp.renameTo(target)) {
                Log.e(TAG, "ApkDownloadWorker: failed to finalize downloaded file");
                temp.delete();
                return Result.retry();
            }

            UpdateStore.setDownloaded(ctx, versionCode, target.getAbsolutePath());
            Log.i(TAG, "ApkDownloadWorker: downloaded version " + versionName + " (" + versionCode + ")");
            showInstallNotification(ctx, target, versionName);
            return Result.success();
        } catch (Exception e) {
            Log.e(TAG, "ApkDownloadWorker: download failed: " + e.getMessage());
            temp.delete();
            return Result.retry();
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    /**
     * Single, clear notification — "Update available, tap to install".
     * Tapping it launches Android's standard package installer via
     * ACTION_VIEW on a FileProvider content:// Uri (internal storage isn't
     * directly readable by the installer process). This is exactly the
     * non-silent path: the installer's own UI still requires the user to
     * tap "Install" there — REQUEST_INSTALL_PACKAGES only allows this app
     * to launch that UI at all, it does not skip it.
     */
    private void showInstallNotification(Context ctx, File apkFile, String versionName) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "App updates", NotificationManager.IMPORTANCE_DEFAULT);
            nm.createNotificationChannel(channel);
        }

        Uri apkUri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apkFile);
        Intent installIntent = new Intent(Intent.ACTION_VIEW);
        installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);

        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pendingIntent = PendingIntent.getActivity(ctx, 0, installIntent, piFlags);

        Notification notification = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setContentTitle("Update available")
                .setContentText("MaxPay " + (versionName == null ? "" : versionName) + " is ready — tap to install")
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .build();

        nm.notify(NOTIF_ID, notification);
    }
}
