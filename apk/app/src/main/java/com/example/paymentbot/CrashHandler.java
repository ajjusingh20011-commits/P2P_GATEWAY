package com.example.paymentbot;

import android.content.Context;
import android.os.Build;
import android.util.Log;

import org.json.JSONObject;

import java.io.PrintWriter;
import java.io.StringWriter;

/**
 * Item 4 — crash reporting. Not real Firebase Crashlytics: standing one up
 * requires creating a Firebase project and dropping in a genuine
 * google-services.json, both external/account actions outside what this
 * change can do. This is the honest, fully-working "or equivalent" instead:
 * a global uncaught-exception handler that (a) always chains to the
 * previous default handler so the crash still behaves exactly as before —
 * this must never swallow or suppress a real crash — and (b) durably
 * records the crash both permanently on-device (CrashReport, via the Logs
 * export) and as a best-effort upload through the same offline-first
 * EventQueue/EventUploadWorker pipeline every payment event uses, to a new
 * POST /api/apk/crash endpoint. A field crash on a phone with no signal is
 * still visible to the dev team once it reconnects — not silent either way.
 *
 * See PermissionActivity's javadoc-style comments elsewhere in this app for
 * the project's documentation convention: swapping this for real Crashlytics
 * later just means adding the firebase-crashlytics dependency + a real
 * google-services.json and calling FirebaseCrashlytics.getInstance()
 * .recordException(e) alongside (or instead of) this handler.
 */
final class CrashHandler implements Thread.UncaughtExceptionHandler {

    private static final String TAG = "PaymentBot";

    private final Context appContext;
    private final Thread.UncaughtExceptionHandler defaultHandler;

    private CrashHandler(Context appContext, Thread.UncaughtExceptionHandler defaultHandler) {
        this.appContext = appContext.getApplicationContext();
        this.defaultHandler = defaultHandler;
    }

    /** Call once, as early as possible — see PaymentBotApplication.onCreate(). */
    static void install(Context context) {
        Thread.UncaughtExceptionHandler existing = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler(new CrashHandler(context, existing));
    }

    @Override
    public void uncaughtException(Thread thread, Throwable ex) {
        try {
            recordCrash(ex);
        } catch (Exception loggingFailure) {
            // The absolute last thing this handler may ever do is throw —
            // that would replace the real crash's stack trace with this
            // handler's own failure, making the original cause unrecoverable.
            Log.e(TAG, "CrashHandler itself failed: " + loggingFailure.getMessage());
        }

        // Always chain to the previous handler (the OS default, unless
        // something else installed one first) so the process still dies /
        // shows the normal crash behavior exactly as it would have without
        // this handler — recording a crash must never mask one.
        if (defaultHandler != null) {
            defaultHandler.uncaughtException(thread, ex);
        }
    }

    private void recordCrash(Throwable ex) {
        StringWriter sw = new StringWriter();
        ex.printStackTrace(new PrintWriter(sw));
        String stackTrace = sw.toString();

        String deviceInfo = "manufacturer=" + Build.MANUFACTURER
                + " model=" + Build.MODEL
                + " sdk=" + Build.VERSION.SDK_INT
                + " release=" + Build.VERSION.RELEASE
                + " deviceId=" + RegistrationManager.getDeviceId(appContext);

        // Permanent local record — kept regardless of whether the upload
        // below ever succeeds, and independent of the delivery queue's own
        // retry/expiry rules (crash history should outlive a delivered or
        // given-up-on queue row).
        try {
            AppDatabase.get(appContext).crashReportDao().insert(new CrashReport(stackTrace, deviceInfo));
        } catch (Exception e) {
            Log.e(TAG, "Failed to persist crash report locally: " + e.getMessage());
        }

        // Best-effort upload via the same durable queue every payment event
        // uses — if the device is offline right now, this is still not
        // lost, it just waits for EventUploadWorker's next successful run.
        //
        // Deliberately NOT using EventQueue.enqueue() here: that persists on
        // a background executor thread, which is not guaranteed to finish
        // before the OS kills this process a moment from now (the default
        // handler we chain to next typically terminates the process fairly
        // quickly). The crashing thread is already blocking here regardless
        // — a direct, synchronous DAO insert is the only way to be sure the
        // row actually lands before the process is gone.
        try {
            String deviceToken = RegistrationManager.getDeviceToken(appContext);
            if (deviceToken != null && !deviceToken.isEmpty()) {
                JSONObject json = new JSONObject();
                json.put("stackTrace", stackTrace);
                json.put("deviceInfo", deviceInfo);
                json.put("appVersion", BuildConfig.VERSION_NAME);
                json.put("occurredAt", TimeFormatter.toUTC(System.currentTimeMillis()));
                QueuedEvent event = new QueuedEvent("/api/apk/crash", json.toString(), true);
                AppDatabase.get(appContext).queuedEventDao().insert(event);
                // Still worth trying — if there happens to be enough time
                // before the process dies, this delivers immediately instead
                // of waiting for the next periodic run.
                EventUploadWorker.enqueueImmediate(appContext);
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to queue crash report for upload: " + e.getMessage());
        }
    }
}
