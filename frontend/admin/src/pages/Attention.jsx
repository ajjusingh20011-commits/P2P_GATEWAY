import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, Scale } from 'lucide-react';
import { Card, Badge, PageHeader, InlineLoader, SearchInput, Tabs, Button } from '../components/ui';
import AdminIdPopover from '../components/AdminIdPopover';
import { adminApi } from '../services/api';
import { inr } from '../utils/mock';

/**
 * Real aggregation page — no dedicated /admin/attention endpoint exists, so
 * this merges three already-real endpoints (under_review orders, open
 * disputes, disputed payout requests) into one queue, client-side. The
 * design's version models a generic severity-tagged "alert" with an
 * owner/escalation workflow that has no real backend counterpart at all
 * (no alerts table, no owner/assignment concept, no escalate endpoint), so
 * this drops those entirely rather than fabricating them — "Type" replaces
 * "Severity", "Status" shows each record's REAL status field, and the only
 * action is "Open", which takes you to the real page where the real
 * review/resolve/approve actions actually live.
 */

const TYPE_META = {
  order: { label: 'Order review', tone: 'blue', Icon: ArrowDownLeft, route: '/orders' },
  dispute: { label: 'Dispute', tone: 'red', Icon: Scale, route: '/disputes' },
  payout: { label: 'Payout dispute', tone: 'amber', Icon: ArrowUpRight, route: '/payouts' },
};
const TYPE_BADGE_COLOR = { order: 'sky', dispute: 'red', payout: 'amber' };

function ageLabel(dateStr) {
  if (!dateStr) return '—';
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return '—';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

async function fetchAllUnderReview() {
  const first = await adminApi.listOrders({ status: 'under_review', page: 1, limit: 100 });
  const rows = [...(first.orders || [])];
  const total = first.pagination?.total ?? rows.length;
  const pages = Math.min(5, Math.ceil(total / 100));
  for (let p = 2; p <= pages; p++) {
    const res = await adminApi.listOrders({ status: 'under_review', page: p, limit: 100 });
    rows.push(...(res.orders || []));
  }
  return rows;
}

export default function Attention() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      fetchAllUnderReview().catch(() => []),
      adminApi.listDisputes({ status: 'open' }).catch(() => ({ disputes: [] })),
      adminApi.listPayoutRequests({ status: 'dispute' }).catch(() => ({ payout_requests: [] })),
    ])
      .then(([orders, d, p]) => {
        if (!alive) return;
        const orderItems = orders.map((o) => ({
          key: `order-${o.id}`,
          type: 'order',
          title: `Order #${o.id} awaiting review`,
          detail: 'Pay-in claimed paid, needs manual confirm/reject',
          entity: o.merchant?.business_name || '—',
          amount: o.amount_inr,
          status: o.status,
          createdAt: o.created_at,
          idRows: [
            { label: 'Transaction ID', value: o.id },
            { label: 'UUID', value: o.uuid },
            { label: 'Merchant Order ID', value: o.merchant_order_id },
            { label: 'Customer Reference', value: o.customer_ref },
          ],
        }));
        const disputeItems = (d.disputes || []).map((row) => ({
          key: `dispute-${row.id}`,
          type: 'dispute',
          title: `Dispute #${row.id} on order #${row.order_id}`,
          detail: row.reason || 'No reason given',
          entity: row.order?.merchant_id ? `Merchant #${row.order.merchant_id}` : '—',
          amount: row.order?.amount_inr,
          status: row.status,
          createdAt: row.created_at,
          idRows: [
            { label: 'Dispute ID', value: row.id },
            { label: 'Order ID', value: row.order_id },
            { label: 'Order UUID', value: row.order?.uuid },
          ],
        }));
        const payoutItems = (p.payout_requests || []).map((row) => ({
          key: `payout-${row.id}`,
          type: 'payout',
          title: `Payout #${row.id} disputed`,
          detail: row.dispute_reason || 'No reason given',
          entity: row.merchant?.business_name || '—',
          amount: row.amount_inr,
          status: row.status,
          createdAt: row.disputed_at || row.created_at,
          idRows: [
            { label: 'Payout ID', value: row.id },
            { label: 'UUID', value: row.uuid },
          ],
        }));
        const merged = [...orderItems, ...disputeItems, ...payoutItems].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        setRows(merged);
      })
      .catch(() => { if (alive) setError('Could not load some attention items.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const counts = useMemo(
    () => ({
      all: rows.length,
      order: rows.filter((r) => r.type === 'order').length,
      dispute: rows.filter((r) => r.type === 'dispute').length,
      payout: rows.filter((r) => r.type === 'payout').length,
    }),
    [rows]
  );

  const filtered = useMemo(() => {
    let list = type === 'all' ? rows : rows.filter((r) => r.type === type);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((r) => `${r.title} ${r.entity} ${r.detail}`.toLowerCase().includes(q));
    return list;
  }, [rows, type, query]);

  return (
    <div>
      <PageHeader
        title="Attention"
        subtitle={loading ? 'Loading…' : `${rows.length} item${rows.length === 1 ? '' : 's'} awaiting action`}
        actions={loading ? <InlineLoader /> : null}
      />

      {error && (
        <div className="mb-4 rounded-lg border px-4 py-2.5 text-sm" style={{ borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
          {error}
        </div>
      )}

      <Card className="mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput value={query} onChange={setQuery} placeholder="Search issues, merchants…" className="sm:max-w-xs" />
        <Tabs
          tabs={[
            { key: 'all', label: 'All', count: counts.all },
            { key: 'order', label: 'Order review', count: counts.order },
            { key: 'dispute', label: 'Disputes', count: counts.dispute },
            { key: 'payout', label: 'Payout disputes', count: counts.payout },
          ]}
          active={type}
          onChange={setType}
        />
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ borderBottom: '1px solid var(--cardborder)', color: 'var(--muted)' }}>
                <th className="w-10 px-4 py-3" />
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Issue</th>
                <th className="px-4 py-3 font-medium">Entity</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Age</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="py-14 text-center text-sm" style={{ color: 'var(--muted)' }}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-14 text-center">
                    <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                      {rows.length === 0 ? 'No open platform risks' : 'No items match these filters'}
                    </p>
                    <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
                      {rows.length === 0 ? 'Nothing needs attention right now.' : 'Try a different type or clear the search.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const meta = TYPE_META[r.type];
                  return (
                    <tr key={r.key} className="tf-row-hover" style={{ borderTop: '1px solid var(--cardborder)' }}>
                      <td className="px-4 py-3"><AdminIdPopover rows={r.idRows} /></td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5">
                          <meta.Icon size={14} style={{ color: 'var(--muted)' }} />
                          <Badge color={TYPE_BADGE_COLOR[r.type]}>{meta.label}</Badge>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium" style={{ color: 'var(--text)', margin: 0 }}>{r.title}</p>
                        <p className="truncate" style={{ color: 'var(--muted)', fontSize: 12, margin: '2px 0 0', maxWidth: 260 }}>{r.detail}</p>
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--text)' }}>{r.entity}</td>
                      <td className="px-4 py-3 font-medium" style={{ color: 'var(--text)' }}>{r.amount != null ? inr(r.amount) : '—'}</td>
                      <td className="px-4 py-3" style={{ color: 'var(--muted)' }}>{ageLabel(r.createdAt)}</td>
                      <td className="px-4 py-3"><Badge color="gray">{r.status}</Badge></td>
                      <td className="px-4 py-3">
                        <Button variant="ghost" size="sm" onClick={() => navigate(meta.route)}>
                          Open
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
