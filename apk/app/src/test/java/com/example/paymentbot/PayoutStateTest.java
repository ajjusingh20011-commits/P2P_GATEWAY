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
    public void gpayRealCompletedScreenMatches() {
        // Real, complete GPay success screen (team device evidence 2026-08-21).
        // GPay's success INDICATOR is the literal word "Completed" — NOT
        // "transfer/transaction successful" — so it is not in GENERAL_SUCCESS_KEYWORDS
        // and must be covered by the GPay per-app seed. Guards that seed against
        // regression (same discipline as the PhonePe "Transaction Successful" fix).
        String real = "₹10 Completed 21 Aug 2026, 8:52 pm "
                + "To Apu Bala UPI transaction ID 919634090229 "
                + "From XXXXXX1551 Google Pay";
        assertTrue(PayoutOverlayService.matchesSuccessKeyword(
                "com.google.android.apps.nbu.paisa.user", real));
        // Merchant package too (both seeds carry "completed").
        assertTrue(PayoutOverlayService.matchesSuccessKeyword(
                "com.google.android.apps.nbu.paisa.merchant", real));
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

    // --- Phase 2c: which-of-3 content resolution ---------------------------

    private static java.util.List<String[]> armed(String... triples) {
        // triples: orderId, amount, accountNumber (or "" for a UPI payout), repeated
        java.util.List<String[]> a = new java.util.ArrayList<>();
        for (int i = 0; i < triples.length; i += 3) {
            a.add(new String[]{triples[i], triples[i + 1], triples[i + 2]});
        }
        return a;
    }

    private static java.util.List<String> last4(String... v) {
        return java.util.Arrays.asList(v);
    }

    @Test
    public void resolvePicksTheMatchingPayoutAmongThree() {
        // The real bug: 3 armed, trader pays the SECOND — capture must link to it,
        // not to whichever was the sticky working slot.
        java.util.List<String[]> list = armed(
                "A", "500", "111122223333",
                "B", "920", "999988887777",
                "C", "500", "555544443333");
        assertEquals("B", PayoutState.resolveOrderId(list, "920", last4("7777")));
    }

    @Test
    public void resolveNeedsBothAmountAndLast4ForBank() {
        java.util.List<String[]> list = armed("A", "500", "111122223333");
        // right amount, wrong account -> no match
        assertEquals("", PayoutState.resolveOrderId(list, "500", last4("0000")));
        // right account, wrong amount -> no match
        assertEquals("", PayoutState.resolveOrderId(list, "999", last4("3333")));
        // both right -> match
        assertEquals("A", PayoutState.resolveOrderId(list, "500", last4("3333")));
    }

    @Test
    public void resolveAmbiguousReturnsEmpty() {
        // Two indistinguishable payouts (same amount + same last-4) -> never guess.
        java.util.List<String[]> list = armed(
                "A", "500", "111122223333",
                "B", "500", "444422223333");
        assertEquals("", PayoutState.resolveOrderId(list, "500", last4("3333")));
    }

    @Test
    public void resolveUpiPayoutMatchesOnAmountOnly() {
        // No account number on a UPI payout -> amount alone disambiguates.
        java.util.List<String[]> list = armed(
                "A", "500", "",
                "B", "920", "");
        assertEquals("B", PayoutState.resolveOrderId(list, "920", last4()));
    }

    @Test
    public void tieIsDetectableAsMultipleMatches() {
        // Same amount + same last-4 across two payouts -> resolve returns "" (never
        // guess) AND both are reported as matches so the capture is flagged for review.
        java.util.List<String[]> list = armed(
                "A", "500", "111122223333",
                "B", "500", "444422223333");
        assertEquals("", PayoutState.resolveOrderId(list, "500", last4("3333")));
        assertEquals(2, PayoutState.matchingOrderIds(list, "500", last4("3333")).size());
    }

    @Test
    public void upiSameAmountIsATie() {
        // Two UPI payouts of the same amount (no account last-4) collide on amount
        // alone — a realistic tie that must go to review, not settle to a guess.
        java.util.List<String[]> list = armed("A", "500", "", "B", "500", "");
        assertEquals("", PayoutState.resolveOrderId(list, "500", last4()));
        assertEquals(2, PayoutState.matchingOrderIds(list, "500", last4()).size());
    }

    @Test
    public void amountsEqualIgnoresFormatting() {
        assertTrue(PayoutState.amountsEqual("920", "920.00"));
        assertTrue(PayoutState.amountsEqual("₹1,920.0", "1920"));
        assertFalse(PayoutState.amountsEqual("920", "92"));
    }

    @Test
    public void last4DigitsHandlesMasking() {
        assertEquals("3333", PayoutState.last4Digits("XXXXXX3333"));
        assertEquals("", PayoutState.last4Digits("12"));
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
