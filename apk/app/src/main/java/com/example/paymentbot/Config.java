package com.example.paymentbot;

/**
 * Central app configuration. Change {@link #SERVER_BASE_URL} to your backend's
 * reachable address once — every networking call in the app derives its URL
 * from here, so there is a single place to update (no scattered IPs).
 *
 * <p>On a real device "localhost" is the phone itself, so replace this with the
 * server machine's LAN IP or public host, e.g. "http://192.168.1.50:3000".
 */
public final class Config {

    /** Base URL of the ngo-backend server (no trailing slash). */
    public static final String SERVER_BASE_URL = "http://198.44.140.74:3000";

    // Endpoint paths.
    public static final String EP_DEBIT_SMS = SERVER_BASE_URL + "/api/apk/debit-sms";
    public static final String EP_OVERLAY_CAPTURE = SERVER_BASE_URL + "/api/apk/overlay-capture";
    public static final String EP_OUTGOING_PAYMENT = SERVER_BASE_URL + "/api/apk/outgoing-payment";
    public static final String EP_UPDATE_PURPOSE = SERVER_BASE_URL + "/api/apk/update-purpose";

    private Config() {
    }
}
