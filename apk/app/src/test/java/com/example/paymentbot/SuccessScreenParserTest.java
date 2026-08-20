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
    public void bothSidesLast4_bothCaptured() {
        String text = "₹100 from A/c XX1111 to A/c XX2222 UTR 998877665544";
        List<String> last4 = SuccessScreenParser.last4List(text);
        assertEquals(2, last4.size());
    }
}
