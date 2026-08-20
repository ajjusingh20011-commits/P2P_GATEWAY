package com.example.paymentbot;

import java.util.Arrays;
import java.util.List;

/**
 * PHASE 1b — SINGLE SOURCE OF TRUTH for the payment-app package allowlist.
 *
 * Previously two lists had drifted apart: NotificationService.ALLOWED_PACKAGES
 * (13 entries; payment + bank apps, for inbound notification capture) and
 * PaymentBotService.PAYMENT_APPS (17 entries; the overlay/success-screen set,
 * which still carried the Amazon/CRED/MobiKwik/FreeCharge apps NotificationService
 * had deliberately dropped under BUG-38). Both now delegate here.
 *
 * This is the anti-fraud anchor for OUTGOING payouts: the overlay only activates
 * Record/Capture inside a package in {@link #isPaymentApp}, and — with
 * {@link AppSignatureVerifier} — only when that package's signing certificate
 * also checks out, so a sideloaded fake reusing a real package name is rejected.
 */
public final class PaymentApps {

    private PaymentApps() {
    }

    // ── CONSUMER / PERSONAL apps — a trader SENDS payouts from these. ──
    // These are the PAYOUT-relevant apps: the fraud anchor + signature pins for
    // the outgoing-payout flow target THESE, not the Business variants below.
    // GPay + PhonePe are the Phase-1 pinning test scope (NEEDS one device
    // `pm list packages` check + logcat PAYOUT_CERT_PIN capture).
    public static final String GPAY = "com.google.android.apps.nbu.paisa.user";
    public static final String PHONEPE = "com.phonepe.app";
    // net.one97.paytm is the consumer Paytm app (individuals pay from it), as
    // distinct from com.paytm.business (merchant receive) below.
    public static final String PAYTM = "net.one97.paytm";
    // Airtel Payments Bank (consumer wallet/bank app).
    public static final String AIRTEL = "com.airtelpeymentsbank";

    // ── BUSINESS / MERCHANT apps — a trader RECEIVES customer pay-ins in these
    //    (handled by the pay-in capture system). NOT payout-capture targets and
    //    NOT payout signature-pin targets. ──
    public static final String GPAY_BUSINESS = "com.google.android.apps.nbu.paisa.merchant";
    public static final String PHONEPE_BUSINESS = "com.phonepe.app.business";
    public static final String PAYTM_BUSINESS = "com.paytm.business";
    public static final String BHARATPE_MERCHANT = "com.bharatpe.merchant";
    // BharatPe for Business — VERIFIED against the Play Store listing.
    public static final String BHARATPE_BUSINESS = "com.bharatpe.app";

    // Apps the trader SENDS payouts from (consumer). The outgoing-payout overlay
    // and its signature-pin anchor are scoped to these.
    static final List<String> PAYOUT_APPS = Arrays.asList(GPAY, PHONEPE, PAYTM, AIRTEL);

    // Every UPI app, consumer + business — used by the general overlay/foreground
    // tracking and (with BANK_APPS) inbound notification capture.
    static final List<String> PAYMENT_APPS = Arrays.asList(
            GPAY, GPAY_BUSINESS, PHONEPE, PHONEPE_BUSINESS, PAYTM, PAYTM_BUSINESS,
            BHARATPE_MERCHANT, BHARATPE_BUSINESS, AIRTEL);

    // -- Bank apps, kept for their inbound credit alerts only. A payment can be
    //    reported by the receiving bank's own app rather than the UPI app. These
    //    are NEVER outgoing-payout capture targets (a trader doesn't pay out
    //    from a bank statement screen), which is exactly why they're separate. --
    static final List<String> BANK_APPS = Arrays.asList(
            "com.snapwork.hdfc",
            "com.csam.icici.bank.imobile",
            "com.sbi.SBIFreedomPlus",
            "com.axis.mobile");

    /** Inbound notification capture watches payment apps AND bank apps. */
    public static boolean isNotificationSource(String pkg) {
        return pkg != null && (PAYMENT_APPS.contains(pkg) || BANK_APPS.contains(pkg));
    }

    /** Any UPI app (consumer or business) — general overlay/foreground tracking. */
    public static boolean isPaymentApp(String pkg) {
        return pkg != null && PAYMENT_APPS.contains(pkg);
    }

    /**
     * A consumer/personal app a trader SENDS payouts from. The outgoing-payout
     * capture (Record/Screenshot) and its signature-pin fraud anchor are scoped
     * to these — NOT the Business/merchant receive apps.
     */
    public static boolean isPayoutApp(String pkg) {
        return pkg != null && PAYOUT_APPS.contains(pkg);
    }
}
