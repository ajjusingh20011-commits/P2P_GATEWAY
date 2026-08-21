package com.example.paymentbot;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.List;

/**
 * Real app-format samples for the tap-only success-screen extractor. Tests the
 * pure String/List extractors (parse() composes these into JSON on-device).
 * Extract what's present; leave absent fields empty (never fabricate).
 */
public class SuccessScreenParserTest {

    @Test
    public void phonePeSuccess_extractsFullFieldList() {
        String text = "Payment Successful\n₹920\nPaid to Blinkit\n"
                + "Debited from HDFC Bank A/c XXXX4521\n"
                + "20 Aug 2026, 3:45 PM\n"
                + "UTR: 260808015214356329\nTransaction ID: T2608080152143";
        assertEquals("920", SuccessScreenParser.amount(text));
        assertEquals("Blinkit", SuccessScreenParser.recipientName(text));
        assertEquals("HDFC Bank", SuccessScreenParser.senderBank(text));
        assertEquals("4521", SuccessScreenParser.last4List(text).get(0));
        assertEquals("260808015214356329", SuccessScreenParser.utr(text));
        assertEquals("T2608080152143", SuccessScreenParser.transactionId(text));
        assertTrue(SuccessScreenParser.transactionTime(text).contains("3:45"));
    }

    @Test
    public void recipientLast4WhenNoName() {
        String text = "₹500 paid\nTo account xxxx7788\nUTR 123456789012";
        assertEquals("500", SuccessScreenParser.amount(text));
        assertEquals("", SuccessScreenParser.recipientName(text));
        assertEquals("7788", SuccessScreenParser.last4List(text).get(0));
        assertEquals("123456789012", SuccessScreenParser.utr(text));
    }

    @Test
    public void thinScreen_missingFieldsComeBackEmpty_notFabricated() {
        String text = "₹250 sent successfully";
        assertEquals("250", SuccessScreenParser.amount(text));
        assertEquals("", SuccessScreenParser.utr(text));
        assertEquals("", SuccessScreenParser.transactionId(text));
        assertEquals("", SuccessScreenParser.senderBank(text));
        assertTrue(SuccessScreenParser.last4List(text).isEmpty());
    }

    @Test
    public void commaAmount_cleaned() {
        assertEquals("120000", SuccessScreenParser.amount("Paid ₹1,20,000 to Vendor"));
    }

    @Test
    public void phonePeRealScreen_extractsAmountLast4Utr() {
        // The same real PhonePe screen the keyword fix unblocks — confirm the
        // downstream field extraction gets what the match gate needs (amount +
        // the recipient account last-4 that matches the payout order).
        String real = "Transaction Successful 08:52 PM on 20 Aug 2026 "
                + "Paid to Apu Bala XXXXXXXXXX8906 Jio Payments Bank "
                + "PhonePe Transaction ID T260820205229597621870B "
                + "Debited from XXXXXX1551 UTR 919634090229 ₹10";
        assertEquals("10", SuccessScreenParser.amount(real));
        assertTrue(SuccessScreenParser.last4List(real).contains("8906"));
        assertTrue(SuccessScreenParser.last4List(real).contains("1551"));
        assertEquals("919634090229", SuccessScreenParser.utr(real));
        // RECIPIENT's bank comes from the "Paid to" side, NOT the trader's paying
        // source. "Debited from XXXXXX1551" shows no bank name (a wallet icon), so
        // senderBank is honestly empty — never the recipient's Jio bank.
        assertEquals("Jio Payments Bank", SuccessScreenParser.recipientBank(real));
        assertEquals("", SuccessScreenParser.senderBank(real));
    }

    @Test
    public void recipientBank_notConfusedWithTradersDebitBank() {
        // "Paid to Blinkit" (no bank shown) + "Debited from HDFC Bank" — HDFC is
        // the TRADER's paying bank, and must never be reported as the recipient's.
        String text = "Payment Successful\n₹920\nPaid to Blinkit\n"
                + "Debited from HDFC Bank A/c XXXX4521\n";
        assertEquals("HDFC Bank", SuccessScreenParser.senderBank(text));
        assertEquals("", SuccessScreenParser.recipientBank(text));
    }

    @Test
    public void bothSidesLast4_bothCaptured() {
        String text = "₹100 from A/c XX1111 to A/c XX2222 UTR 998877665544";
        List<String> last4 = SuccessScreenParser.last4List(text);
        assertEquals(2, last4.size());
    }
}
