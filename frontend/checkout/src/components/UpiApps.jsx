import { useEffect, useRef, useState } from 'react';
import { upiLink, phonepeNativeLink, paytmCashWalletLink } from '../utils/order';

/**
 * UPI app launchers.
 *
 * PhonePe and Paytm are rendered, each using its own user-tested native
 * route (utils/order.js), launched via a hidden iframe (see `openNative`):
 *   PhonePe -> phonepeNativeLink()    phonepe://native?data=<base64 JSON>
 *   Paytm   -> paytmCashWalletLink()  paytmmp://cash_wallet?...money_transfer
 *
 * Google Pay is DELIBERATELY NOT RENDERED (`verified: false` below). Its
 * entry still points at the app-proprietary `tez://upi/pay` scheme carrying
 * generic UPI query params via `upiLink()` — the same shape that produced
 * "Payment failed as per UPI risk policy" in Paytm on a real device while
 * paying the very same VPA by hand succeeded. Do not flip `verified` to
 * `true` for it without a confirmed-working native route, the way PhonePe's
 * and Paytm's were confirmed: swapping the scheme alone is exactly what was
 * already tried and failed.
 *
 * The two native payloads use DIFFERENT amount units — PhonePe integer paise,
 * Paytm decimal rupees. Each builder converts from rupees itself; never pass
 * one builder's output to the other.
 *
 * These are ACTIONS, not decoration: each verified button builds a real
 * payment link from the order's *assigned* payment details. Nothing is
 * hardcoded — payee, amount and note all come from the order the backend
 * returned.
 *
 * Launching an app proves nothing about payment, so `onLaunch` only tells the
 * page the customer left for an app. Payment state is never touched here.
 *
 * Marks are brand-tinted glyphs rather than the official logos — shipping those
 * needs licensed assets the repo doesn't have.
 */

const APPS = [
  {
    key: 'gpay',
    label: 'Google Pay',
    scheme: 'gpay',
    verified: false, // unverified native route — see file header
    Icon: () => (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.3-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4z" />
        <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" />
        <path fill="#FBBC05" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14z" />
        <path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.4L6.4 10c.8-2.3 3-4.1 5.6-4.1z" />
      </svg>
    ),
  },
  {
    key: 'phonepe',
    label: 'PhonePe',
    scheme: 'phonepe',
    verified: true, // native P2P/chat route — see openNative below
    // Drawn, not <text> — SVG text leaks into the button's accessible name.
    Icon: () => (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect width="24" height="24" rx="6" fill="#5F259F" />
        <g stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M8.2 7.4h7.6M8.2 10.5h7.6" />
          <path d="M9 7.4c3.3 0 5.2 1.2 5.2 3.1s-1.9 3.1-5.2 3.1h-.8l6.4 5.6" />
        </g>
      </svg>
    ),
  },
  {
    key: 'paytm',
    label: 'Paytm',
    scheme: 'paytm',
    verified: true, // native money-transfer route — see openNative below
    Icon: () => (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect width="24" height="24" rx="6" fill="#00BAF2" />
        <path
          d="M9 17V7h3a3 3 0 0 1 0 6H9"
          stroke="#fff"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    ),
  },
];

// Only verified routes are ever shown — see the file header for why GPay is
// excluded rather than wired to its old (failing) generic-scheme link.
const VISIBLE_APPS = APPS.filter((app) => app.verified);

export default function UpiApps({ order, disabled, onLaunch }) {
  const [failed, setFailed] = useState(null); // label of an app that didn't open
  const leftRef = useRef(false);
  const timerRef = useRef(null);
  // The hidden launcher iframe, shared by every native route (PhonePe and
  // Paytm today). Tracked so a second tap removes the previous one before
  // creating another, and so unmount always cleans up rather than leaving a
  // stale iframe behind.
  const frameRef = useRef(null);

  const removeLauncherFrame = () => {
    if (frameRef.current) {
      frameRef.current.remove();
      frameRef.current = null;
    }
  };

  // If the browser backgrounds us, an app really did take over.
  useEffect(() => {
    const mark = () => {
      if (document.visibilityState === 'hidden') leftRef.current = true;
    };
    document.addEventListener('visibilitychange', mark);
    window.addEventListener('pagehide', mark);
    return () => {
      document.removeEventListener('visibilitychange', mark);
      window.removeEventListener('pagehide', mark);
      if (timerRef.current) clearTimeout(timerRef.current);
      removeLauncherFrame();
    };
  }, []);

  // A verified native route — launched via a hidden iframe, synchronously
  // inside the click handler (required for the app to pick up the custom
  // scheme on a user gesture). Never auto-launched on page load, and never
  // behind an awaited request: the URI is built from data the page already
  // holds, so nothing defers the navigation out of the gesture.
  //
  // Shared by PhonePe and Paytm. Each supplies its own URI builder; the
  // handoff mechanics below are identical and deliberately not duplicated.
  const openNative = (app, uri) => {
    onLaunch?.(app.key);

    removeLauncherFrame();
    const frame = document.createElement('iframe');
    frame.style.display = 'none';
    frame.src = uri;
    document.body.appendChild(frame);
    frameRef.current = frame;

    // Still here and never backgrounded → the scheme wasn't handled.
    timerRef.current = setTimeout(() => {
      if (!leftRef.current && document.visibilityState === 'visible') setFailed(app.label);
    }, 1400);
  };

  // The old generic-UPI-scheme route. Unreachable today (VISIBLE_APPS only
  // contains verified apps, and GPay is the sole unverified one), kept only so
  // a future verified GPay route has a launch mechanism to drop into — though
  // note it is the mechanism that FAILED, so a real GPay fix will almost
  // certainly supply its own native builder and use openNative instead.
  const openGenericScheme = (app) => {
    const link = upiLink(
      {
        upiId: order.upiId,
        payeeName: order.payeeName,
        amountInr: order.amountInr,
        id: order.gatewayOrderId || order.shortId || order.id,
      },
      app.scheme,
    );

    onLaunch?.(app.key);

    try {
      window.location.href = link;
    } catch (_) {
      setFailed(app.label);
      return;
    }

    timerRef.current = setTimeout(() => {
      if (!leftRef.current && document.visibilityState === 'visible') setFailed(app.label);
    }, 1400);
  };

  const open = (app) => {
    if (disabled || !order?.upiId) return;
    setFailed(null);
    leftRef.current = false;

    if (app.key === 'phonepe') {
      openNative(app, phonepeNativeLink({
        upiId: order.upiId,
        amountInr: order.amountInr,
      }));
    } else if (app.key === 'paytm') {
      openNative(app, paytmCashWalletLink({
        upiId: order.upiId,
        payeeName: order.payeeName,
        amountInr: order.amountInr,
      }));
    } else {
      openGenericScheme(app);
    }
  };

  return (
    <>
      <div className="co-apps">
        {VISIBLE_APPS.map((app) => (
          <button key={app.key} type="button" className="co-app" onClick={() => open(app)} disabled={disabled}>
            <app.Icon />
            {app.label}
          </button>
        ))}
      </div>
      {failed && (
        <p className="co-appNote">
          Couldn’t open {failed}. It may not be installed — scan the QR above, or copy the UPI ID into any UPI app.
        </p>
      )}
    </>
  );
}
