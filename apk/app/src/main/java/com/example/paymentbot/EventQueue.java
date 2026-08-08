package com.example.paymentbot;

import android.content.Context;
import android.util.Log;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Item 3 (offline-first capture pipeline) — the one entry point every
 * capture engine should call instead of opening an HttpURLConnection
 * directly. Persists the event to Room synchronously (on a background
 * thread — Room forbids main-thread writes, and all four capture callbacks
 * — BroadcastReceiver.onReceive, NotificationListenerService callbacks,
 * AccessibilityService callbacks — run on the main thread) and then kicks
 * WorkManager to attempt delivery immediately. If that immediate attempt
 * fails (offline, server down), the row stays queued and the periodic
 * WorkManager job (see EventUploadWorker.schedulePeriodic) retries later —
 * nothing is lost either way.
 */
public final class EventQueue {

    private static final String TAG = "PaymentBot";

    // A single background thread is plenty for local SQLite writes and
    // keeps insert order == capture order without any extra locking.
    private static final ExecutorService WRITER = Executors.newSingleThreadExecutor();

    // Log-storage audit, item 1: bounded retention, same pattern as
    // LogStore — without this, a queue that never gets delivered (server
    // down for days, or the device stays logged out for an extended period —
    // see the registration check below) would otherwise grow unbounded.
    // 5,000 is generous headroom for real undelivered payment events;
    // hitting this cap means delivery has been broken for a very long time.
    private static final int MAX_QUEUED_ROWS = 5000;

    private EventQueue() {
    }

    /**
     * @param endpointPath           path relative to the server base URL, e.g. "/api/apk/event"
     * @param payloadJson            fully-built JSON body, unchanged from what used to be POSTed directly
     * @param needsDeviceTokenHeader true for endpoints that check the "devicetoken" header (event, crash);
     *                               false for endpoints that key off a plain deviceId field in the body
     *                               (debit-sms, outgoing-payment) — matches each route's real auth today.
     */
    public static void enqueue(Context context, String endpointPath, String payloadJson,
                                boolean needsDeviceTokenHeader) {
        if (context == null || endpointPath == null || payloadJson == null) {
            return;
        }
        final Context appCtx = context.getApplicationContext();
        WRITER.execute(() -> {
            // Log-storage/logout audit, item 4: this is the single entry
            // point every capture engine already funnels through
            // (NotificationService, SMSReceiver, PaymentBotService's two
            // paths) — gating here once is what actually stops all of them
            // from continuing to queue events after logout, instead of
            // relying on each engine remembering to check individually.
            // (Two of the four previously didn't: SMSReceiver.queueDebit and
            // PaymentBotService.autoCaptureAndSend build their JSON from the
            // raw Android ID, not the deviceToken RegistrationManager clears
            // on logout, so neither had any registration check at all.)
            if (!RegistrationManager.isRegistered(appCtx)) {
                Log.d(TAG, "EventQueue: device not registered (logged out) — dropping captured event, not queuing");
                return;
            }
            try {
                QueuedEvent event = new QueuedEvent(endpointPath, payloadJson, needsDeviceTokenHeader);
                AppDatabase.get(appCtx).queuedEventDao().insert(event);
                AppDatabase.get(appCtx).queuedEventDao().trimToMostRecent(MAX_QUEUED_ROWS);
            } catch (Exception e) {
                // Room itself failing (disk full, corrupt DB) is the one case
                // this pipeline can't protect against — log it, there is
                // nowhere more durable left to fall back to on-device.
                Log.e(TAG, "EventQueue: failed to persist captured event — DATA LOSS RISK: " + e.getMessage(), e);
            }
            EventUploadWorker.enqueueImmediate(appCtx);
        });
    }
}
