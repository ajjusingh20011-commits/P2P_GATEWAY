package com.example.paymentbot;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/**
 * Unit tests for BUG-56 — SMSReceiver.AMOUNT_PATTERNS' new "<number> Rupees"
 * suffix pattern. Runs on the local JVM — pure regex logic, no Android APIs.
 * Run with: gradlew testDebugUnitTest.
 *
 * Real case: a captured BharatPe notification body read "Received 30.00
 * Rupees From Chiranjit Kumar Biswas." — no ₹/Rs/INR prefix at all, just the
 * plain word "Rupees" AFTER the number. Every pattern this app had (both
 * here and server-side in paymentDetector.js) required a currency PREFIX
 * before the digits, so this real, live format silently extracted amount:""
 * — no amount meant no order matching, so a real ₹30 payment never settled.
 */
public class BharatPeAmountPatternTest {

    @Test
    public void bharatPeRupeesSuffixFormatExtracts() {
        // The real captured body, verbatim.
        String body = "Received 30.00 Rupees From Chiranjit Kumar Biswas.";
        assertEquals("30.00", SMSReceiver.firstMatch(body, SMSReceiver.AMOUNT_PATTERNS));
    }

    @Test
    public void rupeesSuffixIsCaseInsensitiveAndWholeNumberWorks() {
        assertEquals("500", SMSReceiver.firstMatch("Received 500 rupees from Test User.", SMSReceiver.AMOUNT_PATTERNS));
        assertEquals("500", SMSReceiver.firstMatch("Received 500 RUPEES from Test User.", SMSReceiver.AMOUNT_PATTERNS));
    }

    @Test
    public void prefixFormatStillPreferredWhenBothCouldMatch() {
        // The ₹-prefix pattern is tried first — must still win when present,
        // unaffected by the new fallback pattern existing alongside it.
        assertEquals("500", SMSReceiver.firstMatch("₹500 received from Test User", SMSReceiver.AMOUNT_PATTERNS));
    }

    @Test
    public void bareNumberWithNoRupeesWordStillFindsNothing() {
        // The new pattern requires the word "Rupees" — a bare number alone
        // (e.g. an account digit run) must not be misread as an amount.
        assertEquals("", SMSReceiver.firstMatch("Your OTP is 3000", SMSReceiver.AMOUNT_PATTERNS));
    }
}
