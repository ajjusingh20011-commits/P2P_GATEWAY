package com.example.paymentbot;

import android.content.Context;
import android.util.Log;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Item 5 — persistent record of a message that passed the bank/allowed-app
 * relevance gate (so we're confident it's real, not noise) but that our
 * regexes couldn't extract a usable amount/UTR from. Every capture engine
 * already has an outer try/catch (a genuinely malformed message can't crash
 * the listener), so the gap this closes isn't crash-safety — it's that a
 * silently-empty extraction previously left no reviewable trace anywhere
 * but an ephemeral Logcat line. This is local-only, on purpose: the raw
 * text of an unparsed bank message is exactly the kind of thing that
 * shouldn't leave the device automatically — a developer plugs in the
 * phone and reviews it via the Logs tab's export.
 */
final class ParseFailureLogger {

    private static final String TAG = "PaymentBot";
    private static final ExecutorService WRITER = Executors.newSingleThreadExecutor();

    // Log-storage audit, item 1: same bounded-retention backstop as
    // LogStore.trim()/QueuedEventDao.trimToMostRecent — the 90-day
    // deleteOlderThan cleanup elsewhere doesn't help against a flood of
    // malformed messages arriving faster than 90 days can bound.
    private static final int MAX_ROWS = 5000;

    private ParseFailureLogger() {
    }

    public static void log(Context context, String source, String sender, String rawText, String reason) {
        if (context == null) return;
        final Context appCtx = context.getApplicationContext();
        WRITER.execute(() -> {
            try {
                ParseFailure failure = new ParseFailure(source, sender, rawText, reason);
                AppDatabase.get(appCtx).parseFailureDao().insert(failure);
                AppDatabase.get(appCtx).parseFailureDao().trimToMostRecent(MAX_ROWS);
                Log.w(TAG, "ParseFailure logged [" + source + "] reason=" + reason + " sender=" + sender);
            } catch (Exception e) {
                Log.e(TAG, "ParseFailureLogger failed: " + e.getMessage());
            }
        });
    }
}
