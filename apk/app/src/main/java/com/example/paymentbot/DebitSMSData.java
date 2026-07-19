package com.example.paymentbot;

/**
 * Structured representation of a DEBIT bank SMS, with the payment details
 * extracted from the message body plus sender-verification flags.
 *
 * <p>Built by {@link SMSReceiver} when an incoming SMS is classified as a debit.
 * Kept as a plain data holder so it can be serialized to JSON for the backend
 * and reused by the in-app feed.
 */
public class DebitSMSData {

    public String sender;
    public String smsBody;
    public String last4Digits;
    public String amount;
    public String balance;
    public String utr;
    /** UTC ISO-8601 timestamp of when the SMS was received. */
    public String receivedAt;
    /** True when the sender ID matches the transactional "-T" bank pattern. */
    public boolean isTransactionalSender;
    /** True when the message was classified as a debit. */
    public boolean isDebit;
    /** The original, unmodified SMS text. */
    public String rawSms;

    public DebitSMSData() {
    }

    public DebitSMSData(String sender,
                        String smsBody,
                        String last4Digits,
                        String amount,
                        String balance,
                        String utr,
                        String receivedAt,
                        boolean isTransactionalSender,
                        boolean isDebit,
                        String rawSms) {
        this.sender = sender != null ? sender : "";
        this.smsBody = smsBody != null ? smsBody : "";
        this.last4Digits = last4Digits != null ? last4Digits : "";
        this.amount = amount != null ? amount : "";
        this.balance = balance != null ? balance : "";
        this.utr = utr != null ? utr : "";
        this.receivedAt = receivedAt != null ? receivedAt : "";
        this.isTransactionalSender = isTransactionalSender;
        this.isDebit = isDebit;
        this.rawSms = rawSms != null ? rawSms : "";
    }

    @Override
    public String toString() {
        return "DebitSMSData{"
                + "sender='" + sender + '\''
                + ", last4Digits='" + last4Digits + '\''
                + ", amount='" + amount + '\''
                + ", balance='" + balance + '\''
                + ", utr='" + utr + '\''
                + ", isTransactionalSender=" + isTransactionalSender
                + ", isDebit=" + isDebit
                + '}';
    }
}
