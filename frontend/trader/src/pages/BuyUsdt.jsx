import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QrCode, Landmark, Check, ArrowRight } from 'lucide-react';
import { Card, Badge, Button, PageHeader, Modal, EmptyState, LoadingState } from '../components/ui';
import { traderApi } from '../services/api';
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
  const pollRef = useRef(null);

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
      <PageHeader eyebrow="BUY USDT" title="Payout processing" subtitle="Pay merchant recipients in INR and receive settlement in USDT." />

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
          {rows.map((r) => (
            <div className="payout" key={r.id}>
              <span className="method">
                {r.payment_method === 'upi' ? <QrCode size={18} /> : <Landmark size={18} />}
              </span>
              <div className="min-w-0">
                <strong className="truncate">{r.recipient_name || short(r.uuid, r.id)}</strong>
                <small className="truncate">{short(r.uuid, r.id)} · {subLine(r, tab, now)}</small>
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
        </div>
      </Card>

      {selected && (
        <ProcessModal
          req={selected}
          now={now}
          busy={busyId === selected.id}
          onClose={() => setSelected(null)}
          onTransferred={(receiptUrl) => submitTransferred(selected.id, receiptUrl ? { receipt_url: receiptUrl } : {})}
          onCancel={() => act(() => traderApi.cancelPayout(selected.id), selected.id, 'canceled')}
          onProblem={() => act(() => traderApi.problemPayout(selected.id, { reason: 'Trader reported a problem' }), selected.id, 'dispute')}
        />
      )}
    </div>
  );
}

function Row({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <div className="flex items-center justify-between" style={{ padding: '9px 0', borderBottom: '1px solid var(--cardborder)' }}>
      <span style={{ color: 'var(--muted)', fontSize: 13 }}>{label}</span>
      <span style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function ProcessModal({ req, now, busy, onClose, onTransferred, onCancel, onProblem }) {
  const [receipt, setReceipt] = useState('');
  const [done, setDone] = useState(false);
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
        <p style={{ fontSize: 26, fontWeight: 800, margin: '6px 0', color: 'var(--text)' }}>{inr(req.amount_inr)}</p>
        {actionable && <span style={{ color: 'var(--muted)', fontSize: 12 }}>Recipient details are locked for this request</span>}
      </div>

      <Row label="Status" value={<Badge color={STATUS_BADGE[req.status]}>{req.status?.replace(/_/g, ' ')}</Badge>} />
      <Row label="Payment method" value={<span style={{ textTransform: 'capitalize' }}>{req.payment_method}</span>} />
      <Row label="Recipient" value={req.recipient_name} />
      <Row label="Account number" value={req.account_number} />
      <Row label="UPI ID" value={req.upi_id} />
      <Row label="IFSC" value={req.ifsc_code} />
      <Row label="Bank" value={req.bank_name} />
      <Row label="Exchange rate" value={req.base_exchange_rate ? `₹${req.base_exchange_rate}` : null} />
      <Row label="My payout rate" value={req.effective_payout_rate ? `₹${req.effective_payout_rate}` : null} />
      <Row label="You will be credited" value={req.trader_credit_usdt ? `${req.trader_credit_usdt} USDT` : null} />
      <Row label="Settled" value={req.settled_at ? fmtDate(req.settled_at) : null} />
      <Row label="Dispute reason" value={req.dispute_reason} />

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

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
            <Button variant="primary" disabled={busy} onClick={() => handleTransferred(receipt)}>
              {busy ? 'Working…' : <>I have transferred <ArrowRight size={16} /></>}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => handleTransferred('')}>
              I transferred, but can't attach the receipt
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" disabled={busy} onClick={onCancel} className="flex-1">Cancel</Button>
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
