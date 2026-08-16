package com.example.paymentbot;

import java.util.HashMap;
import java.util.Map;

/**
 * Reference map of TRAI DLT-registered 6-character sender-ID entity tags —
 * the middle segment of a transactional header like "AD-HDFCBK-T" — to a
 * readable bank name.
 *
 * This is a seed list compiled from external research, NOT verified against
 * the live TRAI DLT registry. Treat it as incomplete: expand it based on
 * real captured sender IDs (see SMSReceiver's "unrecognized DLT bank tag"
 * log line) rather than assuming it covers every registered bank.
 */
final class BankSenderTags {

    private BankSenderTags() {
    }

    /**
     * Bank-name FRAGMENTS matched as substrings against the extracted DLT
     * entity code (see SMSReceiver.containsBankName) — the capture gate's actual
     * bank test. Fragments, not full codes, on purpose: a bank registers many
     * code variants (IDFC as IDFCB and IDFCFB; SBI as SBIBNK/SBIUPI/SBICRD), and
     * a substring match catches every variant from one entry where the old
     * exact-match map caught only the specific codes someone had already seen.
     *
     * Trade-off: short fragments can over-match a non-bank code that happens to
     * contain them. That is mitigated in SMSReceiver.evaluateSender by the
     * negative-keyword guard and the -P promotional filter, and any genuinely
     * wrong match surfaces in RejectedSmsLog for review. Expand this list from
     * that log (real rejected traffic), not from guesses.
     */
    static final String[] BANK_NAME_FRAGMENTS = {
            "SBI", "HDFC", "ICICI", "AXIS", "KOTAK", "IDFC", "PNB", "BOB",
            "CANBNK", "UBIN", "INDBNK", "BOI", "INDUS", "YES", "FED", "BDN",
            "PAYTM", "AIRTEL", "IPPB", "RBL", "SCB", "DBS", "CITI", "HSBC",
            "SIB", "KBL", "CBIN", "IOB", "UCO", "KVB", "CUB", "JKB", "EQF",
            "UJJVAN", "AUFBNK", "JANABK", "CAPFBN", "NSDLPB", "JIOPAY",
            "AMEXIN", "CREDIT",
    };

    // Retained for the human-readable bank-identification log line in
    // SMSReceiver.onReceive (which names the bank behind a captured message).
    // No longer the capture gate — that is BANK_NAME_FRAGMENTS above.
    static final Map<String, String> KNOWN_BANK_TAGS = new HashMap<>();

    static {
        KNOWN_BANK_TAGS.put("SBIBNK", "State Bank of India");
        KNOWN_BANK_TAGS.put("SBIUPI", "State Bank of India");
        KNOWN_BANK_TAGS.put("SBICRD", "State Bank of India (Cards)");
        KNOWN_BANK_TAGS.put("CENTBK", "Central Bank of India");
        KNOWN_BANK_TAGS.put("BOBTXN", "Bank of Baroda");
        KNOWN_BANK_TAGS.put("BARODA", "Bank of Baroda");
        KNOWN_BANK_TAGS.put("PNBSMS", "Punjab National Bank");
        KNOWN_BANK_TAGS.put("PNBPNB", "Punjab National Bank");
        KNOWN_BANK_TAGS.put("CANBNK", "Canara Bank");
        KNOWN_BANK_TAGS.put("UBIIND", "Union Bank of India");
        KNOWN_BANK_TAGS.put("IOBCHN", "Indian Overseas Bank");
        KNOWN_BANK_TAGS.put("BOIIND", "Bank of India");
        KNOWN_BANK_TAGS.put("HDFCBK", "HDFC Bank");
        KNOWN_BANK_TAGS.put("HDFCTX", "HDFC Bank");
        KNOWN_BANK_TAGS.put("ICICIB", "ICICI Bank");
        KNOWN_BANK_TAGS.put("ICICIT", "ICICI Bank");
        KNOWN_BANK_TAGS.put("AXISBK", "Axis Bank");
        KNOWN_BANK_TAGS.put("AXISBN", "Axis Bank");
        KNOWN_BANK_TAGS.put("KOTAKB", "Kotak Mahindra Bank");
        KNOWN_BANK_TAGS.put("KOTAKM", "Kotak Mahindra Bank");
        KNOWN_BANK_TAGS.put("INDUSD", "IndusInd Bank");
        KNOWN_BANK_TAGS.put("IDFCFB", "IDFC FIRST Bank");
        KNOWN_BANK_TAGS.put("FEDBNK", "Federal Bank");
        KNOWN_BANK_TAGS.put("BNDHAN", "Bandhan Bank");
        KNOWN_BANK_TAGS.put("AIRBNK", "Airtel Payments Bank");
        KNOWN_BANK_TAGS.put("PYTMBK", "Paytm Payments Bank");
        KNOWN_BANK_TAGS.put("JIOPAY", "Jio Payments Bank");
        KNOWN_BANK_TAGS.put("IPPBEC", "India Post Payments Bank");
        KNOWN_BANK_TAGS.put("AUBNKT", "AU Small Finance Bank");
    }
}
