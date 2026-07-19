import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, Badge, Button, PageHeader } from '../components/ui';
import { traderApi } from '../services/api';
import { inr } from '../utils/mock';

/*
  Buy USDT — the trader side of the merchant Payout-Request system.

  A merchant creates a payout; it lands in a global pool. This page lets the
  trader accept a request, process it (pay the recipient), mark it transferred,
  and track it through settlement / cancel / dispute. Money logic + all status
  transitions are enforced by the backend — this is the presentation layer.

  Uses the shared trader theme (tf-* classes) so it works in dark + light.
*/

const TABS = [
  { key: 'awaiting_processing', label: 'Awaiting Processing' },
  { key: 'in_processing', label: 'In Processing' },
  { key: 'awaiting_settlement', label: 'Awaiting Settlement' },
  { key: 'settlement_completed', label: 'Settlement Completed' },
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
  return <span style={{ color: danger ? '#ef4444' : 'var(--text)', fontWeight: 600 }}>{left <= 0 ? 'expired' : fmtDuration(left)}</span>;
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

  const openProcess = async (row) => {
    setError('');
    try {
      const res = await traderApi.processPayout(row.id);
      setSelected(res.data.data.payout_request);
    } catch (e) {
      setError(e.response?.data?.message || 'Could not open request.');
    }
  };

  const tabLabel = useMemo(() => TABS.find((t) => t.key === tab)?.label, [tab]);

  return (
    <div>
      <PageHeader title="Buy USDT" subtitle="Process merchant payout requests and get credited USDT" />

      {/* Tabs with count badges */}
      <div className="tf-scroll" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: 16 }}>
        {TABS.map((t) => {
          const c = counts[t.key] || 0;
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="tf-card"
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', whiteSpace: 'nowrap',
                cursor: 'pointer', border: on ? '1px solid #14b8c4' : '1px solid var(--cardborder)',
                background: on ? 'rgba(20,184,196,.12)' : 'var(--card)', color: on ? '#14b8c4' : 'var(--muted)',
                fontSize: 13, fontWeight: 600,
              }}
            >
              {t.label}
              <span style={{
                minWidth: 18, height: 18, padding: '0 5px', borderRadius: 99, fontSize: 11, fontWeight: 700,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: on ? '#14b8c4' : 'var(--hover)', color: on ? '#fff' : 'var(--muted)',
              }}>{c > 99 ? '99+' : c}</span>
            </button>
          );
        })}
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 12, background: 'rgba(239,68,68,.1)', color: '#ef4444', fontSize: 13 }}>{error}</div>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--cardborder)' }}>
                <th className="px-4 py-3 font-medium">ID</th>
                {tab === 'awaiting_processing' && <th className="px-4 py-3 font-medium">Received</th>}
                {tab === 'awaiting_processing' && <th className="px-4 py-3 font-medium">Waiting</th>}
                {tab === 'in_processing' && <th className="px-4 py-3 font-medium">Time left</th>}
                {(tab === 'in_processing' || tab === 'settlement_completed') && <th className="px-4 py-3 font-medium">Exch. rate</th>}
                {(tab === 'in_processing' || tab === 'settlement_completed') && <th className="px-4 py-3 font-medium">My rate</th>}
                <th className="px-4 py-3 font-medium">Method</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                {tab === 'settlement_completed' && <th className="px-4 py-3 font-medium">Credited USDT</th>}
                {tab === 'settlement_completed' && <th className="px-4 py-3 font-medium">Settled</th>}
                {tab === 'dispute' && <th className="px-4 py-3 font-medium">Reason</th>}
                {(tab === 'awaiting_processing' || tab === 'in_processing') && <th className="px-4 py-3 font-medium">Action</th>}
                {(tab === 'awaiting_settlement' || tab === 'canceled' || tab === 'dispute') && <th className="px-4 py-3 font-medium">Status</th>}
              </tr>
            </thead>
            <tbody style={{ color: 'var(--text)' }}>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--cardborder)' }}>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--muted)' }}>{short(r.uuid, r.id)}</td>

                  {tab === 'awaiting_processing' && <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>{fmtDate(r.created_at)}</td>}
                  {tab === 'awaiting_processing' && <td className="px-4 py-3"><Elapsed from={r.created_at} now={now} /></td>}
                  {tab === 'in_processing' && <td className="px-4 py-3">{r.expires_at ? <Countdown to={r.expires_at} now={now} /> : '—'}</td>}

                  {(tab === 'in_processing' || tab === 'settlement_completed') && <td className="px-4 py-3" style={{ color: 'var(--muted)' }}>₹{r.base_exchange_rate ?? '—'}</td>}
                  {(tab === 'in_processing' || tab === 'settlement_completed') && <td className="px-4 py-3 font-medium" style={{ color: '#14b8c4' }}>₹{r.effective_payout_rate ?? '—'}</td>}

                  <td className="px-4 py-3" style={{ textTransform: 'capitalize' }}>{r.payment_method}</td>
                  <td className="px-4 py-3 font-medium">{inr(r.amount_inr)}</td>

                  {tab === 'settlement_completed' && <td className="px-4 py-3 font-semibold" style={{ color: '#22c55e' }}>{r.trader_credit_usdt} USDT</td>}
                  {tab === 'settlement_completed' && <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>{fmtDate(r.settled_at)}</td>}
                  {tab === 'dispute' && <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>{r.dispute_reason || '—'}</td>}

                  {tab === 'awaiting_processing' && (
                    <td className="px-4 py-3">
                      <Button variant="primary" disabled={busyId === r.id} onClick={() => act(() => traderApi.acceptPayout(r.id), r.id, 'in_processing')}>
                        {busyId === r.id ? '…' : 'Accept for Processing'}
                      </Button>
                    </td>
                  )}
                  {tab === 'in_processing' && (
                    <td className="px-4 py-3">
                      <Button variant="primary" onClick={() => openProcess(r)}>Process</Button>
                    </td>
                  )}
                  {(tab === 'awaiting_settlement' || tab === 'canceled' || tab === 'dispute') && (
                    <td className="px-4 py-3"><Badge color={STATUS_BADGE[r.status]}>{tabLabel}</Badge></td>
                  )}
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={9} className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>No requests in “{tabLabel}”.</td></tr>
              )}
              {loading && rows.length === 0 && (
                <tr><td colSpan={9} className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {selected && (
        <ProcessModal
          req={selected}
          now={now}
          busy={busyId === selected.id}
          onClose={() => setSelected(null)}
          onTransferred={(receiptUrl) => act(() => traderApi.transferredPayout(selected.id, receiptUrl ? { receipt_url: receiptUrl } : {}), selected.id, 'awaiting_settlement')}
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
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="tf-card tf-scroll"
        style={{ width: 460, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', padding: 22 }}
      >
        <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
          <h3 style={{ fontWeight: 700, fontSize: 17, margin: 0, color: 'var(--text)' }}>Process payout</h3>
          <button onClick={onClose} className="tf-hbtn" aria-label="Close">✕</button>
        </div>
        <p className="font-mono" style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 4px' }}>{req.uuid}</p>

        {req.expires_at && (
          <div style={{ margin: '10px 0 14px', padding: '10px 14px', borderRadius: 12, background: 'var(--hover)', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>Time to transfer</span>
            <Countdown to={req.expires_at} now={now} />
          </div>
        )}

        <Row label="Amount" value={inr(req.amount_inr)} />
        <Row label="Payment method" value={<span style={{ textTransform: 'capitalize' }}>{req.payment_method}</span>} />
        <Row label="Recipient" value={req.recipient_name} />
        <Row label="Account number" value={req.account_number} />
        <Row label="UPI ID" value={req.upi_id} />
        <Row label="IFSC" value={req.ifsc_code} />
        <Row label="Bank" value={req.bank_name} />
        <Row label="Exchange rate" value={req.base_exchange_rate ? `₹${req.base_exchange_rate}` : null} />
        <Row label="My payout rate" value={req.effective_payout_rate ? `₹${req.effective_payout_rate}` : null} />
        <Row label="You will be credited" value={req.trader_credit_usdt ? `${req.trader_credit_usdt} USDT` : null} />

        {/* Receipt upload placeholder (no file backend yet — accepts a URL). */}
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
          <Button variant="primary" disabled={busy} onClick={() => onTransferred(receipt)}>
            {busy ? 'Working…' : 'I have transferred'}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => onTransferred('')}>
            I transferred, but can’t attach the receipt
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
      </div>
    </div>
  );
}
