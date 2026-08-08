package com.example.paymentbot;

import androidx.room.Entity;
import androidx.room.PrimaryKey;

/**
 * A captured payment event (SMS debit / notification / screen success /
 * outgoing payment) waiting to be delivered to the server. Every capture
 * path writes one of these FIRST, synchronously, before attempting any
 * network call — so a captured event survives the app being offline, the
 * server being down, or the process dying mid-delivery. {@link
 * EventUploadWorker} is what actually drains this table.
 *
 * Deliberately generic (endpointPath + a pre-built JSON body) rather than
 * one column per field, so it can carry any of the four existing POST
 * shapes (/api/apk/event, /api/apk/debit-sms, /api/apk/outgoing-payment,
 * /api/apk/crash) without a schema change every time a new capture type is
 * added — the JSON-building logic stays exactly where it already lives in
 * each engine, this just adds a durability layer underneath it.
 */
@Entity(tableName = "queued_events")
public class QueuedEvent {

    @PrimaryKey(autoGenerate = true)
    public long id;

    /** Path relative to the server base URL, e.g. "/api/apk/event". */
    public String endpointPath;

    /** Exact JSON body to POST, already built by the capturing engine. */
    public String payloadJson;

    /** Whether to attach the "devicetoken" header (only /api/apk/event and
     *  /api/apk/crash require it today — debit-sms/outgoing-payment key off
     *  a plain deviceId field inside the JSON body instead, matching the
     *  server routes as they exist now). */
    public boolean needsDeviceTokenHeader;

    public long createdAt;

    /** Delivery attempts so far — used for capped exponential backoff. */
    public int attempts;

    /** Last failure reason, kept for on-device diagnostics only. */
    public String lastError;

    public QueuedEvent() {
    }

    public QueuedEvent(String endpointPath, String payloadJson, boolean needsDeviceTokenHeader) {
        this.endpointPath = endpointPath;
        this.payloadJson = payloadJson;
        this.needsDeviceTokenHeader = needsDeviceTokenHeader;
        this.createdAt = System.currentTimeMillis();
        this.attempts = 0;
        this.lastError = null;
    }
}
