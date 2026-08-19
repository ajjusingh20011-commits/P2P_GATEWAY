package com.example.paymentbot;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.ForegroundInfo;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.OutOfQuotaPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Item 3 (offline-first pipeline) — drains {@link QueuedEvent} rows to the
 * server. Two triggers keep delivery both fast and durable:
 *   - {@link #enqueueImmediate} — fired right after every capture, so on a
 *     connected device delivery is effectively instant, same as before.
 *   - {@link #schedulePeriodic} — a 15-minute safety net (WorkManager's
 *     minimum periodic interval) that catches anything still queued because
 *     the device was offline, the app was killed, or the immediate attempt
 *     itself failed — runs even if the app is never reopened, because
 *     WorkManager's own queue survives process death and reboot
 *     independently of this app's process.
 *
 * Both are constrained to NetworkType.CONNECTED — the OS won't even start
 * this worker without connectivity, so there's no busy-polling while offline.
 */
public class EventUploadWorker extends Worker {

    private static final String TAG = "PaymentBot";
    private static final String IMMEDIATE_WORK_NAME = "event_upload_immediate";
    private static final String PERIODIC_WORK_NAME = "event_upload_periodic";

    // Separate, minimum-importance channel for the expedited-work notification
    // the OS requires below API 31 — deliberately not KeepAliveService's
    // channel, so this transient entry can't be mistaken for the app having
    // stopped monitoring.
    private static final String UPLOAD_CHANNEL_ID = "PaymentBotUpload";
    private static final int UPLOAD_NOTIF_ID = 1002;

    // Above this many failed attempts on a single row, stop retrying it —
    // otherwise one truly-undeliverable row (e.g. a permanently revoked
    // pairing) would sit in the queue forever, quietly consuming every
    // future worker run's time. At the 15-min periodic floor this is ~12.5
    // hours of retrying before giving up, which comfortably covers a phone
    // being offline overnight.
    private static final int MAX_ATTEMPTS = 50;

    private static final long RETENTION_MS = TimeUnit.DAYS.toMillis(30);

    public EventUploadWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    /** Call once (e.g. from the Application class) to arm the safety-net job. */
    public static void schedulePeriodic(Context context) {
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();

        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                        EventUploadWorker.class, 15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.LINEAR, 15, TimeUnit.MINUTES)
                .build();

        WorkManager.getInstance(context.getApplicationContext())
                .enqueueUniquePeriodicWork(PERIODIC_WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request);
    }

    /** Call right after queuing a new event for a fast-path delivery attempt. */
    public static void enqueueImmediate(Context context) {
        Constraints constraints = new Constraints.Builder()
                // Kept deliberately: this is not a delay when the device is
                // online, it only stops a pointless run (and a wasted attempt
                // against MAX_ATTEMPTS) while it has no network at all.
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();

        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(EventUploadWorker.class)
                .setConstraints(constraints)
                // Ask the OS to run this now rather than at its own
                // convenience. Without it a capture made while the device is
                // idle waits for a normal job window, which is the one thing
                // this pipeline must never do. RUN_AS_NON_EXPEDITED_WORK_REQUEST
                // means an exhausted expedited quota degrades to a normal run
                // instead of failing the upload outright.
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                // 10s is WorkManager's floor. Only applies after a failed
                // attempt, never to the first one.
                .setBackoffCriteria(BackoffPolicy.LINEAR, 10, TimeUnit.SECONDS)
                .build();

        // APPEND_OR_REPLACE, not REPLACE.
        //
        // REPLACE cancels a run that is already in flight. Under a burst — and
        // a payment app updating one notification repeatedly IS a burst — each
        // new capture cancelled the upload of the previous one, so the drain
        // could be restarted indefinitely and events sat in the queue while
        // the phone looked busy. APPEND_OR_REPLACE instead chains a fresh
        // drain after the current one finishes, which both leaves the in-
        // flight upload alone and guarantees a pass that sees the row just
        // written (a run that already called getAll() cannot). _OR_REPLACE so
        // a previously cancelled or failed chain doesn't block new work.
        WorkManager.getInstance(context.getApplicationContext())
                .enqueueUniqueWork(IMMEDIATE_WORK_NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request);
    }

    /**
     * Required for {@link #setExpedited}: below API 31 the OS runs expedited
     * work as a short-lived foreground service and asks for the notification
     * to show. Reuses KeepAliveService's existing channel so this adds no new
     * channel and no second visible entry on devices that already show it.
     */
    @NonNull
    @Override
    public ForegroundInfo getForegroundInfo() {
        Context ctx = getApplicationContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    UPLOAD_CHANNEL_ID, UPLOAD_CHANNEL_ID, NotificationManager.IMPORTANCE_MIN);
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
        Notification notification = new NotificationCompat.Builder(ctx, UPLOAD_CHANNEL_ID)
                .setContentTitle("PaymentBot")
                .setContentText("Sending captured payment")
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setOngoing(true)
                .build();
        return new ForegroundInfo(UPLOAD_NOTIF_ID, notification);
    }

    private enum Outcome { SUCCESS, TRANSIENT_FAILURE, PERMANENT_FAILURE }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();

        // Log-storage/logout audit, item 4: the authoritative delivery-side
        // halt. EventQueue.enqueue() already stops *new* events from being
        // queued while logged out, but that alone doesn't cover rows queued
        // in the narrow window right around a logout tap (enqueue() runs on
        // its own background thread; RegistrationManager.clearRegistration()
        // runs synchronously on the UI thread — the two can interleave), nor
        // any row that happened to still be sitting in the table. Checking
        // here too means logout halts delivery unconditionally: queued rows
        // are simply left parked, untouched, until the device is paired
        // again, exactly like being offline.
        if (!RegistrationManager.isRegistered(ctx)) {
            Log.d(TAG, "EventUploadWorker: device not registered (logged out) — skipping this run, queue left untouched");
            return Result.success();
        }

        QueuedEventDao dao;
        List<QueuedEvent> pending;
        try {
            dao = AppDatabase.get(ctx).queuedEventDao();
            pending = dao.getAll();
        } catch (Exception e) {
            Log.e(TAG, "EventUploadWorker: DB unavailable, will retry: " + e.getMessage());
            return Result.retry();
        }

        if (pending.isEmpty()) {
            return Result.success();
        }

        String serverUrl = RegistrationManager.getServerUrl(ctx);
        // Re-read fresh each run (not per-row) — a re-registration between
        // attempts should immediately benefit every still-queued row.
        String deviceToken = RegistrationManager.getDeviceToken(ctx);

        int delivered = 0;
        int stillQueued = 0;
        int dropped = 0;

        for (QueuedEvent event : pending) {
            Outcome outcome = attempt(serverUrl, deviceToken, event);
            switch (outcome) {
                case SUCCESS:
                    dao.delete(event);
                    delivered++;
                    break;
                case PERMANENT_FAILURE:
                    Log.w(TAG, "EventUploadWorker: dropping undeliverable event id=" + event.id
                            + " endpoint=" + event.endpointPath + " reason=" + event.lastError);
                    dao.delete(event);
                    dropped++;
                    break;
                case TRANSIENT_FAILURE:
                default:
                    event.attempts += 1;
                    if (event.attempts >= MAX_ATTEMPTS) {
                        Log.w(TAG, "EventUploadWorker: giving up after " + event.attempts
                                + " attempts on event id=" + event.id + " endpoint=" + event.endpointPath
                                + " lastError=" + event.lastError);
                        dao.delete(event);
                        dropped++;
                    } else {
                        dao.update(event);
                        stillQueued++;
                    }
                    break;
            }
        }

        try {
            dao.deleteOlderThan(System.currentTimeMillis() - RETENTION_MS);
        } catch (Exception ignored) {
        }

        Log.d(TAG, "EventUploadWorker: delivered=" + delivered + " stillQueued=" + stillQueued
                + " dropped=" + dropped);

        // Always success from WorkManager's point of view: per-row retry
        // state already lives in the DB (attempts/lastError), and the
        // periodic job + the next immediate trigger are what drive the next
        // pass — returning Result.retry() here would additionally stack
        // WorkManager's own exponential backoff on top of that, which just
        // delays picking up a brand-new capture that arrives in the
        // meantime for no benefit.
        return Result.success();
    }

    private Outcome attempt(String serverUrl, String deviceToken, QueuedEvent event) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(serverUrl + event.endpointPath);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            if (event.needsDeviceTokenHeader && deviceToken != null && !deviceToken.isEmpty()) {
                conn.setRequestProperty("devicetoken", deviceToken);
            }
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            conn.setDoOutput(true);

            byte[] body = event.payloadJson.getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body);
            }

            int code = conn.getResponseCode();
            if (code >= 200 && code < 300) {
                return Outcome.SUCCESS;
            }
            event.lastError = "HTTP " + code;
            // 400 = malformed payload — a genuine client-side bug, not
            // something a retry with the same bytes will ever fix.
            // Payout-evidence specifically: 403 (device was never armed for
            // this order) and 409 (another device already won the
            // first-submission-wins lock) are ALSO permanent for this exact
            // queued row — retrying the same payload can never turn either
            // into a success. Surface the 409 to the overlay, if it's
            // running, so the trader sees why instead of silent retries.
            if ("/api/apk/payout-evidence".equals(event.endpointPath) && (code == 403 || code == 409)) {
                if (code == 409) {
                    PayoutOverlayService svc = PayoutOverlayService.getInstance();
                    if (svc != null) {
                        svc.postFeedback(PayoutOverlayService.MSG_ALREADY_SUBMITTED_ELSEWHERE, false);
                    }
                }
                return Outcome.PERMANENT_FAILURE;
            }
            // Everything else (401/404/5xx) is left transient: a 401 can
            // resolve itself if the device re-registers before the next
            // attempt, and the rest are plausibly transient server states.
            return (code == 400) ? Outcome.PERMANENT_FAILURE : Outcome.TRANSIENT_FAILURE;
        } catch (Exception e) {
            event.lastError = e.getClass().getSimpleName() + ": " + e.getMessage();
            return Outcome.TRANSIENT_FAILURE;
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }
}
