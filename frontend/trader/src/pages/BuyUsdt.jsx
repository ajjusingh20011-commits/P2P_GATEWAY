import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Card, Badge, Button, PageHeader, Modal, DataTable, Th, EmptyState, LoadingState } from '../components/ui';
import { traderApi } from '../services/api';
import { inr } from '../utils/mock';

/*
  Buy USDT — the trader side of the merchant Payout-Request system.

  A merchant creates a payout; it lands in a global pool. This page lets the
  trader accept a request, process it (pay the recipient), mark it transferred,
  and track it through settlement / cancel / dispute. Money logic + all status
  transitions are enforced by the backend — this is the presentation layer.

  Uses the shared trader theme (tf-* classes) so it works in dark + light.

  Real lifecycle (see backend/src/services/payoutService.js):
    awaiting_processing -> in_processing -> awaiting_settlement -> settlement_completed
    awaiting_processing -> canceled
    in_processing       -> canceled | dispute
    awaiting_settlement -> dispute
    dispute             -> settlement_completed | canceled
  canceled/dispute are branch/exception states reachable from more than one
  point, not a 5th/6th step after settlement — so the tab strip below groups
  the 4 sequential states with connecting chevrons ("pipeline") and sets the
  2 exception states apart with a divider, instead of drawing all 6 as one
  misleadingly-linear stepper.
*/

const TABS = [
  { key: 'awaiting_processing', label: 'Awaiting Processing', group: 'pipeline' },
  { key: 'in_processing', label: 'In Processing', group: 'pipeline' },
  { key: 'awaiting_settlement', label: 'Awaiting Settlement', group: 'pipeline' },
  { key: 'settlement_completed', label: 'Settlement Completed', group: 'pipeline' },
  { key: 'canceled', label: 'Canceled', group: 'exception' },
  { key: 'dispute', label: 'Dispute', group: 'exception' },
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

      {/* Tabs with count badges — doubles as the status-progression stepper:
          the 4 pipeline tabs get connecting chevrons, the 2 exception tabs
          (canceled/dispute) are set apart with a divider. */}
      <div className="tf-scroll" style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: 16 }}>
        {TABS.map((t, i) => {
          const c = counts[t.key] || 0;
          const on = tab === t.key;
          const showChevron = i > 0 && t.group === 'pipeline' && TABS[i - 1].group === 'pipeline';
          const showDivider = i > 0 && t.group === 'exception' && TABS[i - 1].group !== 'exception';
          return (
            <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {showChevron && <ChevronRight size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />}
              {showDivider && <span style={{ width: 1, height: 22, background: 'var(--cardborder)', flexShrink: 0 }} />}
              <button
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
            </div>
          );
        })}
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 12, background: 'rgba(239,68,68,.1)', color: '#ef4444', fontSize: 13 }}>{error}</div>
      )}

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <DataTable minWidth={860}>
          <thead>
            <tr>
              <Th>ID</Th>
              {tab === 'awaiting_processing' && <Th>Received</Th>}
              {tab === 'awaiting_processing' && <Th>Waiting</Th>}
              {tab === 'in_processing' && <Th>Time left</Th>}
              {(tab === 'in_processing' || tab === 'settlement_completed') && <Th>Exch. rate</Th>}
              {(tab === 'in_processing' || tab === 'settlement_completed') && <Th>My rate</Th>}
              <Th>Method</Th>
              <Th>Amount</Th>
              {tab === 'settlement_completed' && <Th>Credited USDT</Th>}
              {tab === 'settlement_completed' && <Th>Settled</Th>}
              {tab === 'dispute' && <Th>Reason</Th>}
              {(tab === 'awaiting_processing' || tab === 'in_processing') && <Th>Action</Th>}
              {(tab === 'awaiting_settlement' || tab === 'canceled' || tab === 'dispute') && <Th>Status</Th>}
            </tr>
          </thead>
          <tbody style={{ color: 'var(--text)' }}>
            {rows.map((r) => (
              <tr key={r.id} className="tf-row-hover" style={{ borderBottom: '1px solid var(--cardborder)' }}>
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
            {rows.length === 0 && (
              <tr>
                <td colSpan={9}>
                  {loading ? (
                    <LoadingState label="Loading payout requests…" />
                  ) : (
                    <EmptyState title={`No requests in "${tabLabel}"`} />
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </DataTable>
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
  if (!req) return null;

  return (
    <Modal open onClose={onClose} title="Process payout" subtitle={<span className="font-mono">{req.uuid}</span>}>
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
    </Modal>
  );
}
