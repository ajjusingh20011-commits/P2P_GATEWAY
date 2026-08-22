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
    public void phoneNumberIsRejected() {
        assertEquals(GateResult.Reason.PHONE_NUMBER, reason("+919845012345"));
    }

    // --- REDESIGN: phone no longer hard-rejects an unknown-but-DLT-shaped bank -

    @Test
    public void unknownButDltShapedSenderIsNowForwarded_notDroppedOnPhone() {
        // A previously-unmapped real bank (Bank of Maharashtra, AD-MAHABK-T) used
        // to be rejected UNKNOWN_BANK and silently dropped on the phone. It must
        // now pass the broad pre-filter and reach the server for identification.
        assertEquals(GateResult.Reason.ACCEPT, reason("AD-MAHABK-T"));
        assertTrue(SMSReceiver.isValidBankSender("AD-MAHABK-T"));
        // The other two real BoM header variants must also forward now.
        assertEquals(GateResult.Reason.ACCEPT, reason("JM-BOMBNK-S"));
        assertEquals(GateResult.Reason.ACCEPT, reason("VK-MAHAUPI-S"));
    }

    @Test
    public void nonBankButDltShapedSenderStillPassesSenderGate_contentAndServerFilter() {
        // The SENDER gate is now broad on purpose: a DLT-shaped non-bank (Amazon)
        // passes here; the content gate (hasBankMessageMarkers) and the server's
        // bank identification are what actually filter it — not a phone-side
        // allowlist that could also drop real banks.
        assertEquals(GateResult.Reason.ACCEPT, reason("AM-AMAZON-S"));
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
        // The real fraud/marketing rejects still stand after the redesign; only
        // the "unknown bank" reject was removed (that sender now forwards).
        assertEquals(GateResult.Reason.PROMOTIONAL, reason("JM-BDNSMS-P"));
        assertEquals(GateResult.Reason.NEGATIVE_KEYWORD, reason("AD-SBIKYC-S"));
        assertEquals(GateResult.Reason.PHONE_NUMBER, reason("+919845012345"));
    }

    // --- REDESIGN: broadened content gate (hasBankMessageMarkers) --------------

    @Test
    public void realBankCreditSmsAllPassContentGate() {
        // The 5 real Bank of Maharashtra MQR credit formats — each must pass the
        // content gate so it reaches the server (masked a/c and/or amount+verb).
        assertTrue(SMSReceiver.hasBankMessageMarkers(
                "Dear Merchant, A/C XX4321 credited by Rs 250.00 on 21-AUG-26 via UPI MQR from rahul@upi. Ref No 623409812345. Avail Bal: Rs 14,250.00. - Bank of Maharashtra"));
        assertTrue(SMSReceiver.hasBankMessageMarkers(
                "Credit Alert: INR 8,200.00 credited to your BOM A/C XX4321 on 21-AUG-26 via Merchant QR Code (RRN: 623409812348). Clg Bal: INR 27,699.00. - Bank of Maharashtra"));
    }

    @Test
    public void amountPlusVerbPassesEvenWithoutMaskedAccountOrRef() {
        // Broadened pre-filter: a genuine credit with an amount + money verb but
        // no masked a/c and no reference must still forward (never silently lost).
        assertTrue(SMSReceiver.hasBankMessageMarkers("Rs 5,000 credited to your account"));
        // A non-financial notice with neither markers nor amount+verb stays out.
        assertFalse(SMSReceiver.hasBankMessageMarkers("Your monthly e-statement is ready to view"));
    }
}
