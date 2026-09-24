import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import { STRINGS } from '../utils/i18n';
import { getOrderIdFromUrl, upiLink, inr, fmtTimer, SUPPORT_WHATSAPP } from '../utils/order';
import { fetchCheckout, claimPaid, markCheckoutOpened, cancelOrder, requestNewUpi, uploadReceipt } from '../services/api';
import { useOrderSocket } from '../hooks/useOrderSocket';
import { isJunkUtr } from '../utils/utrValidation';
import UpiApps from '../components/UpiApps';

/*
 * MaxPay checkout.
 *
 * This file was redesigned visually; the payment logic underneath is the
 * existing one. Specifically unchanged: the backend status → screen mapping in
 * `applyOrder`, the 3s poll, the socket subscription, `claimPaid` (with its
 * confirmation_type + 422 re-prompt), `cancelOrder`, `markCheckoutOpened`, and
 * the countdown, which is derived from the order's `expires_at` and re-synced
 * from the server on every poll — never from a client-side clock of its own.
 */

// TESTING ONLY — DO NOT ENABLE IN PRODUCTION. These trust marks were
// deliberately removed because there is no evidence this platform holds the
// relevant NPCI/UPI certifications. Displaying them without certification is
// a real compliance risk. This flag must default to false and must never be
// true outside local testing.
const SHOW_TEST_ONLY_TRUST_MARKS = false;

const STEP = {
  PAYMENT: 'payment',
  PROCESSING: 'processing',
  REVIEW: 'review',
  SUCCESS: 'success',
  EXPIRED: 'expired',
  FAILED: 'failed',
  REJECTED: 'rejected',
  DISPUTED: 'disputed',
  UNAVAILABLE: 'unavailable',
  ERROR: 'error',
};

/* ── Icons ────────────────────────────────────────────────────────────────── */
const I = {
  close: () => (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
  ),
  clock: () => (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l2.8 1.7" /></svg>
  ),
  support: () => (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 13a8 8 0 0 1 16 0" /><path d="M4 13v3a2 2 0 0 0 2 2h1v-5H6a2 2 0 0 0-2 2zM20 13v3a2 2 0 0 1-2 2h-1v-5h1a2 2 0 0 1 2 2z" /></svg>
  ),
  copy: () => (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
  ),
  check: (size = 13) => (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
  ),
  warn: () => (
    <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4.5M12 17h.01" /></svg>
  ),
  clockBig: () => (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.2 2" /></svg>
  ),
  globe: () => (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" /></svg>
  ),
  paperclip: () => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.5 12.6 21a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.4a1.7 1.7 0 0 1-2.3-2.3l7.8-7.8" /></svg>
  ),
  rotate: () => (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" /><path d="M3 21v-5h5" /></svg>
  ),
  cross: () => (
    <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
  ),
  attach: () => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
  ),
  play: () => (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
  ),
  info: () => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
  ),
};

/* ── Header — the SAME timer instance for every screen ────────────────────── */
function Header({ t, remaining, showTimer = true, onExit }) {
  return (
    <header className="co-head">
      <button type="button" className="co-headBtn" onClick={onExit} aria-label={t.exit}>
        <I.close />
      </button>
      <span className="co-brand">
        <b>M</b>
        MaxPay
      </span>
      {/* Absolutely positioned so the timer sits at the true centre of the
          viewport, not merely between the left and right clusters. */}
      {showTimer && (
        <span className="co-headCenter">
          <span className={`co-timer ${remaining <= 120 ? 'urgent' : ''}`}>
            <I.clock />
            {fmtTimer(remaining)}
          </span>
        </span>
      )}
      <span className="co-headRight">
        <a className="co-support" href={SUPPORT_WHATSAPP} target="_blank" rel="noreferrer">
          <I.support />
          {t.support}
        </a>
      </span>
    </header>
  );
}

/**
 * Shared footer. Deliberately carries NO PCI DSS / NPCI / UPI marks: nothing in
 * this repo evidences that MaxPay holds those certifications or authorisations,
 * and rendering them would assert compliance the product may not have.
 */
function FootBar({ lang, setLang, open, setOpen }) {
  return (
    <div className={`co-footBar ${SHOW_TEST_ONLY_TRUST_MARKS ? 'withMarks' : ''}`}>
      {SHOW_TEST_ONLY_TRUST_MARKS && (
        <div className="co-footMarks">
          <span className="co-npci">NPCI</span>
          <span className="co-upiMark">UPI</span>
        </div>
      )}
      <div className="co-lang">
        {open && (
          <div className="co-langMenu" role="menu">
            {[['en', 'English'], ['hi', 'हिन्दी']].map(([code, label]) => (
              <button
                key={code}
                type="button"
                className={lang === code ? 'active' : ''}
                onClick={() => { setLang(code); localStorage.setItem('mp-lang', code); setOpen(false); }}
              >
                {label}
                {lang === code && I.check(12)}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="co-langBtn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {I.globe()}
          {lang === 'hi' ? 'हिन्दी' : 'English'}
          <span aria-hidden="true">▾</span>
        </button>
      </div>
    </div>
  );
}

function Page({ children }) {
  return (
    <div className="co-page">
      <div className="co-frame">{children}</div>
    </div>
  );
}

/* ── Waiting for a payment account to be attached ─────────────────────────── */
function FindingScreen({ t, remaining, amountInr, label, onExit }) {
  return (
    <Page>
      <Header t={t} remaining={remaining} showTimer={remaining != null} onExit={onExit} />
      <div className="co-state">
        {amountInr != null && <p className="co-stateAmount" style={{ marginTop: 0 }}>{inr(amountInr)}</p>}
        <div className="co-bigSpin" style={{ margin: '22px 0 4px' }} />
        <p className="co-stateSub">{label}</p>
      </div>
    </Page>
  );
}

/* ── Terminal / informational states ──────────────────────────────────────── */
function StateScreen({ t, tone = '', icon, title, sub, amount, refId, action, onExit, remaining, showTimer = false }) {
  return (
    <Page>
      <Header t={t} remaining={remaining} showTimer={showTimer} onExit={onExit} />
      <div className="co-state">
        <div className={`co-stateIcon ${tone}`}>{icon}</div>
        <h1 className="co-stateTitle">{title}</h1>
        {sub && <p className="co-stateSub">{sub}</p>}
        {amount != null && <p className="co-stateAmount">{inr(amount)}</p>}
        {refId && (
          <p className="co-ref">
            {t.orderId} <code>{refId}</code>
          </p>
        )}
      </div>
      {action && (
        <div className="co-cta">
          <div className="co-ctaInner">{action}</div>
        </div>
      )}
    </Page>
  );
}

/* ── UTR bottom sheet ─────────────────────────────────────────────────────── */
function UtrSheet({ t, utr, setUtr, utrError, busy, onSubmit, onNoProof, onClose }) {
  return (
    <div className="co-sheetBackdrop" onMouseDown={onClose}>
      <div className="co-sheet" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="co-sheetHead">
          <h2>Payment confirmation</h2>
          <button type="button" className="co-headBtn" onClick={onClose} aria-label="Close">
            <I.close />
          </button>
        </div>

        <label className="co-label" htmlFor="co-utr">{t.utrNumberLabel}</label>
        <input
          id="co-utr"
          className={`co-input ${utrError ? 'bad' : ''}`}
          value={utr}
          onChange={(e) => setUtr(e.target.value.replace(/\s/g, ''))}
          inputMode="numeric"
          maxLength={22}
          autoFocus
          placeholder={t.enterUtr}
        />
        {utrError && <p className="co-err">{utrError}</p>}

        <button type="button" className="co-btn co-sheetBtn" onClick={onSubmit} disabled={busy}>
          {busy ? <><span className="co-spin" />Submitting…</> : 'Confirm payment'}
        </button>

        <div className="co-linkRow">
          <button type="button" className="co-link" onClick={onNoProof} disabled={busy}>
            I don’t have a UTR number
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Status page shared by processing / review / success / failed / expired.
 * Every one of them keeps the SAME header timer and the same order context —
 * nothing is recreated when the screen changes.
 */
function StatusPage({ t, tone, icon, title, sub, amount, rows, actions, note, extra, remaining, showTimer, onExit, lang, setLang, langOpen, setLangOpen }) {
  return (
    <Page>
      <Header t={t} remaining={remaining} showTimer={showTimer} onExit={onExit} />
      <div className="co-statePage">
        <div className="co-stateBody">
          <div className="co-stateCard">
            <div className={`co-stateIcon ${tone || ''}`} style={{ margin: '0 auto 6px' }}>{icon}</div>
            <h1 className="co-stateTitle">{title}</h1>
            {amount != null && <p className="co-stateAmount" style={{ marginTop: 8 }}>{inr(amount)}</p>}
            {sub && <p className="co-stateSub" style={{ margin: '8px auto 0' }}>{sub}</p>}
            {rows && rows.length > 0 && (
              <div className="co-kv">
                {rows.map((r) => (
                  <div key={r.k}>
                    <small>{r.k}</small>
                    <strong>{r.v}</strong>
                  </div>
                ))}
              </div>
            )}
            {note && <p className="co-noteLine">{note}</p>}
            {extra}
            {actions && <div className="co-stateActions">{actions}</div>}
          </div>
        </div>
        <FootBar lang={lang} setLang={setLang} open={langOpen} setOpen={setLangOpen} />
      </div>
    </Page>
  );
}

/**
 * Optional receipt upload — real endpoint (POST /:id/receipt), never required
 * to complete the flow. "Remove" only resets this widget's local state to let
 * the customer pick a different file; it doesn't delete anything already
 * uploaded, since a receipt is supplementary evidence, never itself a
 * confirmation, so there's nothing unsafe about a stale file sitting unused.
 */
function ReceiptUpload({ status, fileName, error, onSelect, onRemove }) {
  return (
    <div className="co-receiptBox">
      <label htmlFor="co-receipt-file" className="co-receiptLabel">
        <input
          id="co-receipt-file"
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          style={{ display: 'none' }}
          onChange={onSelect}
          disabled={status === 'uploading'}
        />
        {status === 'uploaded' ? (
          <>
            <span className="co-checkMark">{I.check()}</span>
            <span className="co-receiptName">{fileName || 'Receipt attached'}</span>
            <button type="button" className="co-removeReceipt" onClick={(e) => { e.preventDefault(); onRemove(); }}>
              Remove
            </button>
          </>
        ) : status === 'uploading' ? (
          <>
            <span className="co-spin" />
            <span>Uploading…</span>
          </>
        ) : (
          <>
            {I.attach()}
            <span>Attach payment receipt</span>
            <span className="co-receiptNote">Optional · PNG, JPG or PDF, max 5MB</span>
          </>
        )}
      </label>
      {error && <p className="co-err">{error}</p>}
    </div>
  );
}

/* ── Root ─────────────────────────────────────────────────────────────────── */
export default function CheckoutPage() {
  const orderId = useMemo(() => getOrderIdFromUrl(), []);
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(STEP.PAYMENT);
  const [remaining, setRemaining] = useState(600);
  const [txnRef, setTxnRef] = useState('');
  const [utr, setUtr] = useState('');
  const [utrError, setUtrError] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [launched, setLaunched] = useState(false); // customer opened a UPI app
  const [rotating, setRotating] = useState(false); // awaiting a replacement account
  const [rotateErr, setRotateErr] = useState('');
  const [amtCopied, setAmtCopied] = useState(false);
  const [noUtrAsk, setNoUtrAsk] = useState(false);   // "No UTR number?" confirm
  const [cancelAsk, setCancelAsk] = useState(false); // cancellation behind the X
  const [langOpen, setLangOpen] = useState(false);
  const [lang, setLang] = useState(() => (localStorage.getItem('mp-lang') === 'hi' ? 'hi' : 'en'));
  const [showHowToPay, setShowHowToPay] = useState(false);
  const [showHowToFindUtr, setShowHowToFindUtr] = useState(false);
  const [receiptStatus, setReceiptStatus] = useState('idle'); // idle | uploading | uploaded
  const [receiptFileName, setReceiptFileName] = useState('');
  const [receiptError, setReceiptError] = useState('');
  const t = STRINGS[lang] || STRINGS.en;
  // Prevents polls from yanking the user out of an in-progress confirmation.
  const submittingRef = useRef(false);
  // Mirrors `rotating` for synchronous re-entry checks (see getNewUpi).
  const rotatingRef = useRef(false);

  // Map a backend checkout view and pick the right screen (unchanged).
  const applyOrder = useCallback((o) => {
    setOrder(o);
    if (o.remaining != null) setRemaining(o.remaining);

    if (o.status === 'success') { setTxnRef(o.utrNumber || utr || ''); setStep(STEP.SUCCESS); return; }
    if (o.status === 'failed') { setStep(STEP.FAILED); return; }
    if (o.status === 'rejected') { setStep(STEP.REJECTED); return; }
    if (o.status === 'disputed') { setStep(STEP.DISPUTED); return; }
    // Two distinct real statuses, two distinct screens: `claimed_paid` is the
    // automatic matching window, `under_review` is a human/system hold.
    if (o.status === 'under_review') { setStep(STEP.REVIEW); return; }
    if (o.status === 'cancelled') { setStep(STEP.FAILED); return; }
    if (o.status === 'claimed_paid' || submittingRef.current) { setStep(STEP.PROCESSING); return; }
    // A replacement account has landed — stop showing "finding new details".
    if (o.hasUpi) setRotating(false);
    setStep(o.hasUpi ? STEP.PAYMENT : STEP.UNAVAILABLE);
  }, [utr]);

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
    markCheckoutOpened(orderId).catch(() => {}).finally(load);
  }, [orderId, load]);

  // Poll while the payment/processing screens are live (unchanged, 3s).
  useEffect(() => {
    if (!orderId) return undefined;
    if (![STEP.PAYMENT, STEP.PROCESSING, STEP.REVIEW, STEP.UNAVAILABLE].includes(step)) return undefined;
    const id = setInterval(() => {
      fetchCheckout(orderId).then(applyOrder).catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, [step, orderId, applyOrder]);

  // Countdown — ticks the server-provided `remaining`; each poll re-syncs it.
  useEffect(() => {
    if ([STEP.SUCCESS, STEP.EXPIRED, STEP.FAILED, STEP.REJECTED, STEP.DISPUTED, STEP.ERROR].includes(step)) return undefined;
    // Processing/review keep counting down (same order deadline) but must not
    // flip the customer to EXPIRED — the claim is already with the backend.
    if ((step === STEP.PROCESSING || step === STEP.REVIEW) && remaining <= 0) return undefined;
    if (remaining <= 0) { setStep(STEP.EXPIRED); return undefined; }
    const id = setInterval(() => setRemaining((r) => r - 1), 1000);
    return () => clearInterval(id);
  }, [step, remaining]);

  useOrderSocket(orderId, (status) => {
    if (status === 'success' || status === 'confirmed' || status === 'completed') { setTxnRef(utr); setStep(STEP.SUCCESS); }
    else if (status === 'failed') setStep(STEP.FAILED);
    else if (status === 'expired') setStep(STEP.EXPIRED);
    else if (status === 'rejected') { fetchCheckout(orderId).then(applyOrder).catch(() => setStep(STEP.REJECTED)); }
    else if (status === 'disputed') { fetchCheckout(orderId).then(applyOrder).catch(() => setStep(STEP.DISPUTED)); }
    else if (status === 'claimed_paid') setStep(STEP.PROCESSING);
    else if (status === 'under_review') setStep(STEP.REVIEW);
    else fetchCheckout(orderId).then(applyOrder).catch(() => {});
  });

  const qrValue = useMemo(() => {
    if (!order) return '';
    return order.qrData || upiLink({ upiId: order.upiId, payeeName: order.payeeName, amountInr: order.amountInr, id: order.id });
  }, [order]);

  const exit = useCallback(() => {
    if (order?.redirectUrl) { window.location.href = order.redirectUrl; return; }
    if (window.history.length > 1) window.history.back();
    else window.location.reload();
  }, [order]);

  // Copies the exact payable amount, not the formatted display string.
  const copyAmount = useCallback(() => {
    if (!order) return;
    navigator.clipboard?.writeText(String(order.amountInr)).catch(() => {});
    setAmtCopied(true);
    setTimeout(() => setAmtCopied(false), 1600);
  }, [order]);

  const copyUpi = useCallback(() => {
    if (!order?.upiId) return;
    navigator.clipboard?.writeText(order.upiId).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }, [order]);

  // Submit the claim. UTR is validated only for the 'utr' path (unchanged).
  const submitClaim = useCallback(async (confirmationType) => {
    const clean = utr.trim();
    if (confirmationType === 'utr') {
      if (!clean) { setUtrError(t.utrRequired); return; }
      if (clean.length < 12) { setUtrError(t.utrInvalid); return; }
      if (isJunkUtr(clean)) { setUtrError(t.utrJunk); return; }
    }
    setUtrError('');
    setBusy(true);
    submittingRef.current = true;
    try {
      await claimPaid(orderId, { utrNumber: confirmationType === 'utr' ? clean : undefined, confirmationType });
      setSheetOpen(false);
      setStep(STEP.PROCESSING);
    } catch (e) {
      // Server-side validation rejection goes back in front of the customer;
      // anything else just waits for the next poll, as before.
      if (confirmationType === 'utr' && e.status === 422) {
        submittingRef.current = false;
        setUtrError(e.message || t.utrJunk);
      } else {
        setSheetOpen(false);
        setStep(STEP.PROCESSING);
      }
    } finally {
      setBusy(false);
    }
  }, [utr, orderId, t]);

  // Existing reassignment endpoint — expiry is NOT reset by the backend.
  const getNewUpi = useCallback(async () => {
    // Ref, not the `rotating` state: setState is async, so a double-tap can run
    // this handler twice off the same stale closure before React re-renders and
    // disables the button — that would fire two reassignments.
    if (rotatingRef.current) return;
    rotatingRef.current = true;
    setRotateErr('');
    setRotating(true);
    try {
      await requestNewUpi(orderId);
      const o = await fetchCheckout(orderId);
      applyOrder(o);
    } catch (e) {
      setRotating(false);
      setRotateErr(e.message || 'Could not get a new payment account right now.');
    } finally {
      rotatingRef.current = false;
    }
  }, [orderId, applyOrder]);

  // Reflects a receipt already on file (e.g. the page was reloaded after a
  // successful upload) without clobbering an upload currently in progress.
  // `receiptClearedRef` stops this from immediately re-flipping the widget
  // back to "uploaded" the instant the user hits Remove: there's no delete
  // endpoint, so the server keeps reporting hasReceipt:true forever after a
  // real upload, and this effect re-runs on every poll (hasReceipt is a
  // stable `true`, but `receiptStatus` — the OTHER dependency — flips to
  // 'idle' the moment Remove sets it, immediately re-triggering the effect).
  const receiptClearedRef = useRef(false);
  useEffect(() => {
    if (order?.hasReceipt && receiptStatus === 'idle' && !receiptClearedRef.current) {
      setReceiptStatus('uploaded');
      setReceiptFileName('Receipt on file');
    }
  }, [order?.hasReceipt, receiptStatus]);

  const handleReceiptSelect = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // lets the same file be re-picked after Remove
    if (!file) return;
    setReceiptError('');
    setReceiptStatus('uploading');
    try {
      await uploadReceipt(orderId, file);
      receiptClearedRef.current = false; // a real upload landed — future syncs may reflect it again
      setReceiptFileName(file.name);
      setReceiptStatus('uploaded');
    } catch (err) {
      setReceiptStatus('idle');
      setReceiptError(err.message || 'Could not upload the receipt. Please try again.');
    }
  }, [orderId]);

  const handleReceiptRemove = useCallback(() => {
    receiptClearedRef.current = true;
    setReceiptStatus('idle');
    setReceiptFileName('');
    setReceiptError('');
  }, []);

  const onCancel = useCallback(async () => {
    setCancelAsk(false);
    try {
      await cancelOrder(orderId);
      window.location.reload();
    } catch (e) {
      window.alert(e.message || 'This order can no longer be cancelled.');
    }
  }, [orderId]);

  /* ── Render ─────────────────────────────────────────────────────────────── */

  if (loading) {
    return <FindingScreen t={t} remaining={remaining} label="Loading your payment…" onExit={exit} />;
  }

  if (step === STEP.ERROR) {
    return (
      <StateScreen
        t={t}
        tone="err"
        icon={I.cross()}
        title="Unable to load payment"
        sub={errorMsg}
        onExit={exit}
        action={<button type="button" className="co-btn" onClick={() => window.location.reload()}>{t.tryAgain}</button>}
      />
    );
  }

  // No payment account attached yet (initial, or while a replacement is fetched).
  if (step === STEP.UNAVAILABLE || rotating) {
    return (
      <FindingScreen
        t={t}
        remaining={remaining}
        amountInr={order?.amountInr}
        label={rotating ? 'Finding new payment details…' : 'Finding payment details…'}
        onExit={exit}
      />
    );
  }

  // `utr` covers the gap between submitting and the next poll echoing it back.
  const submittedUtr = order?.utrNumber || utr || txnRef || '';
  const orderRef = order?.gatewayOrderId || order?.shortId || order?.id || '';
  const langProps = { lang, setLang, langOpen, setLangOpen };

  if (step === STEP.PROCESSING) {
    return (
      <StatusPage
        t={t}
        icon={<div className="co-pulse" />}
        title="Checking your payment"
        amount={order?.amountInr}
        sub={
          submittedUtr
            ? 'We’re verifying your payment. This may take a moment.'
            : 'We’re looking for your payment using the available transaction information.'
        }
        rows={[
          ...(submittedUtr ? [{ k: 'UTR', v: submittedUtr }] : []),
          { k: 'Order', v: orderRef },
        ]}
        note="You can attach a payment receipt for extra evidence once this moves to manual review."
        remaining={remaining}
        showTimer
        onExit={exit}
        {...langProps}
      />
    );
  }

  if (step === STEP.REVIEW) {
    return (
      <StatusPage
        t={t}
        tone="warn"
        icon={I.warn()}
        title="Payment under review"
        amount={order?.amountInr}
        sub="We’re checking this payment. No action is required unless we ask for more information."
        rows={[
          { k: 'Reference', v: orderRef },
          ...(submittedUtr ? [{ k: 'UTR', v: submittedUtr }] : []),
        ]}
        extra={
          <ReceiptUpload
            status={receiptStatus}
            fileName={receiptFileName}
            error={receiptError}
            onSelect={handleReceiptSelect}
            onRemove={handleReceiptRemove}
          />
        }
        actions={
          <>
            <a className="co-btn ghost" href={SUPPORT_WHATSAPP} target="_blank" rel="noreferrer">{t.contactSupport}</a>
            {order?.redirectUrl && <a className="co-btn" href={order.redirectUrl}>{t.returnMerchant}</a>}
          </>
        }
        remaining={remaining}
        showTimer={remaining > 0}
        onExit={exit}
        {...langProps}
      />
    );
  }

  if (step === STEP.SUCCESS && order) {
    return (
      <StatusPage
        t={t}
        tone="ok"
        icon={I.check(28)}
        title="Payment confirmed"
        amount={order.amountInr}
        sub="Your payment has been verified successfully."
        rows={[
          ...(submittedUtr ? [{ k: 'UTR', v: submittedUtr }] : []),
          { k: 'Order', v: orderRef },
        ]}
        actions={
          order.redirectUrl
            ? <a className="co-btn" href={order.redirectUrl}>{t.returnMerchant}</a>
            : <button type="button" className="co-btn" onClick={exit}>{t.returnMerchant}</button>
        }
        remaining={remaining}
        showTimer={false}
        onExit={exit}
        {...langProps}
      />
    );
  }

  if (step === STEP.REJECTED || step === STEP.FAILED) {
    return (
      <StatusPage
        t={t}
        tone="err"
        icon={I.warn()}
        title="Payment not confirmed"
        amount={order?.amountInr}
        sub={order?.rejectionReason || 'We couldn’t verify this payment.'}
        rows={[
          { k: 'Order', v: orderRef },
          ...(submittedUtr ? [{ k: 'UTR', v: submittedUtr }] : []),
        ]}
        actions={
          <>
            <a className="co-btn ghost" href={SUPPORT_WHATSAPP} target="_blank" rel="noreferrer">{t.contactSupport}</a>
            {order?.redirectUrl && <a className="co-btn" href={order.redirectUrl}>{t.returnMerchant}</a>}
          </>
        }
        note="A new payment must be started from the merchant — this order can’t be reused."
        remaining={remaining}
        showTimer={false}
        onExit={exit}
        {...langProps}
      />
    );
  }

  if (step === STEP.DISPUTED) {
    return (
      <StatusPage
        t={t}
        tone="warn"
        icon={I.warn()}
        title="Payment under review"
        amount={order?.amountInr}
        sub={order?.rejectionReason || 'This payment is being checked by our team. No action is required unless we ask for more information.'}
        rows={[{ k: 'Reference', v: orderRef }, ...(submittedUtr ? [{ k: 'UTR', v: submittedUtr }] : [])]}
        actions={<a className="co-btn ghost" href={SUPPORT_WHATSAPP} target="_blank" rel="noreferrer">{t.contactSupport}</a>}
        remaining={remaining}
        showTimer={false}
        onExit={exit}
        {...langProps}
      />
    );
  }

  if (step === STEP.EXPIRED) {
    return (
      <>
        <StatusPage
          t={t}
          tone="warn"
          icon={I.clockBig()}
          title="Payment session expired"
          sub="The payment window for this order has ended."
          rows={[{ k: 'Order', v: orderRef }]}
          actions={
            <>
              {/* Late-payer recovery: claim-paid still accepts a UTR for an
                  order the customer actually paid before the window closed. */}
              <button type="button" className="co-btn ghost" onClick={() => setSheetOpen(true)}>
                Already paid? Submit UTR
              </button>
              {order?.redirectUrl && <a className="co-btn" href={order.redirectUrl}>{t.returnMerchant}</a>}
            </>
          }
          remaining={0}
          showTimer={false}
          onExit={exit}
          {...langProps}
        />
        {sheetOpen && (
          <UtrSheet
            t={t}
            utr={utr}
            setUtr={setUtr}
            utrError={utrError}
            busy={busy}
            onSubmit={() => submitClaim('utr')}
            onNoProof={() => setNoUtrAsk(true)}
            onClose={() => { if (!busy) { setSheetOpen(false); setUtrError(''); } }}
          />
        )}
      </>
    );
  }

  if (step !== STEP.PAYMENT || !order) return null;

  const statusLine = launched
    ? { cls: '', node: <><span className="co-dot" />Waiting for confirmation</> }
    : { cls: 'neutral', node: <><span className="co-dot" />Waiting for payment</> };

  return (
    <>
      <Page>
        <Header t={t} remaining={remaining} onExit={() => setCancelAsk(true)} />

        <div className="co-scroll">
          <p className="co-payLabel">Pay</p>
          <div className="co-amountRow">
            <p className="co-amount">{inr(order.amountInr)}</p>
            <button
              type="button"
              className={`co-amtCopy ${amtCopied ? 'done' : ''}`}
              onClick={copyAmount}
              aria-label="Copy amount"
              title="Copy amount"
            >
              {amtCopied ? I.check() : I.copy()}
            </button>
          </div>
          {amtCopied && <p className="co-toast">✓ Amount copied</p>}
          <p className="co-orderId">
            <span>Order</span>
            <code>{order.gatewayOrderId || order.shortId}</code>
            {order.depositType && (
              <span
                className="co-chip"
                style={order.depositType === 'FTD' ? { background: '#d1fae5', color: '#047857' } : { background: '#dbeafe', color: '#1d4ed8' }}
              >
                {order.depositType}
              </span>
            )}
          </p>

          <div className="co-card">
            <div className="co-qrWrap">
              <div id="checkout-qr" className="co-qr">
                <QRCode value={qrValue} size={184} bgColor="#ffffff" fgColor="#111827" />
              </div>
              <p className="co-qrHint">Scan with any UPI app</p>
            </div>

            <div className="co-upiRow">
              <span className="co-upiVal">
                <small>{t.upiId}</small>
                <strong>{order.upiId}</strong>
              </span>
              <button type="button" className={`co-copy ${copied ? 'done' : ''}`} onClick={copyUpi}>
                {copied ? <>{I.check()}{t.copied}</> : <>{I.copy()}{t.copy}</>}
              </button>
            </div>

            <div className="co-upiRow co-payExact">
              <span className="co-upiVal">
                <small>Pay exactly</small>
                <strong>{inr(order.amountInr)}</strong>
              </span>
              <button type="button" className={`co-copy ${amtCopied ? 'done' : ''}`} onClick={copyAmount}>
                {amtCopied ? <>{I.check()}{t.copied}</> : <>{I.copy()}{t.copy}</>}
              </button>
            </div>

            <button type="button" className="co-rotate" onClick={getNewUpi} disabled={rotating}>
              {I.rotate()}
              Get new UPI ID
            </button>
            {rotateErr && <p className="co-appNote">{rotateErr}</p>}

            <p className="co-sectionLabel">Pay with</p>
            <UpiApps order={order} onLaunch={() => setLaunched(true)} />

            {/*
              "Watch how to deposit" is intentionally absent: utils/order.js only
              carries a placeholder HOW_TO_VIDEO, so there is no real tutorial to
              point at and wiring it would fabricate a help resource.
            */}

            <button
              type="button"
              className={`co-addUtr ${order.utrNumber || utr ? 'saved' : ''}`}
              onClick={() => setSheetOpen(true)}
            >
              {order.utrNumber || utr ? <>{I.check()}UTR added</> : <>+ Add UTR / Reference number</>}
            </button>

            <div className={`co-status ${statusLine.cls}`}>{statusLine.node}</div>

            <div className="co-guideRow">
              <button type="button" className="co-guide" onClick={() => setShowHowToPay(true)}>
                {I.play()} How to pay
              </button>
              <button type="button" className="co-guide" onClick={() => setShowHowToFindUtr(true)}>
                {I.info()} How to find UTR
              </button>
            </div>
          </div>

          {/* Inside the scroll area: .co-scroll reserves bottom padding for the
              fixed CTA, so the footer stays visible and clickable above it. */}
          <FootBar lang={lang} setLang={setLang} open={langOpen} setOpen={setLangOpen} />
        </div>
      </Page>

      <div className="co-cta">
        <div className="co-ctaInner">
          <button type="button" className="co-btn" onClick={() => setSheetOpen(true)}>
            {launched ? 'I’ve completed payment' : 'Confirm Payment'}
            <span className="co-btnTimer">· {fmtTimer(remaining)}</span>
          </button>
        </div>
      </div>

      {sheetOpen && (
        <UtrSheet
          t={t}
          utr={utr}
          setUtr={setUtr}
          utrError={utrError}
          busy={busy}
          onSubmit={() => submitClaim('utr')}
          onNoProof={() => setNoUtrAsk(true)}
          onClose={() => { if (!busy) { setSheetOpen(false); setUtrError(''); } }}
        />
      )}

      {/* Backed by claim-paid's `no_proof` confirmation_type — a real path. */}
      {noUtrAsk && (
        <div className="co-sheetBackdrop" onMouseDown={() => setNoUtrAsk(false)}>
          <div className="co-confirm" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3>No UTR number?</h3>
            <p>
              MaxPay can continue checking the payment using the available payment information.
              Confirmation may take longer.
            </p>
            <div className="co-confirmBtns">
              <button type="button" className="co-btn" disabled={busy} onClick={() => { setNoUtrAsk(false); submitClaim('no_proof'); }}>
                {busy ? <><span className="co-spin" />Submitting…</> : 'Continue without UTR'}
              </button>
              <button type="button" className="co-btn ghost" onClick={() => setNoUtrAsk(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {cancelAsk && (
        <div className="co-sheetBackdrop" onMouseDown={() => setCancelAsk(false)}>
          <div className="co-confirm" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3>Cancel this payment?</h3>
            <p>The order will be cancelled and you’ll be returned to the store.</p>
            <div className="co-confirmBtns">
              <button type="button" className="co-btn ghost" onClick={onCancel}>Cancel payment</button>
              <button type="button" className="co-btn" onClick={() => setCancelAsk(false)}>Keep paying</button>
            </div>
          </div>
        </div>
      )}

      {/* Static help content — no real data dependency, safe to show as-is. */}
      {showHowToPay && (
        <div className="co-sheetBackdrop" onMouseDown={() => setShowHowToPay(false)}>
          <div className="co-sheet" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="co-sheetHead">
              <h2>How to pay with UPI</h2>
              <button type="button" className="co-headBtn" onClick={() => setShowHowToPay(false)} aria-label="Close">
                <I.close />
              </button>
            </div>
            <div className="co-guideContent">
              <div className="co-guideStep">
                <div className="co-stepNum">1</div>
                <p><strong>Open your UPI app</strong></p>
                <p>Launch Google Pay, PhonePe, Paytm, or any UPI app installed on your phone.</p>
              </div>
              <div className="co-guideStep">
                <div className="co-stepNum">2</div>
                <p><strong>Scan the QR code</strong></p>
                <p>Look for the "Scan" or camera option, then point it at the QR code shown on this page.</p>
              </div>
              <div className="co-guideStep">
                <div className="co-stepNum">3</div>
                <p><strong>Enter your UPI PIN</strong></p>
                <p>Your app will show the amount and recipient. Verify it matches, then enter your UPI PIN to confirm.</p>
              </div>
              <div className="co-guideStep">
                <div className="co-stepNum">4</div>
                <p><strong>Confirm payment here</strong></p>
                <p>Once your app shows success, come back and tap the "Confirm Payment" button on this screen.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {showHowToFindUtr && (
        <div className="co-sheetBackdrop" onMouseDown={() => setShowHowToFindUtr(false)}>
          <div className="co-sheet" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="co-sheetHead">
              <h2>Find your UTR / Reference number</h2>
              <button type="button" className="co-headBtn" onClick={() => setShowHowToFindUtr(false)} aria-label="Close">
                <I.close />
              </button>
            </div>
            <div className="co-guideContent">
              <p className="co-guideSub">After you make a payment, your UPI app shows a reference or confirmation number. Look for:</p>
              <div className="co-guideStep">
                <strong>✓ UTR</strong>
                <p>Unique Transaction Reference (most common on UPI)</p>
              </div>
              <div className="co-guideStep">
                <strong>✓ Reference number</strong>
                <p>Some apps call it "Ref No" or "Transaction ID"</p>
              </div>
              <div className="co-guideStep">
                <strong>✓ TxnId</strong>
                <p>Transaction identifier (shown as a long string of numbers)</p>
              </div>
              <p className="co-guideSub" style={{ marginTop: 16 }}>Usually you'll see it in the success message or in your app's transaction history. Copy the entire number (no spaces) and paste it above.</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
