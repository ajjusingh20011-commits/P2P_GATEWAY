package com.example.paymentbot;

import androidx.room.Entity;
import androidx.room.PrimaryKey;

/**
 * A message that passed the bank/allowed-app relevance gate (so we're
 * confident it's a real bank/UPI message, not noise) but that our regexes
 * failed to extract a usable amount/UTR from — item 5's "log it instead of
 * silently dropping it" requirement. Purely local/on-device: the point is
 * for a developer to plug in the phone and review real unsupported formats
 * (via the Logs tab's export) and add patterns for them over time, not to
 * ship raw SMS/notification text off-device automatically.
 */
@Entity(tableName = "parse_failures")
public class ParseFailure {

    @PrimaryKey(autoGenerate = true)
    public long id;

    /** "SMS", "NOTIFICATION", or "SCREEN". */
    public String source;

    public String sender;
    public String rawText;

    /** Short machine-readable reason, e.g. "no_amount_matched". */
    public String reason;

    public long createdAt;

    public ParseFailure() {
    }

    public ParseFailure(String source, String sender, String rawText, String reason) {
        this.source = source;
        this.sender = sender;
        this.rawText = rawText;
        this.reason = reason;
        this.createdAt = System.currentTimeMillis();
    }
}
