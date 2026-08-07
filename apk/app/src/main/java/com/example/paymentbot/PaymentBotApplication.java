package com.example.paymentbot;

import android.app.Application;
import android.content.Context;

/**
 * Holds a static, always-available application Context. This app is
 * fundamentally background-service-driven (NotificationService, SMSReceiver,
 * HeartbeatService all run with no UI open most of the time), so anything
 * that needs a Context — like LogStore's on-device persistence — can't rely
 * on MainActivity being alive. A plain static Application Context is the
 * standard, safe way to get one (unlike an Activity Context, it has no
 * lifecycle to leak).
 *
 * Also the install point for process-wide, must-run-before-anything-else
 * pieces of item 3/4's offline-first + crash-reporting work, plus the
 * auto-update daily safety net:
 *   - CrashHandler.install() — as early as possible, so nothing that runs
 *     before this (there's very little, but exception handlers should be
 *     installed first regardless) can crash unrecorded.
 *   - EventUploadWorker.schedulePeriodic() — arms the 15-minute safety-net
 *     delivery job. Idempotent (ExistingPeriodicWorkPolicy.KEEP), so calling
 *     it on every process start is correct, not just harmless.
 *   - UpdateCheckWorker.schedulePeriodic() — arms the once-a-day version
 *     check, same KEEP idempotency. MainActivity additionally fires
 *     UpdateCheckWorker.checkNow() on every app open, so this periodic call
 *     is specifically the safety net for a device that runs for days
 *     without the app ever being opened.
 */
public class PaymentBotApplication extends Application {

    private static Context appContext;

    @Override
    public void onCreate() {
        super.onCreate();
        appContext = getApplicationContext();
        CrashHandler.install(this);
        EventUploadWorker.schedulePeriodic(this);
        UpdateCheckWorker.schedulePeriodic(this);
    }

    /** Never null once the process has started — Application.onCreate() always runs first. */
    static Context get() {
        return appContext;
    }
}
