package com.example.paymentbot;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Unit tests for the pure, Context-free logic behind Feature 2 (Payout
 * evidence capture): success-keyword matching and the 40-minute local
 * expiry countdown. Runs on the local JVM, same as BankSenderGateTest.
 *
 * Everything else in this feature — WindowManager overlay show/hide,
 * MediaProjection screenshot capture, AccessibilityService text reads, the
 * actual SharedPreferences-backed PayoutState — touches real Android
 * framework classes this project has no instrumented/Robolectric harness
 * for. Same boundary PaymentBotService already draws (no unit test today,
 * for the same reason) — those need a real device.
 */
public class PayoutStateTest {

    // --- success-keyword matching ------------------------------------------

    @Test
    public void gpaySuccessKeywordMatches() {
        assertTrue(PayoutOverlayService.matchesSuccessKeyword(
                "com.google.android.apps.nbu.paisa.user", "Payment Successful ₹500 to Test"));
    }

    @Test
    public void phonePeSuccessKeywordMatches() {
        assertTrue(PayoutOverlayService.matchesSuccessKeyword("com.phonepe.app", "Transfer Successful"));
    }

    @Test
    public void phonePeRealTransactionSuccessfulScreenMatches() {
        // Real, complete PhonePe success screen (team device evidence 2026-08-20).
        // Its header is "Transaction Successful"; the old seed only had "transfer
        // successful" and wrongly rejected this genuine, correct payment.
        String real = "Transaction Successful 08:52 PM on 20 Aug 2026 "
                + "Paid to Apu Bala XXXXXXXXXX8906 Jio Payments Bank "
                + "PhonePe Transaction ID T260820205229597621870B "
                + "Debited from XXXXXX1551 UTR 919634090229 ₹10";
        assertTrue(PayoutOverlayService.matchesSuccessKeyword("com.phonepe.app", real));
    }

    @Test
    public void paytmSuccessKeywordMatches() {
        assertTrue(PayoutOverlayService.matchesSuccessKeyword("net.one97.paytm", "Money Sent Successfully"));
    }

    @Test
    public void nonSuccessScreenDoesNotMatch() {
        assertFalse(PayoutOverlayService.matchesSuccessKeyword("com.phonepe.app", "Enter UPI PIN"));
    }

    @Test
    public void unknownPackageNeverMatches() {
        // No seed keywords for an app not in the whitelist — must fail
        // closed, not silently match on any text.
        assertFalse(PayoutOverlayService.matchesSuccessKeyword("com.some.other.app", "Payment Successful"));
    }

    // --- 40-minute local expiry countdown ----------------------------------

    @Test
    public void notExpiredWithinWindow() {
        long activatedAt = 1000L;
        assertTrue(PayoutState.computeMsRemaining(activatedAt, activatedAt + 39 * 60 * 1000L) > 0);
    }

    @Test
    public void expiredPastWindow() {
        long activatedAt = 1000L;
        assertEquals(0L, PayoutState.computeMsRemaining(activatedAt, activatedAt + 41 * 60 * 1000L));
    }

    @Test
    public void exactlyAtWindowBoundaryIsExpired() {
        long activatedAt = 1000L;
        assertEquals(0L, PayoutState.computeMsRemaining(activatedAt, activatedAt + PayoutState.WINDOW_MS));
    }
}
