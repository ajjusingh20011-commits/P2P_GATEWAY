import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QrCode, Landmark, Check, ArrowRight, AlertTriangle, Copy } from 'lucide-react';
import { Card, Badge, Button, PageHeader, Modal, EmptyState, LoadingState } from '../components/ui';
import { traderApi } from '../services/api';
import { getPayoutEvidence } from '../lib/ngoApi';
import { evaluatePayoutMatch } from '../utils/payoutMatch';
import { inr } from '../utils/mock';

/*
  Buy USDT — the trader side of the merchant Payout-Request system.

  A merchant creates a payout; it lands in a global pool. This page lets the
  trader accept a request, process it (pay the recipient), mark it transferred,
  and track it through settlement / cancel / dispute. Money logic + all status
  transitions are enforced by the backend — this is the presentation layer.

  Real lifecycle (see backend/src/services/payoutService.js):
    awaiting_processing -> in_processing -> awaiting_settlement -> settlement_completed
    awaiting_processing -> canceled
    in_processing       -> canceled | dispute
    awaiting_settlement -> dispute
    dispute             -> settlement_completed | canceled
*/

const TABS = [
  { key: 'awaiting_processing', label: 'Awaiting' },
  { key: 'in_processing', label: 'Processing' },
  { key: 'awaiting_settlement', label: 'Settlement' },
  { key: 'settlement_completed', label: 'Completed' },
  { key: 'canceled', label: 'Canceled' },
  { key: 'dispute', label: 'Dispute' },
];

const STATUS_BADGE = {
  awaiting_processing: 'amber',
  in_processing: 'sky',
  awaiting_settlement: 'violet',
  settlement_completed: 'green',
  canceled: 'gray',
  dispute: 'red',
};

const short = (uuid, id) => (uuid ? String(uuid).split('-')[0].toUpperCase() : `#${id}`);

// BUG 4 — required cancellation reasons (dropdown). 'other' expects a note.
const CANCEL_REASONS = [
  { value: 'payment_failed', label: 'Payment failed / declined' },
  { value: 'wrong_recipient_details', label: 'Wrong recipient details' },
  { value: 'insufficient_funds', label: 'Insufficient funds in my account' },
  { value: 'app_or_upi_error', label: 'App / UPI error' },
  { value: 'suspected_fraud', label: 'Suspected fraud' },
  { value: 'other', label: 'Other (add a note below)' },
];
const reasonLabel = (code) => CANCEL_REASONS.find((r) => r.value === code)?.label
  || (code ? String(code).replace(/_/g, ' ') : '—');

function fmtDuration(ms) {
  if (ms == null || Number.isNaN(ms)) return '—';
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(sec).padStart(2, '0')}s`;
}

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())} · ${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

// A cell showing time since `from` (waiting) or countdown to `to` (deadline).
function Elapsed({ from, now }) {
  return <span>{fmtDuration(now - new Date(from).getTime())}</span>;
}
function Countdown({ to, now }) {
  const left = new Date(to).getTime() - now;
  const danger = left < 60 * 1000;
  return <span className="timer" style={{ color: danger ? undefined : 'var(--text)' }}>{left <= 0 ? 'expired' : fmtDuration(left)}</span>;
}

// Reference's .payout row is one generic template for every status; the real
// data varies meaningfully per status (exchange/payout rate while processing,
// credited amount + settle date once completed, the dispute reason while
// disputed) — folded into this row's secondary line instead of the separate
// per-tab table columns the old table used, so nothing real is dropped.
function subLine(r, tabKey, now) {
  if (tabKey === 'awaiting_processing') return <><Elapsed from={r.created_at} now={now} /> waiting</>;
  if (tabKey === 'in_processing') return <>Rate ₹{r.base_exchange_rate ?? '—'} → ₹{r.effective_payout_rate ?? '—'}</>;
  if (tabKey === 'awaiting_settlement') return <>Transferred {fmtDate(r.transferred_at)}</>;
  if (tabKey === 'settlement_completed') return <>{r.trader_credit_usdt} USDT · {fmtDate(r.settled_at)}</>;
  if (tabKey === 'dispute') return r.dispute_reason || 'No reason recorded';
  if (tabKey === 'canceled') return <>Canceled {fmtDate(r.canceled_at)}</>;
  return r.payment_method ? r.payment_method.replace(/^./, (c) => c.toUpperCase()) : '—';
}

export default function BuyUsdt() {
  const [tab, setTab] = useState('awaiting_processing');
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [selected, setSelected] = useState(null); // full detail for the modal
  const [now, setNow] = useState(Date.now());
  const [evidenceMap, setEvidenceMap] = useState({});
  const [cancellations, setCancellations] = useState([]); // BUG 6 — cancelled history
  const pollRef = useRef(null);

  // Compact evidence status per row (record/screenshot/SMS) for the two tabs
  // where a payout is being or has been captured. A trader holds at most a few
  // processing payouts, so this is a small handful of light (flags-only)
  // lookups, refreshed on the same cadence as the list.
  const rowKey = rows.map((r) => r.id).join(',');
  useEffect(() => {
    if (tab !== 'in_processing' && tab !== 'awaiting_settlement') {
      setEvidenceMap({});
      return undefined;
    }
    let active = true;
    const loadEvidence = () => {
      Promise.all(rows.map((r) => getPayoutEvidence([r.uuid, r.id])
        .then((e) => [r.id, e])
        .catch(() => [r.id, null])))
        .then((entries) => {
          if (!active) return;
          const m = {};
          entries.forEach(([id, e]) => { if (e) m[id] = e; });
          setEvidenceMap(m);
        });
    };
    loadEvidence();
    const t = setInterval(loadEvidence, 8000);
    return () => { active = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, rowKey]);

  const load = useCallback(async (status) => {
    setLoading(true);
    setError('');
    try {
      const res = await traderApi.payoutRequests(status);
      const data = res.data.data;
      setRows(data.payout_requests || []);
      setCounts(data.counts || {});
    } catch (e) {
      setError(e.response?.data?.message || 'Could not load payout requests.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on tab change + poll the active tab every 8s for near-real-time updates.
  useEffect(() => {
    load(tab);
    pollRef.current = setInterval(() => load(tab), 8000);
    return () => clearInterval(pollRef.current);
  }, [tab, load]);

  // BUG 6 — the "Canceled" tab is the trader's cancellation history (their
  // cancels re-pool the payout, so there's no 'canceled' payout row to show).
  useEffect(() => {
    if (tab !== 'canceled') return undefined;
    let active = true;
    const loadC = () => {
      traderApi.payoutCancellations()
        .then((res) => { if (active) setCancellations(res.data.data.cancellations || []); })
        .catch(() => { if (active) setCancellations([]); });
    };
    loadC();
    const t = setInterval(loadC, 8000);
    return () => { active = false; clearInterval(t); };
  }, [tab]);

  // 1s ticker for the waiting/countdown cells.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const act = async (fn, id, thenTab) => {
    setBusyId(id);
    setError('');
    try {
      await fn();
      setSelected(null);
      if (thenTab) setTab(thenTab);
      else load(tab);
    } catch (e) {
      setError(e.response?.data?.message || 'Action failed.');
    } finally {
      setBusyId(null);
    }
  };

  // Transferred gets its own path instead of act()'s auto-close: the modal
  // shows a real confirmation screen first (matching the reference), and
  // only closes once the trader dismisses that — act() itself already
  // switched tabs by the time the screen is showing.
  const submitTransferred = async (id, body) => {
    setBusyId(id);
    setError('');
    try {
      await traderApi.transferredPayout(id, body);
      setTab('awaiting_settlement');
      return true;
    } catch (e) {
      setError(e.response?.data?.message || 'Action failed.');
      return false;
    } finally {
      setBusyId(null);
    }
  };

  // Every status past "awaiting" belongs to this trader already (payoutService.
  // getForTrader has no status restriction — a pure read fetch), so "View
  // details" can safely open any of them, not just the in-progress one.
  const openDetail = async (row) => {
    setError('');
    try {
      const res = await traderApi.processPayout(row.id);
      setSelected(res.data.data.payout_request);
    } catch (e) {
      setError(e.response?.data?.message || 'Could not open request.');
    }
  };

  const counts3 = {
    awaitingAction: (counts.awaiting_processing || 0) + (counts.in_processing || 0),
    pendingSettlement: counts.awaiting_settlement || 0,
    completed: counts.settlement_completed || 0,
  };

  return (
    <div>
      <PageHeader eyebrow="BUY USDT" title="Payout" info="Pay merchant recipients in INR and receive settlement in USDT." />

      {/* Reference's 3-card summary row — built entirely from the counts
          object every load() already returns for every tab, not just the
          active one, so no extra request is needed for these numbers. */}
      <div className="summary3">
        <Card><small>Awaiting your action</small><strong>{counts3.awaitingAction}</strong><span>Accept or process now</span></Card>
        <Card><small>Pending settlement</small><strong>{counts3.pendingSettlement}</strong><span>Transferred, awaiting credit</span></Card>
        <Card><small>Completed</small><strong>{counts3.completed}</strong><span>Settled and credited</span></Card>
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 12, background: 'rgba(239,68,68,.1)', color: '#ef4444', fontSize: 13 }}>{error}</div>
      )}

      <Card className="flush">
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
              {t.label}
              <span>{counts[t.key] || 0}</span>
            </button>
          ))}
        </div>

        <div>
          {tab === 'canceled' ? (
            <CancelledHistory rows={cancellations} loading={loading} />
          ) : (
          <>
          {rows.map((r) => (
            <div className="payout" key={r.id}>
              <span className="method">
                {r.payment_method === 'upi' ? <QrCode size={18} /> : <Landmark size={18} />}
              </span>
              <div className="min-w-0">
                <strong className="truncate">{r.recipient_name || short(r.uuid, r.id)}</strong>
                <small className="truncate">{short(r.uuid, r.id)} · {subLine(r, tab, now)}</small>
                {(tab === 'in_processing' || tab === 'awaiting_settlement') && <EvidenceMini e={evidenceMap[r.id]} />}
              </div>
              <div>
                <small>Amount</small>
                <strong>{inr(r.amount_inr)}</strong>
              </div>
              <div>
                <small>{tab === 'in_processing' ? 'Time remaining' : tab === 'awaiting_processing' ? 'Waiting' : ' '}</small>
                <strong>
                  {tab === 'in_processing' && r.expires_at ? <Countdown to={r.expires_at} now={now} /> : tab === 'awaiting_processing' ? <Elapsed from={r.created_at} now={now} /> : '—'}
                </strong>
              </div>
              <Badge color={STATUS_BADGE[r.status]}>{TABS.find((t) => t.key === tab)?.label}</Badge>
              {tab === 'awaiting_processing' ? (
                <Button variant="primary" disabled={busyId === r.id} onClick={() => act(() => traderApi.acceptPayout(r.id), r.id, 'in_processing')}>
                  {busyId === r.id ? '…' : 'Accept'}
                </Button>
              ) : tab === 'in_processing' ? (
                <Button variant="primary" onClick={() => openDetail(r)}>Process</Button>
              ) : (
                <Button variant="ghost" onClick={() => openDetail(r)}>View details</Button>
              )}
            </div>
          ))}
          {rows.length === 0 && (
            loading ? (
              <LoadingState label="Loading payout requests…" />
            ) : (
              <EmptyState icon={Check} title="Nothing here" message={`No payout requests in "${TABS.find((t) => t.key === tab)?.label}".`} />
            )
          )}
          </>
          )}
        </div>
      </Card>

      {selected && (
        <ProcessModal
          req={selected}
          now={now}
          busy={busyId === selected.id}
          onClose={() => setSelected(null)}
          onTransferred={(receiptUrl) => submitTransferred(selected.id, receiptUrl ? { receipt_url: receiptUrl } : {})}
          onSendForReview={(body) => submitTransferred(selected.id, body)}
          onCancel={(body) => act(() => traderApi.cancelPayout(selected.id, body), selected.id, 'awaiting_processing')}
          onProblem={() => act(() => traderApi.problemPayout(selected.id, { reason: 'Trader reported a problem' }), selected.id, 'dispute')}
        />
      )}
    </div>
  );
}

// Compact three-dot evidence indicator for a payout row: record / screenshot /
// SMS. Green = captured, grey = not yet.
function EvidenceMini({ e }) {
  const dot = (ok, title) => (
    <span
      title={title}
      style={{ width: 7, height: 7, borderRadius: '50%', display: 'inline-block', background: ok ? '#22c55e' : 'var(--cardborder)' }}
    />
  );
  return (
    <span
      title="Evidence captured: record · screenshot · SMS"
      style={{ display: 'inline-flex', gap: 3, alignItems: 'center', marginTop: 3 }}
    >
      {dot(!!e?.hasRecord, 'Recorded input')}
      {dot(!!e?.hasScreenshot, 'Payment screenshot')}
      {dot(!!e?.hasSms, 'Bank debit SMS')}
    </span>
  );
}

// BUG 5 — one-tap copy for financial details, so the trader never retypes an
// account number / IFSC / amount into their UPI app and risks a typo.
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(String(text));
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard unavailable — no-op */ }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      title="Copy"
      aria-label="Copy"
      style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', color: copied ? '#22c55e' : 'var(--muted)', display: 'inline-flex', flexShrink: 0 }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

function Row({ label, value, copy }) {
  if (value == null || value === '') return null;
  return (
    <div className="flex items-center justify-between" style={{ padding: '9px 0', borderBottom: '1px solid var(--cardborder)' }}>
      <span style={{ color: 'var(--muted)', fontSize: 13 }}>{label}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text)', fontSize: 13, fontWeight: 600, textAlign: 'right', wordBreak: 'break-all' }}>
        {value}
        {copy && <CopyButton text={value} />}
      </span>
    </div>
  );
}

// One row of the payout evidence checklist (record / screenshot / SMS).
function EvidenceItem({ ok, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
      <span
        style={{
          width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700,
          background: ok ? 'rgba(34,197,94,.15)' : 'var(--cardborder)',
          color: ok ? '#22c55e' : 'var(--muted)',
        }}
      >
        {ok ? '✓' : '○'}
      </span>
      <span style={{ color: ok ? 'var(--text)' : 'var(--muted)', fontSize: 13 }}>{label}</span>
    </div>
  );
}

function ProcessModal({ req, now, busy, onClose, onTransferred, onSendForReview, onCancel, onProblem }) {
  const [receipt, setReceipt] = useState('');
  const [done, setDone] = useState(false);
  const [evidence, setEvidence] = useState(null);
  // BUG 4 — cancel sub-flow: reason (required) + note + optional proof.
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelNote, setCancelNote] = useState('');
  const [cancelProof, setCancelProof] = useState('');
  const cancelValid = !!cancelReason && (cancelReason !== 'other' || cancelNote.trim().length > 0);
  // BUG 2 — "capture didn't work, send for review" fallback (attested).
  const [reviewing, setReviewing] = useState(false);
  const [reviewAttest, setReviewAttest] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewProof, setReviewProof] = useState('');

  // Live capture status for THIS payout: the trader is recording/screenshotting
  // on their phone in real time, so fetch on open and poll while the modal is
  // up. (ngo-backend also emits a payout-evidence socket event; a short poll
  // keeps this self-contained and correct even if a push is missed.) Both the
  // payout uuid and id are passed so the lookup matches whichever the device
  // captured under.
  useEffect(() => {
    if (!req) return undefined;
    let active = true;
    const load = () => {
      getPayoutEvidence([req.uuid, req.id])
        .then((e) => { if (active) setEvidence(e); })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 5000);
    return () => { active = false; clearInterval(t); };
  }, [req?.uuid, req?.id]);

  // Feature 2 — the active match gate. For BANK-account payouts, the fields the
  // APK captured from the success screen (evidence.extractedFields) must
  // hard-match this order's amount + account last-4 before "I have transferred"
  // becomes clickable. Same rule the gateway enforces server-side, so this is
  // the honest reflection of it, not a second, looser check. UPI payouts aren't
  // gated (match.applicable === false), so they behave exactly as before.
  const match = useMemo(
    () => evaluatePayoutMatch(req || {}, evidence?.extractedFields),
    [req, evidence?.extractedFields]
  );
  const gateBlocks = match.applicable && !match.hardMatch;
  const gatePassed = match.applicable && match.hardMatch;

  if (!req) return null;

  // Only in_processing rows can actually be acted on — payoutService's
  // transferred/cancel/problem transitions all require that exact status
  // server-side. Every other status opens this same modal read-only (the
  // reference's own "View details" pattern), so the action buttons that would
  // otherwise look clickable-but-fail are not rendered at all for them.
  const actionable = req.status === 'in_processing';

  const handleTransferred = async (url) => {
    const ok = await onTransferred(url);
    if (ok) setDone(true);
  };

  const handleSendForReview = async () => {
    const ok = await onSendForReview({ unverified: true, evidence_note: reviewNote, receipt_url: reviewProof });
    if (ok) setDone(true);
  };

  if (done) {
    return (
      <Modal open onClose={onClose} title="Transfer submitted">
        <div className="done">
          <span><Check /></span>
          <h3 style={{ margin: '14px 0 6px' }}>Awaiting settlement</h3>
          <p style={{ color: 'var(--muted)', lineHeight: 1.6 }}>Your transfer was recorded. MaxPay will credit your USDT after verification.</p>
          <Button onClick={onClose}>Done</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={actionable ? 'Process payout' : 'Payout details'} subtitle={<span className="font-mono">{req.uuid}</span>}>
      {req.expires_at && actionable && (
        <div style={{ margin: '10px 0 14px', padding: '10px 14px', borderRadius: 12, background: 'var(--hover)', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>Time to transfer</span>
          <Countdown to={req.expires_at} now={now} />
        </div>
      )}

      <div style={{ textAlign: 'center', background: 'var(--hover)', border: '1px solid var(--cardborder)', borderRadius: 12, padding: 19, marginBottom: 14 }}>
        <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>{actionable ? 'Transfer exactly' : 'Amount'}</p>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, margin: '6px 0' }}>
          <p style={{ fontSize: 26, fontWeight: 800, margin: 0, color: 'var(--text)' }}>{inr(req.amount_inr)}</p>
          <CopyButton text={req.amount_inr} />
        </div>
        {actionable && <span style={{ display: 'block', color: 'var(--muted)', fontSize: 12 }}>Recipient details are locked for this request</span>}
      </div>

      <Row label="Status" value={<Badge color={STATUS_BADGE[req.status]}>{req.status?.replace(/_/g, ' ')}</Badge>} />
      <Row label="Payment method" value={<span style={{ textTransform: 'capitalize' }}>{req.payment_method}</span>} />
      <Row label="Recipient" value={req.recipient_name} copy />
      <Row label="Account number" value={req.account_number} copy />
      <Row label="UPI ID" value={req.upi_id} copy />
      <Row label="IFSC" value={req.ifsc_code} copy />
      <Row label="Bank" value={req.bank_name} />
      <Row label="Exchange rate" value={req.base_exchange_rate ? `₹${req.base_exchange_rate}` : null} />
      <Row label="My payout rate" value={req.effective_payout_rate ? `₹${req.effective_payout_rate}` : null} />
      <Row label="You will be credited" value={req.trader_credit_usdt ? `${req.trader_credit_usdt} USDT` : null} />
      <Row label="Settled" value={req.settled_at ? fmtDate(req.settled_at) : null} />
      <Row label="Dispute reason" value={req.dispute_reason} />

      {/* Evidence capture checklist — what the APK overlay has captured for this
          payout so far. Updates live while the trader processes on their phone. */}
      {(req.status === 'in_processing' || req.status === 'awaiting_settlement') && (
        <div style={{ margin: '14px 0', padding: '12px 14px', borderRadius: 12, background: 'var(--hover)', border: '1px solid var(--cardborder)' }}>
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 8px' }}>Evidence captured from your phone</p>
          <EvidenceItem ok={!!evidence?.hasRecord} label="Recorded input" />
          <EvidenceItem ok={!!evidence?.hasScreenshot} label="Payment screenshot" />
          <EvidenceItem ok={!!evidence?.hasSms} label="Bank debit SMS" />
          {evidence && evidence.uploadCount === 0 && (
            <p style={{ color: 'var(--muted)', fontSize: 11, margin: '8px 0 0', lineHeight: 1.5 }}>
              Nothing captured yet — use Record and Screenshot in the overlay on your phone while you pay.
            </p>
          )}
        </div>
      )}

      {actionable && (
        <>
          {/* Receipt URL text box — no file upload exists on the backend; this is
              intentionally still a plain URL field, not a real upload. */}
          <div style={{ margin: '14px 0' }}>
            <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 6px' }}>Receipt (optional)</p>
            <input
              value={receipt}
              onChange={(e) => setReceipt(e.target.value)}
              placeholder="Paste receipt URL (upload coming soon)"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text)', fontSize: 13, outline: 'none' }}
            />
          </div>

          {/* Feature 2 — match-gate feedback. Blocked: a clear, specific reason
              (not just a greyed-out button). Passed: a short confirmation so the
              trader knows why it's now clickable. */}
          {gateBlocks && (
            <div style={{ margin: '2px 0 10px', padding: '10px 12px', borderRadius: 12, background: 'rgba(245,158,11,.1)', border: '1px solid rgba(245,158,11,.35)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#b45309', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                <AlertTriangle size={14} /> Can't submit yet — details don't match
              </div>
              {match.reasons.map((r) => (
                <div key={r.code} style={{ color: '#92400e', fontSize: 12, lineHeight: 1.5 }}>{r.message}</div>
              ))}
              <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
                Tap Capture again on the payment success screen. If you already did and nothing shows here, the capture may not have linked — retry, or send it for manual review.
              </div>
              {!reviewing && (
                <button
                  onClick={() => setReviewing(true)}
                  style={{ marginTop: 8, background: 'none', border: 'none', padding: 0, color: 'var(--accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}
                >
                  I paid, but Capture didn’t work → send for review
                </button>
              )}
            </div>
          )}
          {gatePassed && (
            <div style={{ margin: '2px 0 10px', padding: '9px 12px', borderRadius: 12, background: 'rgba(34,197,94,.1)', border: '1px solid rgba(34,197,94,.35)', color: '#15803d', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Check size={14} /> Captured payment matches this payout — you can submit.
            </div>
          )}

          {!cancelling && reviewing ? (
            /* BUG 2 — attested manual-review fallback when auto-capture fails. */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Send for manual review</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                Use this only if you genuinely made this exact payment but the app couldn’t capture it. An admin verifies before you’re credited.
              </div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: 'var(--text)' }}>
                <input type="checkbox" checked={reviewAttest} onChange={(e) => setReviewAttest(e.target.checked)} style={{ marginTop: 3 }} />
                <span>I confirm I paid {inr(req.amount_inr)} to {req.recipient_name || 'this recipient'}{req.account_number ? ` (a/c ending ${String(req.account_number).slice(-4)})` : ''}.</span>
              </label>
              <textarea
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="What happened? (optional)"
                rows={2}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text)', fontSize: 13, outline: 'none', resize: 'vertical' }}
              />
              <input
                value={reviewProof}
                onChange={(e) => setReviewProof(e.target.value)}
                placeholder="Proof URL (optional)"
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text)', fontSize: 13, outline: 'none' }}
              />
              <div className="flex gap-2">
                <Button variant="ghost" disabled={busy} onClick={() => setReviewing(false)} className="flex-1">Back</Button>
                <Button variant="primary" disabled={busy || !reviewAttest} onClick={handleSendForReview} className="flex-1">
                  {busy ? 'Submitting…' : 'Submit for review'}
                </Button>
              </div>
            </div>
          ) : !cancelling ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
              <Button variant="primary" disabled={busy || gateBlocks} onClick={() => handleTransferred(receipt)}>
                {busy ? 'Working…' : <>I have transferred <ArrowRight size={16} /></>}
              </Button>
              <Button variant="ghost" disabled={busy || gateBlocks} onClick={() => handleTransferred('')}>
                I transferred, but can't attach the receipt
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" disabled={busy} onClick={() => setCancelling(true)} className="flex-1">Cancel</Button>
                <button
                  disabled={busy}
                  onClick={onProblem}
                  className="flex-1"
                  style={{ borderRadius: 12, border: '1px solid rgba(239,68,68,.4)', background: 'rgba(239,68,68,.1)', color: '#ef4444', fontWeight: 600, fontSize: 14, padding: '9px 14px', cursor: 'pointer' }}
                >
                  I have a problem
                </button>
              </div>
            </div>
          ) : (
            /* BUG 4 — required reason + optional proof, captured at cancel time.
               Cancelling releases the payout back to the pool for another trader. */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Cancel this payout</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 2 }}>It goes back to the pool for another trader. Tell us why:</div>
              <select
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text)', fontSize: 13, outline: 'none' }}
              >
                <option value="">Select a reason…</option>
                {CANCEL_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <textarea
                value={cancelNote}
                onChange={(e) => setCancelNote(e.target.value)}
                placeholder={cancelReason === 'other' ? 'Note (required for “Other”)' : 'Add a note (optional)'}
                rows={2}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text)', fontSize: 13, outline: 'none', resize: 'vertical' }}
              />
              <input
                value={cancelProof}
                onChange={(e) => setCancelProof(e.target.value)}
                placeholder="Proof URL (optional)"
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text)', fontSize: 13, outline: 'none' }}
              />
              <div className="flex gap-2">
                <Button variant="ghost" disabled={busy} onClick={() => setCancelling(false)} className="flex-1">Back</Button>
                <button
                  disabled={busy || !cancelValid}
                  onClick={() => onCancel({ reason_code: cancelReason, reason_note: cancelNote, proof_url: cancelProof })}
                  className="flex-1"
                  style={{ borderRadius: 12, border: '1px solid rgba(239,68,68,.4)', background: busy || !cancelValid ? 'rgba(239,68,68,.06)' : 'rgba(239,68,68,.12)', color: '#ef4444', fontWeight: 600, fontSize: 14, padding: '9px 14px', cursor: busy || !cancelValid ? 'not-allowed' : 'pointer', opacity: busy || !cancelValid ? 0.6 : 1 }}
                >
                  {busy ? 'Cancelling…' : 'Confirm cancellation'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {!actionable && (
        <div style={{ marginTop: 14 }}>
          <Button variant="ghost" onClick={onClose} className="w-full">Close</Button>
        </div>
      )}
    </Modal>
  );
}

// BUG 6 — the trader's cancelled history, from the payout_cancellations audit
// log. A trader cancel re-pools the payout, so these records (not 'canceled'
// payout rows) are the durable history, each with its reason/proof/outcome.
function CancelledHistory({ rows, loading }) {
  if (!rows || rows.length === 0) {
    return loading
      ? <LoadingState label="Loading cancelled history…" />
      : <EmptyState icon={Check} title="No cancellations" message="Payouts you cancel will appear here with their reason." />;
  }
  return (
    <div>
      {rows.map((c) => (
        <div className="payout" key={c.id}>
          <span className="method"><Landmark size={18} /></span>
          <div className="min-w-0">
            <strong className="truncate">{reasonLabel(c.reason_code)}</strong>
            <small className="truncate">
              {short(c.payout_uuid, c.payout_request_id)} · {fmtDate(c.created_at)}{c.reason_note ? ` · ${c.reason_note}` : ''}
            </small>
          </div>
          <div>
            <small>Amount</small>
            <strong>{inr(c.amount_inr)}</strong>
          </div>
          <div>
            <small>Proof</small>
            <strong>{c.proof_url ? <a href={c.proof_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>View</a> : '—'}</strong>
          </div>
          <Badge color={c.outcome === 'returned_to_pool' ? 'amber' : 'gray'}>
            {c.outcome === 'returned_to_pool' ? 'Returned to pool' : 'Canceled'}
          </Badge>
          <div />
        </div>
      ))}
    </div>
  );
}
