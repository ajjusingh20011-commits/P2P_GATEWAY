package com.example.paymentbot;

import android.content.Context;
import android.util.Log;

import java.io.File;
import java.io.FileWriter;

/**
 * Append-only local log of SMS sender IDs the bank-capture gate REJECTED, kept
 * solely so the DLT bank-fragment list (BankSenderTags.BANK_NAME_FRAGMENTS) can
 * be tuned from real traffic.
 *
 * Records ONLY the sender ID, the extracted DLT entity code, the rejection
 * reason and a timestamp — NEVER the message body or any content. A rejected
 * SMS is, by definition, one we decided not to trust or process; persisting its
 * content would defeat the point of rejecting it. There is intentionally no
 * body/content field here and no caller passes one.
 *
 * Written on a background thread (a broadcast callback must not block) to a
 * single capped TSV file in app-internal storage.
 */
final class RejectedSmsLog {

    private static final String TAG = "PaymentBot";
    private static final String FILE_NAME = "rejected_sms_log.tsv";
    // Cap the review file so it can never grow unbounded — this is a tuning aid,
    // not a system of record. Oldest entries are dropped by starting over.
    private static final long MAX_BYTES = 256 * 1024;

    private RejectedSmsLog() {
    }

    /**
     * Append one rejection record: timestamp, sender ID, extracted DLT code,
     * reason. No message body — ever.
     */
    static void record(Context ctx, String sender, String code, String reason) {
        if (ctx == null) {
            return;
        }
        final Context app = ctx.getApplicationContext();
        final long ts = System.currentTimeMillis();
        final String line = ts + "\t" + safe(sender) + "\t" + safe(code) + "\t" + safe(reason) + "\n";
        new Thread(() -> {
            try {
                File f = new File(app.getFilesDir(), FILE_NAME);
                if (f.exists() && f.length() > MAX_BYTES) {
                    // Simple cap: reset rather than grow without bound.
                    // Losing old review rows is acceptable for a tuning aid.
                    // noinspection ResultOfMethodCallIgnored
                    f.delete();
                }
                try (FileWriter w = new FileWriter(f, true)) {
                    w.append(line);
                }
            } catch (Exception e) {
                Log.w(TAG, "RejectedSmsLog write failed: " + e.getMessage());
            }
        }).start();
    }

    /** Keep one record on one line, and guarantee no content leaks via tabs or
     *  newlines in a field. Never receives a message body. */
    private static String safe(String s) {
        return s == null ? "" : s.replaceAll("[\\t\\r\\n]", " ");
    }
}
