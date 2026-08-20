package com.example.paymentbot;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import android.util.Log;

import java.security.MessageDigest;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/**
 * PHASE 1b — anti-fraud anchor. Verifies the foreground app is the REAL payment
 * app, not a sideloaded fake that merely copied its package name.
 *
 * Package name alone is spoofable: on a device that does NOT already have the
 * genuine app installed, an attacker can sideload an APK that DECLARES the real
 * package name (Android only blocks installing a different-signature app OVER an
 * existing one). Pinning the app's signing-certificate SHA-256 closes this — a
 * fake can copy the name but cannot forge Google's / PhonePe's / Paytm's signing
 * key. One PackageManager call per activation; negligible cost.
 *
 * LOG-ON-DEVICE-FIRST rollout: {@link #PINS} starts EMPTY. On a TRUSTED device,
 * the first time each real app is used the observed SHA-256 is logged — capture
 * it with:  adb logcat -s PaymentBot | grep PAYOUT_CERT_PIN  — then paste the
 * value into PINS. Until a package is pinned it is ALLOWED (so capture can
 * proceed while pins are being gathered) but flagged UNPINNED. Once pinned, a
 * mismatching certificate is a hard block — the only thing this ever blocks.
 */
public final class AppSignatureVerifier {

    private static final String TAG = "PaymentBot";

    private AppSignatureVerifier() {
    }

    // pkg -> expected signing-cert SHA-256 (uppercase hex, no separators).
    // EMPTY until captured on a trusted device (see class doc). Payouts are SENT
    // from the trader's CONSUMER apps, so the Phase-1 pin test scope is regular
    // GPay + PhonePe (NOT the Business/merchant receive variants):
    //   m.put(PaymentApps.GPAY,    "<sha256 from device: open regular GPay>");
    //   m.put(PaymentApps.PHONEPE, "<sha256 from device: open regular PhonePe>");
    private static final Map<String, String> PINS;
    static {
        Map<String, String> m = new HashMap<>();
        PINS = Collections.unmodifiableMap(m);
    }

    public enum Result { PINNED_OK, UNPINNED_LOGGED, MISMATCH, UNKNOWN }

    public static Result verify(Context ctx, String pkg) {
        if (ctx == null || pkg == null) return Result.UNKNOWN;
        String sha = signingSha256(ctx, pkg);
        if (sha == null) return Result.UNKNOWN;
        String pin = PINS.get(pkg);
        if (pin == null) {
            // Capture target: log the real hash so an operator can pin it.
            Log.w(TAG, "PAYOUT_CERT_PIN observed pkg=" + pkg + " sha256=" + sha
                    + " (UNPINNED — capture this value and add it to AppSignatureVerifier.PINS)");
            return Result.UNPINNED_LOGGED;
        }
        if (pin.equalsIgnoreCase(sha)) {
            return Result.PINNED_OK;
        }
        Log.e(TAG, "PAYOUT_CERT_PIN MISMATCH pkg=" + pkg + " expected=" + pin + " actual=" + sha
                + " — refusing payout capture (possible sideloaded fake)");
        return Result.MISMATCH;
    }

    /**
     * True unless the certificate MISMATCHES a pin — a pinned app whose signing
     * cert doesn't match is a genuine fake and the ONLY thing blocked. Unpinned
     * / unknown are allowed (and logged) so capture proceeds while pins are
     * gathered on a trusted device.
     */
    public static boolean isTrusted(Context ctx, String pkg) {
        return verify(ctx, pkg) != Result.MISMATCH;
    }

    /** The app's signing-certificate SHA-256 (uppercase hex), or null. */
    public static String signingSha256(Context ctx, String pkg) {
        try {
            PackageManager pm = ctx.getPackageManager();
            Signature[] sigs;
            if (Build.VERSION.SDK_INT >= 28) {
                PackageInfo info = pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES);
                if (info.signingInfo == null) return null;
                sigs = info.signingInfo.hasMultipleSigners()
                        ? info.signingInfo.getApkContentsSigners()
                        : info.signingInfo.getSigningCertificateHistory();
            } else {
                @SuppressWarnings("deprecation")
                PackageInfo info = pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES);
                sigs = info.signatures;
            }
            if (sigs == null || sigs.length == 0) return null;
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(sigs[0].toByteArray());
            StringBuilder sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                sb.append(String.format("%02X", b));
            }
            return sb.toString();
        } catch (Exception e) {
            Log.w(TAG, "signingSha256 failed for " + pkg + ": " + e.getMessage());
            return null;
        }
    }
}
