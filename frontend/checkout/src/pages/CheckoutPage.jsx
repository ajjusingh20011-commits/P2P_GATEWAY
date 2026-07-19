import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import { STRINGS } from '../utils/i18n';
import { getOrderIdFromUrl, upiLink, inr, fmtTimer, SUPPORT_WHATSAPP } from '../utils/order';
import { fetchCheckout, claimPaid, markCheckoutOpened } from '../services/api';
import { useOrderSocket } from '../hooks/useOrderSocket';

const STEP = {
  PAYMENT: 'payment',
  PROCESSING: 'processing',
  SUCCESS: 'success',
  EXPIRED: 'expired',
  FAILED: 'failed',
  REJECTED: 'rejected',
  DISPUTED: 'disputed',
  UNAVAILABLE: 'unavailable',
  ERROR: 'error',
};

// FTD green / STD blue pill shown next to the order id.
function DepositBadge({ type }) {
  if (!type) return null;
  const isFtd = type === 'FTD';
  return (
    <span
      className="ml-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold"
      style={isFtd ? { background: '#d1fae5', color: '#047857' } : { background: '#dbeafe', color: '#1d4ed8' }}
    >
      {type}
    </span>
  );
}

// ── Shared header: Exit · timer · Support ─────────────────────────────────
function TopBar({ t, remaining, showTimer = true }) {
  return (
    <div className="flex items-center justify-between px-1 py-3 text-sm">
      <button onClick={() => window.history.length > 1 ? window.history.back() : window.location.reload()} className="flex items-center gap-1 co-muted">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        {t.exit}
      </button>
      {showTimer ? (
        <span className="flex items-center gap-1.5 font-mono font-semibold" style={{ color: remaining <= 120 ? '#dc2626' : 'var(--text)' }}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
          {fmtTimer(remaining)}
        </span>
      ) : <span />}
      <a href={SUPPORT_WHATSAPP} target="_blank" rel="noreferrer" className="flex items-center gap-1 co-muted">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
        {t.support}
      </a>
    </div>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen py-4" style={{ background: 'var(--bg)' }}>
      <div className="mx-auto w-full max-w-md px-4">
        <div className="co-card">
          {children}
        </div>
        <p className="mt-4 text-center text-[11px]" style={{ color: 'var(--muted)' }}>Secured by P2P UPI Gateway</p>
      </div>
    </div>
  );
}

// ── Loading spinner (brief, while the order is fetched) ───────────────────
function LoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center p-16">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-gray-200" style={{ borderTopColor: 'var(--accent)' }} />
    </div>
  );
}

// ── UNAVAILABLE (order has no assigned UPI — should be rare now) ───────────
function UnavailableScreen({ t }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-100">
        <svg viewBox="0 0 24 24" className="h-11 w-11 text-amber-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" />
        </svg>
      </div>
      <h2 className="mt-6 text-xl font-bold" style={{ color: 'var(--text)' }}>Payment Unavailable</h2>
      <p className="mt-1 max-w-xs text-sm" style={{ color: 'var(--muted)' }}>P2P payment is unavailable for this order right now. Please contact the merchant.</p>
      <button onClick={() => (window.history.length > 1 ? window.history.back() : window.location.reload())} className="mt-6 w-full co-btn-primary py-3.5 font-semibold">
        {t.returnToStore}
      </button>
      <a href={SUPPORT_WHATSAPP} target="_blank" rel="noreferrer" className="mt-3 text-sm" style={{ color: 'var(--muted)' }}>
        {t.needHelp} <span className="font-semibold co-link">{t.contactSupport}</span>
      </a>
    </div>
  );
}

// ── Screen 2: PAYMENT (details + UTR) ─────────────────────────────────────
function PaymentScreen({ t, order, remaining, qrValue, utr, setUtr, utrError, proof, setProof, onContinue, onCancel }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(order.upiId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const downloadQr = () => {
    const svg = document.querySelector('#checkout-qr svg');
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `upi-qr-${order.shortId || 'order'}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-5">
      <TopBar t={t} remaining={remaining} />
      <h1 className="mt-2 text-center text-lg font-semibold" style={{ color: 'var(--text)' }}>{t.transferViaUpi}</h1>
      <div className="mt-1 text-center text-xs" style={{ color: 'var(--muted)' }}>
        {t.orderId}: <span className="font-mono" style={{ color: 'var(--text)' }}>{order.gatewayOrderId || order.shortId}</span>
        <DepositBadge type={order.depositType} />
        {' · '}<span className="font-semibold" style={{ color: 'var(--text)' }}>{inr(order.amountInr)}</span>
      </div>

      {/* QR + UPI details card */}
      <div className="co-inset mt-4 p-4">
        <div className="flex flex-col items-center">
          <div id="checkout-qr" className="co-tile p-3">
            <QRCode value={qrValue} size={168} bgColor="#ffffff" fgColor="#111827" />
          </div>
          <p className="mt-3 text-center text-xs" style={{ color: 'var(--muted)' }}>{t.scanOrCopy}</p>
          <button onClick={downloadQr} className="mt-2 flex items-center gap-1.5 text-xs font-semibold co-link hover:underline">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
            {t.downloadQr}
          </button>
        </div>

        {/* Account number (FULL upi id) */}
        <div className="co-tile mt-4 px-4 py-3">
          <p className="text-xs" style={{ color: 'var(--muted)' }}>{t.accountNumber}</p>
          <div className="mt-1 flex items-center justify-between gap-3">
            <p className="min-w-0 truncate font-semibold" style={{ color: 'var(--text)' }}>{order.upiId}</p>
            <button onClick={copy} className="flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition" style={copied ? { background: '#d1fae5', color: '#047857' } : { background: 'rgba(20,184,196,.1)', color: '#14b8c4' }}>
              {copied ? t.copied : `📋 ${t.copy}`}
            </button>
          </div>
        </div>

        {/* Payee + bank */}
        <div className="mt-2 grid grid-cols-2 gap-2">
          {order.payeeName && (
            <div className="co-tile px-4 py-3">
              <p className="text-xs" style={{ color: 'var(--muted)' }}>{t.payeeName}</p>
              <p className="mt-1 truncate font-semibold" style={{ color: 'var(--text)' }}>{order.payeeName}</p>
            </div>
          )}
          {order.bankName && (
            <div className="co-tile px-4 py-3">
              <p className="text-xs" style={{ color: 'var(--muted)' }}>{t.bankName}</p>
              <p className="mt-1 truncate font-semibold" style={{ color: 'var(--text)' }}>{order.bankName}</p>
            </div>
          )}
        </div>
      </div>

      {/* After paying — how do you want to confirm? */}
      <div className="co-inset mt-5 p-4">
        <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>I have made the payment</p>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>Choose how you want to confirm it:</p>

        <div className="mt-3 space-y-2">
          {[
            { key: 'utr', title: 'Enter UTR number', sub: 'Recommended — fastest verification' },
            { key: 'screenshot', title: 'Upload screenshot', sub: 'Visual proof of payment' },
            { key: 'no_proof', title: "I paid but can't provide proof", sub: '⚠ Verification may take longer' },
          ].map((o) => (
            <label
              key={o.key}
              className="flex cursor-pointer items-start gap-2.5 px-3 py-2.5"
              style={{
                borderRadius: 12,
                border: proof === o.key ? '1px solid var(--accent)' : '1px solid var(--input-border)',
                background: proof === o.key ? 'rgba(20,184,196,.06)' : 'transparent',
              }}
            >
              <input type="radio" name="proof" value={o.key} checked={proof === o.key} onChange={() => setProof(o.key)} className="mt-0.5" style={{ accentColor: 'var(--accent)' }} />
              <span className="min-w-0">
                <span className="block text-sm font-medium" style={{ color: 'var(--text)' }}>{o.title}</span>
                <span className="block text-xs" style={{ color: 'var(--muted)' }}>{o.sub}</span>
              </span>
            </label>
          ))}
        </div>

        {/* UTR input (only for the UTR option) */}
        {proof === 'utr' && (
          <div className="mt-3">
            <label className="text-sm font-medium" style={{ color: 'var(--text)' }}>{t.utrNumberLabel}</label>
            <input
              value={utr}
              onChange={(e) => setUtr(e.target.value.replace(/\s/g, ''))}
              inputMode="numeric"
              maxLength={22}
              placeholder={t.enterUtr}
              className={`mt-1.5 w-full px-4 py-3 text-sm outline-none ${utrError ? '' : 'co-input'}`}
              style={utrError ? { border: '1px solid #f87171', borderRadius: 12 } : undefined}
            />
            {utrError && <p className="mt-1 text-xs font-medium text-red-500">{utrError}</p>}
          </div>
        )}

        {/* Screenshot picker (placeholder — no file backend yet) */}
        {proof === 'screenshot' && (
          <div className="mt-3">
            <label className="text-sm font-medium" style={{ color: 'var(--text)' }}>Payment screenshot</label>
            <input type="file" accept="image/*" className="mt-1.5 w-full text-xs" style={{ color: 'var(--muted)' }} />
            <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>Your screenshot will be reviewed by our team.</p>
          </div>
        )}

        {proof === 'no_proof' && (
          <p className="mt-3 rounded-xl px-3 py-2.5 text-xs" style={{ background: '#fef3c7', color: '#92400e' }}>
            ⚠ Without a UTR or screenshot, verification may take longer.
          </p>
        )}
      </div>

      {/* Continue */}
      <button onClick={onContinue} className="mt-4 w-full co-btn-primary py-3.5 font-semibold">
        Submit Confirmation
      </button>
      <button onClick={onCancel} className="mt-3 block w-full text-center text-sm font-medium co-muted">
        {t.cancelPayment}
      </button>

      {/* How to pay */}
      <div className="co-inset mt-5 p-4">
        <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{t.howToPay}</p>
        <ol className="mt-2 space-y-2 text-xs" style={{ color: 'var(--muted)' }}>
          <li className="flex gap-2"><span>📷</span>{t.howStep1}</li>
          <li className="flex gap-2"><span>💳</span>{t.howStep2}</li>
          <li className="flex gap-2"><span>✅</span>{t.howStep3}</li>
        </ol>
      </div>
    </div>
  );
}

// ── Screen 3: PROCESSING ──────────────────────────────────────────────────
function ProcessingScreen({ t }) {
  return (
    <div className="flex flex-col items-center justify-center p-10 text-center">
      <div className="h-16 w-16 animate-spin rounded-full border-4 border-gray-200" style={{ borderTopColor: 'var(--accent)' }} />
      <h2 className="mt-6 text-lg font-semibold" style={{ color: 'var(--text)' }}>{t.processingTitle}</h2>
      <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>{t.processingSub}</p>
    </div>
  );
}

// ── Screen 4: SUCCESS ─────────────────────────────────────────────────────
function SuccessScreen({ t, order, txnRef }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100">
        <svg viewBox="0 0 24 24" className="h-12 w-12 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
      </div>
      <h2 className="mt-6 text-xl font-bold" style={{ color: 'var(--text)' }}>{t.success}</h2>
      <div className="co-inset mt-4 w-full space-y-2 p-4 text-left">
        <div className="flex justify-between text-sm"><span style={{ color: 'var(--muted)' }}>{t.amountPaid}</span><span className="font-semibold" style={{ color: 'var(--text)' }}>{inr(order.amountInr)}</span></div>
        {txnRef && <div className="flex justify-between text-sm"><span style={{ color: 'var(--muted)' }}>{t.txnRef}</span><span className="font-mono" style={{ color: 'var(--text)' }}>{txnRef}</span></div>}
        <div className="flex justify-between text-sm"><span style={{ color: 'var(--muted)' }}>{t.orderId}</span><span className="font-mono" style={{ color: 'var(--text)' }}>{order.gatewayOrderId || order.shortId || order.id}</span></div>
      </div>
      {order.redirectUrl ? (
        <a href={order.redirectUrl} className="mt-6 block w-full co-btn-primary py-3.5 text-center font-semibold">
          {t.returnMerchant}
        </a>
      ) : (
        <button onClick={() => window.location.reload()} className="mt-6 w-full co-btn-primary py-3.5 font-semibold">
          {t.returnMerchant}
        </button>
      )}
    </div>
  );
}

// ── REJECTED (admin declined the claim) ───────────────────────────────────
function RejectedScreen({ t, order }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-100">
        <svg viewBox="0 0 24 24" className="h-12 w-12 text-red-600" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
      </div>
      <h2 className="mt-6 text-xl font-bold" style={{ color: 'var(--text)' }}>Payment not verified</h2>
      <p className="mt-1 max-w-xs text-sm" style={{ color: 'var(--muted)' }}>
        {order?.rejectionReason || 'We could not verify this payment. If you believe this is a mistake, contact support.'}
      </p>
      <a href={SUPPORT_WHATSAPP} target="_blank" rel="noreferrer" className="mt-6 block w-full co-btn-primary py-3.5 text-center font-semibold">
        {t.contactSupport}
      </a>
    </div>
  );
}

// ── DISPUTED (under investigation) ────────────────────────────────────────
function DisputedScreen({ t, order }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-100">
        <svg viewBox="0 0 24 24" className="h-11 w-11 text-amber-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" />
        </svg>
      </div>
      <h2 className="mt-6 text-xl font-bold" style={{ color: 'var(--text)' }}>Under review</h2>
      <p className="mt-1 max-w-xs text-sm" style={{ color: 'var(--muted)' }}>
        {order?.rejectionReason || 'This payment is being investigated by our team. We will update you shortly.'}
      </p>
      <a href={SUPPORT_WHATSAPP} target="_blank" rel="noreferrer" className="mt-6 text-sm" style={{ color: 'var(--muted)' }}>
        {t.needHelp} <span className="font-semibold co-link">{t.contactSupport}</span>
      </a>
    </div>
  );
}

// ── Screen 5: EXPIRED / FAILED / ERROR ────────────────────────────────────
function EndScreen({ t, title, sub }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-100">
        <svg viewBox="0 0 24 24" className="h-12 w-12 text-red-600" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
      </div>
      <h2 className="mt-6 text-xl font-bold" style={{ color: 'var(--text)' }}>{title}</h2>
      <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>{sub}</p>
      <button onClick={() => window.location.reload()} className="mt-6 w-full co-btn-primary py-3.5 font-semibold">
        {t.tryAgain}
      </button>
      <a href={SUPPORT_WHATSAPP} target="_blank" rel="noreferrer" className="mt-3 text-sm" style={{ color: 'var(--muted)' }}>
        {t.needHelp} <span className="font-semibold co-link">{t.contactSupport}</span>
      </a>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────
export default function CheckoutPage() {
  const orderId = useMemo(() => getOrderIdFromUrl(), []);
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(STEP.PAYMENT);
  const [remaining, setRemaining] = useState(600);
  const [txnRef, setTxnRef] = useState('');
  const [utr, setUtr] = useState('');
  const [utrError, setUtrError] = useState('');
  const [proof, setProof] = useState('utr'); // 'utr' | 'screenshot' | 'no_proof'
  const [errorMsg, setErrorMsg] = useState('');
  const lang = 'en';
  const t = STRINGS[lang];
  // Prevents polls from yanking the user out of an in-progress confirmation.
  const submittingRef = useRef(false);

  // Map a backend checkout view and pick the right screen. The trader is always
  // assigned BEFORE the order exists now, so a loaded order should have a UPI —
  // if it somehow doesn't, we show "unavailable" (no searching/polling).
  // Order System v2 status → screen.
  const applyOrder = useCallback((o) => {
    setOrder(o);
    if (o.remaining != null) setRemaining(o.remaining);

    if (o.status === 'success') { setTxnRef(o.utrNumber || utr || ''); setStep(STEP.SUCCESS); return; }
    if (o.status === 'failed') { setStep(STEP.EXPIRED); return; }
    if (o.status === 'rejected') { setStep(STEP.REJECTED); return; }
    if (o.status === 'disputed') { setStep(STEP.DISPUTED); return; }
    // Claimed but not yet settled → the "verifying your payment" screen.
    if (o.status === 'claimed_paid' || o.status === 'under_review' || submittingRef.current) { setStep(STEP.PROCESSING); return; }
    setStep(o.hasUpi ? STEP.PAYMENT : STEP.UNAVAILABLE);
  }, [utr]);

  // Load the real order. No mock/demo fallback.
  const load = useCallback(async () => {
    try {
      const o = await fetchCheckout(orderId);
      applyOrder(o);
    } catch (e) {
      setErrorMsg(e.message || 'Order not found');
      setStep(STEP.ERROR);
    } finally {
      setLoading(false);
    }
  }, [orderId, applyOrder]);

  useEffect(() => {
    if (!orderId) { setErrorMsg('No order ID found in URL'); setStep(STEP.ERROR); setLoading(false); return; }
    // Tell the backend the customer opened the checkout (pending → checkout_open),
    // then load. Failure here must never block the page.
    markCheckoutOpened(orderId).catch(() => {}).finally(load);
  }, [orderId, load]);

  // Poll every 5s on the payment/processing screens so the page advances when
  // the customer's payment is confirmed (paid → confirmed) or the order expires.
  // (There is NO "searching" polling — the trader is assigned before creation.)
  useEffect(() => {
    if (!orderId) return undefined;
    if (![STEP.PAYMENT, STEP.PROCESSING].includes(step)) return undefined;
    const id = setInterval(() => {
      fetchCheckout(orderId).then(applyOrder).catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, [step, orderId, applyOrder]);

  // Countdown — expire when it hits zero (except on terminal/awaiting screens).
  // Once the customer has claimed payment we stop expiring: it now waits on an admin.
  useEffect(() => {
    if ([STEP.SUCCESS, STEP.EXPIRED, STEP.FAILED, STEP.REJECTED, STEP.DISPUTED, STEP.PROCESSING, STEP.ERROR].includes(step)) return undefined;
    if (remaining <= 0) { setStep(STEP.EXPIRED); return undefined; }
    const id = setInterval(() => setRemaining((r) => r - 1), 1000);
    return () => clearInterval(id);
  }, [step, remaining]);

  // Real-time socket updates (no need to wait for the next poll).
  useOrderSocket(orderId, (status) => {
    if (status === 'success' || status === 'confirmed') { setTxnRef(utr); setStep(STEP.SUCCESS); }
    else if (status === 'failed' || status === 'expired') setStep(STEP.EXPIRED);
    else if (status === 'rejected') { fetchCheckout(orderId).then(applyOrder).catch(() => setStep(STEP.REJECTED)); }
    else if (status === 'disputed') { fetchCheckout(orderId).then(applyOrder).catch(() => setStep(STEP.DISPUTED)); }
    else if (status === 'claimed_paid' || status === 'under_review') setStep(STEP.PROCESSING);
    else fetchCheckout(orderId).then(applyOrder).catch(() => {});
  });

  const qrValue = useMemo(() => {
    if (!order) return '';
    return order.qrData || upiLink({ upiId: order.upiId, payeeName: order.payeeName, amountInr: order.amountInr, id: order.id });
  }, [order]);

  // Submit the claim with the chosen proof. UTR is validated only when the
  // customer picked the UTR option; the other two submit without a reference.
  const onContinue = useCallback(async () => {
    const clean = utr.trim();
    if (proof === 'utr') {
      if (!clean) { setUtrError(t.utrRequired); return; }
      if (clean.length < 12) { setUtrError(t.utrInvalid); return; }
    }
    setUtrError('');
    submittingRef.current = true;
    setStep(STEP.PROCESSING);
    try {
      await claimPaid(orderId, { utrNumber: proof === 'utr' ? clean : undefined, confirmationType: proof });
    } catch (_) {
      // Backend will still reflect via polling; keep processing.
    }
  }, [utr, proof, orderId, t]);

  const onCancel = useCallback(() => {
    if (window.confirm('Cancel this payment and return to the store?')) window.location.reload();
  }, []);

  if (loading) return <Shell><LoadingScreen /></Shell>;
  if (step === STEP.ERROR) {
    return <Shell><EndScreen t={t} title="Unable to load payment" sub={errorMsg} /></Shell>;
  }
  if (step === STEP.UNAVAILABLE) {
    return <Shell><UnavailableScreen t={t} /></Shell>;
  }
  if (step === STEP.PAYMENT && order) {
    return (
      <Shell>
        <PaymentScreen
          t={t}
          order={order}
          remaining={remaining}
          qrValue={qrValue}
          utr={utr}
          setUtr={setUtr}
          utrError={utrError}
          proof={proof}
          setProof={setProof}
          onContinue={onContinue}
          onCancel={onCancel}
        />
      </Shell>
    );
  }
  if (step === STEP.PROCESSING) return <Shell><ProcessingScreen t={t} /></Shell>;
  if (step === STEP.SUCCESS && order) return <Shell><SuccessScreen t={t} order={order} txnRef={txnRef} /></Shell>;
  if (step === STEP.REJECTED) return <Shell><RejectedScreen t={t} order={order} /></Shell>;
  if (step === STEP.DISPUTED) return <Shell><DisputedScreen t={t} order={order} /></Shell>;
  if (step === STEP.EXPIRED) return <Shell><EndScreen t={t} title={t.expiredTitle} sub={t.expiredSub} /></Shell>;
  if (step === STEP.FAILED) return <Shell><EndScreen t={t} title={t.failedTitle} sub={t.failedSub} /></Shell>;

  return <Shell><UnavailableScreen t={t} /></Shell>;
}
