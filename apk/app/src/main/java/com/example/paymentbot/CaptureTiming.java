package com.example.paymentbot;

import android.content.Context;
import android.text.TextUtils;
import android.util.Log;

import org.json.JSONObject;

import java.util.Calendar;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Diagnostic instrumentation for the reported 10-14 minute capture delay.
 *
 * Records the three timestamps only the phone can know, for every captured
 * notification and SMS, and ships them to POST /api/apk/capture-timing:
 *
 *   1. Embedded      — the time written inside the message text ("at 11:05 pm").
 *                      What the trader reads. Not a system clock at all: the
 *                      sending app chose it.
 *   2. System post   — StatusBarNotification.getPostTime() for notifications,
 *                      SmsMessage.getTimestampMillis() for SMS. Android's own
 *                      record, independent of this app.
 *   3. App reaction  — wall clock at the instant our callback ran.
 *
 * The fourth (server received) is stamped server-side on arrival.
 *
 * Deliberately separate from the capture upload rather than extra fields on
 * it: this is temporary, and it must not be able to change, delay or fail the
 * event that actually settles a payment. Every method here swallows its own
 * errors for the same reason.
 */
public final class CaptureTiming {

    private static final String TAG = "PaymentBot";
    private static final String ENDPOINT = "/api/apk/capture-timing";

    /**
     * Times as the payment apps write them: "at 11:05 pm", "at 6:47 PM",
     * "on 12-08-26 at 21:48", "11:05pm". Hour and minute are what matter —
     * the reported gap is minutes, so seconds are noise.
     */
    private static final Pattern EMBEDDED_TIME = Pattern.compile(
            "\\b(?:at\\s+)?([0-9]{1,2}):([0-9]{2})\\s*([ap])\\.?m\\.?", Pattern.CASE_INSENSITIVE);
    /** 24-hour fallback for bank SMS ("on 12-08-26-21:48"). */
    private static final Pattern EMBEDDED_TIME_24H = Pattern.compile(
            "\\b([01]?[0-9]|2[0-3]):([0-5][0-9])\\b");

    private CaptureTiming() {
    }

    /** The raw embedded-time text, exactly as written, or "" if there is none. */
    public static String embeddedText(String body) {
        if (TextUtils.isEmpty(body)) return "";
        Matcher m = EMBEDDED_TIME.matcher(body);
        if (m.find()) return m.group().trim();
        Matcher m24 = EMBEDDED_TIME_24H.matcher(body);
        if (m24.find()) return m24.group().trim();
        return "";
    }

    /**
     * The embedded time resolved to epoch millis, using {@code referenceMs}
     * (the system post time) for the calendar date the text omits.
     *
     * Returns 0 when there is nothing parseable — never a guess. If the
     * resolved time lands more than an hour AHEAD of the reference, it is
     * read as the previous day rather than the future: a notification cannot
     * describe a payment that has not happened yet, and around midnight the
     * date carried over is the only thing that can be wrong.
     */
    public static long embeddedMillis(String body, long referenceMs) {
        if (TextUtils.isEmpty(body) || referenceMs <= 0) return 0L;

        int hour = -1;
        int minute = -1;

        Matcher m = EMBEDDED_TIME.matcher(body);
        if (m.find()) {
            try {
                hour = Integer.parseInt(m.group(1)) % 12;
                minute = Integer.parseInt(m.group(2));
                if ("p".equalsIgnoreCase(m.group(3))) hour += 12;
            } catch (Exception ignored) {
                return 0L;
            }
        } else {
            Matcher m24 = EMBEDDED_TIME_24H.matcher(body);
            if (m24.find()) {
                try {
                    hour = Integer.parseInt(m24.group(1));
                    minute = Integer.parseInt(m24.group(2));
                } catch (Exception ignored) {
                    return 0L;
                }
            }
        }
        if (hour < 0 || minute < 0) return 0L;

        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(referenceMs);
        c.set(Calendar.HOUR_OF_DAY, hour);
        c.set(Calendar.MINUTE, minute);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        long resolved = c.getTimeInMillis();
        if (resolved > referenceMs + 60 * 60 * 1000L) {
            resolved -= 24 * 60 * 60 * 1000L;
        }
        return resolved;
    }

    /**
     * Queues one timing record. Goes through EventQueue like every other
     * upload, so a diagnostic never opens its own connection on a capture
     * callback and a record is not lost if the device is briefly offline.
     *
     * @param utcTimestamp the same formatted post time the real capture upload
     *                     sends — the key the two are joined on server-side.
     */
    public static void record(Context context, String captureSource, String origin,
                              String body, String amount, long systemPostMs,
                              long appReactionMs, String utcTimestamp) {
        try {
            JSONObject json = new JSONObject();
            json.put("captureSource", captureSource == null ? "" : captureSource);
            json.put("origin", origin == null ? "" : origin);
            json.put("embeddedTimeText", embeddedText(body));
            json.put("embeddedTimeMs", embeddedMillis(body, systemPostMs));
            json.put("systemPostTimeMs", systemPostMs);
            json.put("appReactionTimeMs", appReactionMs);
            json.put("utcTimestamp", utcTimestamp == null ? "" : utcTimestamp);
            json.put("bodyPreview", body == null ? "" : (body.length() > 300 ? body.substring(0, 300) : body));
            json.put("amount", amount == null ? "" : amount);
            EventQueue.enqueue(context, ENDPOINT, json.toString(), true);

            // Also on-device, so the same numbers are readable over adb even
            // if the phone never reaches the server.
            Log.i(TAG, "TIMING " + captureSource + " embedded=" + embeddedText(body)
                    + " post=" + systemPostMs + " app=" + appReactionMs
                    + " postToApp=" + (appReactionMs - systemPostMs) + "ms"
                    + " origin=" + origin);
        } catch (Exception e) {
            Log.e(TAG, "CaptureTiming.record failed: " + e.getMessage());
        }
    }
}
