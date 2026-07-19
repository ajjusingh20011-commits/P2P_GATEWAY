import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Badge, Button, Tabs, PageHeader } from '../components/ui';
import { adminApi } from '../services/api';
import { inr } from '../utils/mock';

/*
  Admin Payouts — manage the merchant Payout-Request ("Buy USDT") system.
  Six tabs mirror the status flow. The admin can approve an AWAITING_SETTLEMENT
  request (credits the trader USDT), reject, or resolve a dispute. All money +
  transition rules are enforced by the backend; this page just calls them.
*/

const TABS = [
  { key: 'awaiting_processing', label: 'Awaiting Processing', color: 'amber' },
  { key: 'in_processing', label: 'In Processing', color: 'sky' },
  { key: 'awaiting_settlement', label: 'Awaiting Settlement', color: 'violet' },
  { key: 'settlement_completed', label: 'Settlement Completed', color: 'green' },
  { key: 'canceled', label: 'Canceled', color: 'gray' },
  { key: 'dispute', label: 'Dispute', color: 'red' },
];

const short = (uuid, id) => (uuid ? String(uuid).split('-')[0].toUpperCase() : `#${id}`);
const fmtDate = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())} · ${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
};

export default function Payouts() {
  const [tab, setTab] = useState('awaiting_settlement');
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async (status) => {
    setLoading(true);
    setError('');
    try {
      const data = await adminApi.listPayoutRequests({ status });
      setRows(data.payout_requests || []);
      setCounts(data.counts || {});
    } catch (e) {
      setError(e.response?.data?.message || 'Could not load payout requests.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(tab); }, [tab, load]);

  // Refresh when a payout socket event is re-broadcast by the admin useSocket.
  useEffect(() => {
    const onUpdate = () => load(tab);
    window.addEventListener('order:update', onUpdate);
    return () => window.removeEventListener('order:update', onUpdate);
  }, [tab, load]);

  const act = async (fn, id) => {
    setBusyId(id);
    setError('');
    try {
      await fn();
      load(tab);
    } catch (e) {
      setError(e.response?.data?.message || 'Action failed.');
    } finally {
      setBusyId(null);
    }
  };

  const tabs = TABS.map((t) => ({ key: t.key, label: t.label, count: counts[t.key] || 0 }));
  const meta = useMemo(() => TABS.find((t) => t.key === tab), [tab]);
  const showRate = ['in_processing', 'awaiting_settlement', 'settlement_completed', 'dispute'].includes(tab);

  return (
    <div>
      <PageHeader title="Payouts" subtitle="Merchant payout requests — settle, reject, and resolve disputes" />

      {error && (
        <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 12, background: 'rgba(239,68,68,.1)', color: '#ef4444', fontSize: 13 }}>{error}</div>
      )}

      <Card>
        <div className="px-4 pt-2">
          <Tabs tabs={tabs} active={tab} onChange={setTab} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--cardborder)' }}>
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Merchant</th>
                <th className="px-4 py-3 font-medium">Trader</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                {showRate && <th className="px-4 py-3 font-medium">Rate (base → payout)</th>}
                {showRate && <th className="px-4 py-3 font-medium">Trader credit</th>}
                {tab === 'dispute' && <th className="px-4 py-3 font-medium">Reason</th>}
                <th className="px-4 py-3 font-medium">Updated</th>
                <th className="px-4 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody style={{ color: 'var(--text)' }}>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--cardborder)' }}>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--muted)' }}>{short(r.uuid, r.id)}</td>
                  <td className="px-4 py-3">{r.merchant?.business_name || `#${r.merchant_id}`}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--muted)' }}>{r.assigned_trader_id ? `#${r.assigned_trader_id}` : '—'}</td>
                  <td className="px-4 py-3 font-medium">{inr(r.amount_inr)}</td>
                  {showRate && (
                    <td className="px-4 py-3 text-xs">
                      {r.effective_payout_rate
                        ? <span>₹{r.base_exchange_rate} → <b style={{ color: 'var(--text)' }}>₹{r.effective_payout_rate}</b> <span style={{ color: 'var(--muted)' }}>({r.trader_payout_percent}%)</span></span>
                        : <span style={{ color: 'var(--muted)' }}>—</span>}
                    </td>
                  )}
                  {showRate && <td className="px-4 py-3 font-semibold" style={{ color: '#22c55e' }}>{r.trader_credit_usdt ? `${r.trader_credit_usdt} USDT` : '—'}</td>}
                  {tab === 'dispute' && <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)', maxWidth: 200 }}>{r.dispute_reason || '—'}</td>}
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>{fmtDate(r.updated_at || r.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      {tab === 'awaiting_settlement' && (
                        <>
                          <Button size="sm" variant="success" disabled={busyId === r.id} onClick={() => act(() => adminApi.approvePayoutRequest(r.id), r.id)}>Approve &amp; settle</Button>
                          <Button size="sm" variant="ghost" disabled={busyId === r.id} onClick={() => act(() => adminApi.rejectPayoutRequest(r.id, 'Rejected by admin'), r.id)}>Reject</Button>
                        </>
                      )}
                      {tab === 'awaiting_processing' && (
                        <Button size="sm" variant="ghost" disabled={busyId === r.id} onClick={() => act(() => adminApi.rejectPayoutRequest(r.id, 'Rejected by admin'), r.id)}>Reject</Button>
                      )}
                      {tab === 'dispute' && (
                        <>
                          <Button size="sm" variant="success" disabled={busyId === r.id} onClick={() => act(() => adminApi.resolvePayoutDispute(r.id, { action: 'settle' }), r.id)}>Settle</Button>
                          <Button size="sm" variant="ghost" disabled={busyId === r.id} onClick={() => act(() => adminApi.resolvePayoutDispute(r.id, { action: 'void' }), r.id)}>Void</Button>
                        </>
                      )}
                      {!['awaiting_settlement', 'awaiting_processing', 'dispute'].includes(tab) && (
                        <Badge color={meta.color}>{meta.label}</Badge>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={9} className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>No requests in “{meta.label}”.</td></tr>
              )}
              {loading && rows.length === 0 && (
                <tr><td colSpan={9} className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
