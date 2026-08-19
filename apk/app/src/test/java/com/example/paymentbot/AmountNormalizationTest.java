package com.example.paymentbot;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/**
 * Unit tests for BUG-54a — SMSReceiver.normalizeUnicodeDigits() and its use
 * inside firstMatch() (the shared extraction entry point for
 * SMSReceiver.AMOUNT_PATTERNS/UTR_PATTERNS/etc., reused by
 * NotificationService). Runs on the local JVM — pure String logic, no
 * Android APIs. Run with: gradlew testDebugUnitTest.
 *
 * Real case: a captured PhonePe notification body contained "Rs 𝟐𝟎" — bold
 * Unicode "Mathematical" digit characters, not ASCII 0-9 — which
 * AMOUNT_PATTERNS' [\d,]+ class silently failed to match at all, uploading
 * amount:"" and leaving the server's own regex fallback to fail the same
 * way on the same un-normalized text.
 */
public class AmountNormalizationTest {

    @Test
    public void boldDigitsNormalizeToAscii() {
        // U+1D7D0 U+1D7CE = Mathematical Bold Digit Two, Zero.
        assertEquals("Received Rs 20", SMSReceiver.normalizeUnicodeDigits("Received Rs 𝟐𝟎"));
    }

    @Test
    public void plainAsciiTextIsUnchanged() {
        assertEquals("Received Rs 20", SMSReceiver.normalizeUnicodeDigits("Received Rs 20"));
    }

    @Test
    public void nullAndEmptyAreSafe() {
        assertEquals(null, SMSReceiver.normalizeUnicodeDigits(null));
        assertEquals("", SMSReceiver.normalizeUnicodeDigits(""));
    }

    @Test
    public void firstMatchFindsAmountBehindBoldDigits() {
        // The real captured body, verbatim (bold "20").
        String body = "You've received Rs 𝟐𝟎 from ******5388 via PhonePe for txn...";
        assertEquals("20", SMSReceiver.firstMatch(body, SMSReceiver.AMOUNT_PATTERNS));
    }

    @Test
    public void firstMatchStillWorksForPlainAsciiAmounts() {
        assertEquals("500", SMSReceiver.firstMatch("Rs 500 debited", SMSReceiver.AMOUNT_PATTERNS));
    }
}
