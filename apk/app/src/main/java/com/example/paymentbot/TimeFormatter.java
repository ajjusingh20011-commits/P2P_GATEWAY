package com.example.paymentbot;

import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.text.SimpleDateFormat;

/**
 * Utility class for formatting timestamps in UTC, display, and relative forms.
 */
public final class TimeFormatter {

    private static final long SECOND_MS = 1000L;
    private static final long MINUTE_MS = 60L * SECOND_MS;
    private static final long HOUR_MS = 60L * MINUTE_MS;
    private static final long DAY_MS = 24L * HOUR_MS;

    private TimeFormatter() {
        // Utility class, no instances.
    }

    /**
     * Formats a timestamp as an ISO-8601 UTC string, e.g. "2026-06-15T14:32:01Z".
     *
     * @param millis epoch time in milliseconds
     * @return ISO-8601 UTC string
     */
    public static String toUTC(long millis) {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        return sdf.format(new Date(millis));
    }

    /**
     * Formats a timestamp for display in UTC, e.g. "15 Jun 14:32 UTC".
     *
     * @param millis epoch time in milliseconds
     * @return human-friendly display string
     */
    public static String toDisplay(long millis) {
        SimpleDateFormat sdf = new SimpleDateFormat("dd MMM HH:mm", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        return sdf.format(new Date(millis)) + " UTC";
    }

    /**
     * Formats a timestamp relative to now, e.g. "just now", "2m ago",
     * "1h ago", or "Yesterday".
     *
     * @param millis epoch time in milliseconds
     * @return relative time string
     */
    public static String toRelative(long millis) {
        long diff = System.currentTimeMillis() - millis;
        if (diff < 0) {
            // Timestamp is in the future; treat as just now.
            return "just now";
        }
        long seconds = diff / 1000;
        long minutes = seconds / 60;
        long hours = minutes / 60;
        long days = hours / 24;

        if (seconds < 45) return "just now";
        if (minutes < 2) return "1m ago";
        if (minutes < 60) return minutes + "m ago";
        if (hours == 1) return "1h ago";
        if (hours < 24) return hours + "h ago";
        if (days == 1) return "Yesterday";
        return days + "d ago";
    }
}
