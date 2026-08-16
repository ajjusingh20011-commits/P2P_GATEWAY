package com.example.paymentbot;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.example.paymentbot.SMSReceiver.GateResult;

import org.junit.Test;

/**
 * Unit tests for the pure SMS bank-sender capture gate
 * (SMSReceiver.evaluateSender / isValidBankSender). Runs on the local JVM —
 * the gate touches no Android APIs. Run with: gradlew testDebugUnitTest.
 *
 * Scope reminder: these assert the SENDER-ID gate only. Content-level phishing
 * detection (link/domain allowlisting) is a separate, not-yet-built follow-up.
 */
public class BankSenderGateTest {

    private static GateResult.Reason reason(String sender) {
        return SMSReceiver.evaluateSender(sender).reason;
    }

    // --- captured ---------------------------------------------------------

    @Test
    public void hdfcServiceIsCaptured_butNotForwardedAsDebit() {
        assertTrue(SMSReceiver.isValidBankSender("VK-HDFCBK-S"));
        // -S lands in the feed; only -T forwards as a verified debit.
        assertFalse(SMSReceiver.isTransactionalSender("VK-HDFCBK-S"));
    }

    @Test
    public void iciciTransactionalIsCapturedAndForwarded() {
        assertTrue(SMSReceiver.isValidBankSender("AX-ICICIB-T"));
        assertTrue(SMSReceiver.isTransactionalSender("AX-ICICIB-T"));
    }

    @Test
    public void idfcVariantIsCaptured_theOriginalBug() {
        // "IDFCB" is a real IDFC First Bank code the old exact-match map (which
        // only knew "IDFCFB") dropped. Fragment "IDFC" now matches it.
        assertTrue(SMSReceiver.isValidBankSender("VM-IDFCB-T"));
    }

    @Test
    public void axisServicePassesSenderGate_contentPhishingOutOfScope() {
        // A genuine-looking header passes the SENDER gate. Detecting a phishing
        // body delivered from such a header is the separate content-check
        // follow-up, NOT this gate — asserting capture here is correct.
        assertTrue(SMSReceiver.isValidBankSender("JX-AXISBK-S"));
    }

    // --- rejected ---------------------------------------------------------

    @Test
    public void promotionalIsRejected() {
        assertEquals(GateResult.Reason.PROMOTIONAL, reason("JM-BDNSMS-P"));
    }

    @Test
    public void negativeKeywordIsRejected_evenWhenBankFragmentMatches() {
        // "SBIKYC" contains the bank fragment SBI but also the action word KYC.
        assertEquals(GateResult.Reason.NEGATIVE_KEYWORD, reason("AD-SBIKYC-S"));
    }

    @Test
    public void nonBankSenderIsRejected() {
        assertEquals(GateResult.Reason.UNKNOWN_BANK, reason("AM-AMAZON-S"));
    }

    @Test
    public void phoneNumberIsRejected() {
        assertEquals(GateResult.Reason.PHONE_NUMBER, reason("+919845012345"));
    }

    // --- FEATURE 1: content classification (extends the gate above) ------

    @Test
    public void debitContentClassifies() {
        assertTrue(SMSReceiver.isValidBankSender("VK-HDFCBK-S"));
        assertEquals("DEBIT", SMSReceiver.classifyMessageBody("Rs. 4,500.00 debited from your account"));
    }

    @Test
    public void creditContentClassifies() {
        assertTrue(SMSReceiver.isValidBankSender("JK-SBIBNK-S"));
        assertEquals("CREDIT", SMSReceiver.classifyMessageBody("Your account credited with Rs 12,500.00"));
    }

    @Test
    public void otpFromTransactionalSenderClassifies() {
        assertTrue(SMSReceiver.isValidBankSender("AX-ICICIB-T"));
        assertTrue(SMSReceiver.isTransactionalSender("AX-ICICIB-T"));
        assertEquals("OTP", SMSReceiver.classifyMessageBody("740291 is your OTP. Do not share it."));
    }

    @Test
    public void nonQualifyingContentClassifiesAsInfo() {
        assertTrue(SMSReceiver.isValidBankSender("VK-HDFCBK-S"));
        assertEquals("INFO", SMSReceiver.classifyMessageBody("Your monthly statement is ready to view"));
    }

    @Test
    public void creditKeywordWithoutAmountIsNotEnough() {
        assertEquals("INFO", SMSReceiver.classifyMessageBody("Your account was credited today"));
    }

    @Test
    public void paymentReferenceWithoutDebitCreditKeywordClassifies() {
        assertEquals("PAYMENT_REFERENCE",
                SMSReceiver.classifyMessageBody("Ref No 623910842019 for A/c xx3902"));
    }

    @Test
    public void pureInfoNoticeStaysInfo() {
        assertEquals("INFO",
                SMSReceiver.classifyMessageBody("Branches will remain closed on account of a public holiday"));
    }

    // Gate rejections re-asserted here too — confirms the content changes
    // above didn't touch the sender gate at all.
    @Test
    public void gateRejectionsUnaffectedByContentClassification() {
        assertEquals(GateResult.Reason.PROMOTIONAL, reason("JM-BDNSMS-P"));
        assertEquals(GateResult.Reason.NEGATIVE_KEYWORD, reason("AD-SBIKYC-S"));
        assertEquals(GateResult.Reason.UNKNOWN_BANK, reason("AM-AMAZON-S"));
        assertEquals(GateResult.Reason.PHONE_NUMBER, reason("+919845012345"));
    }
}
