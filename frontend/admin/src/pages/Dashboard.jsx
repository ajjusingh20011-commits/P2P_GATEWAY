import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Scale, Users } from 'lucide-react';
import { Card, Badge, PageHeader, InlineLoader } from '../components/ui';
import { OverviewMetric, TransactionActivityChart, RequiresAttentionCard } from '../components/DashboardSections';
import AdminIdPopover from '../components/AdminIdPopover';
import { useApi } from '../hooks/useApi';
import { adminApi } from '../services/api';
import { inr } from '../utils/mock';

// Real socket events the admin room actually receives (confirmed against
// backend emit sites): order:cancelled and order:disputed, each carrying
// only { order_id, status?, reason? } — no amount/merchant/trader/method.
// order:paid and order:confirmed are wired in useSocket.js but the backend
// never emits them to the admin room, so they never fire here.
const feedStatus = { cancelled: 'gray', disputed: 'red' };
const feedLabel = { cancelled: 'Cancelled', disputed: 'Disputed' };

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

// A handful of pages (~8) of the most recent orders/payout requests is a
// real, honestly-scoped window for the chart and recent-activity table —
// not the full platform history, but genuinely real data, not a mock.
async function fetchRecentOrders(maxPages = 8) {
  const first = await adminApi.listOrders({ page: 1, limit: 100 });
  const all = [...(first.orders || [])];
  const total = first.pagination?.total ?? all.length;
  const pages = Math.min(maxPages, Math.ceil(total / 100));
  for (let p = 2; p <= pages; p++) {
    const res = await adminApi.listOrders({ page: p, limit: 100 });
    all.push(...(res.orders || []));
  }
  return all;
}

export default function Dashboard() {
  const navigate = useNavigate();

  // Real live feed — the admin socket room only ever receives order:cancelled
  // and order:disputed. This replaces a setInterval that used to fabricate a
  // full fake transaction every 3.5s under a pulsing "live" indicator.
  const [feed, setFeed] = useState([]);
  useEffect(() => {
    const onUpdate = (e) => {
      const { type, order_id, reason } = e.detail || {};
      if (type !== 'cancelled' && type !== 'disputed') return;
      const next = { id: `${order_id}-${Date.now()}`, orderId: order_id, status: type, reason, time: new Date().toLocaleTimeString('en-GB') };
      setFeed((prev) => [next, ...prev].slice(0, 20));
    };
    window.addEventListener('order:update', onUpdate);
    return () => window.removeEventListener('order:update', onUpdate);
  }, []);

  // Real platform snapshot from the single aggregate endpoint.
  const { data: stats, loading: statsLoading } = useApi(() => adminApi.dashboard(), { fallback: null });

  // Real recent-orders window (chart + recent-activity table) and real,
  // unpaginated payout requests (chart's payout series + today's-payout KPI).
  const [orders, setOrders] = useState(null);
  const [payouts, setPayouts] = useState(null);
  useEffect(() => {
    let alive = true;
    fetchRecentOrders().then((rows) => alive && setOrders(rows)).catch(() => alive && setOrders([]));
    adminApi.listPayoutRequests({}).then((res) => alive && setPayouts(res.payout_requests || [])).catch(() => alive && setPayouts([]));
    return () => { alive = false; };
  }, []);

  // Real "requires attention" queue — same three real lists the Attention
  // page aggregates, top 4 most recent across all three.
  const [attentionItems, setAttentionItems] = useState([]);
  const [attentionTotal, setAttentionTotal] = useState(null);
  useEffect(() => {
    let alive = true;
    Promise.all([
      adminApi.listOrders({ status: 'under_review', limit: 10 }).catch(() => ({ orders: [] })),
      adminApi.listDisputes({ status: 'open' }).catch(() => ({ disputes: [] })),
      adminApi.listPayoutRequests({ status: 'dispute' }).catch(() => ({ payout_requests: [] })),
    ]).then(([o, d, p]) => {
      if (!alive) return;
      const reviewItems = (o.orders || []).map((row) => ({
        id: `order-${row.id}`,
        tone: 'blue',
        Icon: ArrowDownLeft,
        title: `Order #${row.id} under review`,
        detail: `${row.merchant?.business_name || 'Merchant'} · ${inr(row.amount_inr)} · ${ageLabel(row.created_at)}`,
        createdAt: row.created_at,
        onClick: () => navigate('/orders'),
      }));
      const disputeItems = (d.disputes || []).map((row) => ({
        id: `dispute-${row.id}`,
        tone: 'red',
        Icon: Scale,
        title: `Dispute on order #${row.order_id}`,
        detail: `${inr(row.order?.amount_inr)} · ${row.reason} · ${ageLabel(row.created_at)}`,
        createdAt: row.created_at,
        onClick: () => navigate('/disputes'),
      }));
      const payoutItems = (p.payout_requests || []).map((row) => ({
        id: `payout-${row.id}`,
        tone: 'amber',
        Icon: ArrowUpRight,
        title: `Payout #${row.id} disputed`,
        detail: `${row.merchant?.business_name || 'Merchant'} · ${inr(row.amount_inr)} · ${ageLabel(row.disputed_at || row.created_at)}`,
        createdAt: row.disputed_at || row.created_at,
        onClick: () => navigate('/payouts'),
      }));
      const merged = [...reviewItems, ...disputeItems, ...payoutItems].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setAttentionItems(merged.slice(0, 4));
      setAttentionTotal(reviewItems.length + disputeItems.length + payoutItems.length);
    });
    return () => { alive = false; };
  }, [navigate]);

  const dataLoading = orders === null || payouts === null;
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const payoutsToday = (payouts || []).filter((p) => new Date(p.created_at) >= todayStart);
  const payoutTodayInr = payoutsToday.reduce((sum, p) => sum + (Number(p.amount_inr) || 0), 0);

  const kpis = [
    {
      icon: ArrowDownLeft, tone: 'red', label: "Today's pay-in",
      value: statsLoading ? '—' : inr(stats?.volume_today_inr ?? 0),
      footnote: statsLoading ? '' : `${(stats?.transactions_today ?? 0).toLocaleString()} orders`,
      onSeeMore: () => navigate('/orders'),
    },
    {
      icon: ArrowUpRight, tone: 'blue', label: "Today's payout",
      value: dataLoading ? '—' : inr(payoutTodayInr),
      footnote: dataLoading ? '' : `${payoutsToday.length.toLocaleString()} requests`,
      onSeeMore: () => navigate('/payouts'),
    },
    {
      icon: Users, tone: 'green', label: 'Active traders',
      value: statsLoading ? '—' : (stats?.online_traders ?? 0).toLocaleString(),
      footnote: statsLoading ? '' : `of ${(stats?.active_traders ?? 0).toLocaleString()} total`,
      onSeeMore: () => navigate('/traders'),
    },
    {
      icon: Scale, tone: 'amber', label: 'Open disputes',
      value: statsLoading ? '—' : (stats?.open_disputes ?? 0).toLocaleString(),
      footnote: 'Awaiting resolution',
      onSeeMore: () => navigate('/disputes'),
    },
  ];

  const recentOrders = (orders || []).slice(0, 6);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Platform-wide overview and live activity"
        actions={statsLoading || dataLoading ? <InlineLoader /> : null}
      />

      {/* KPI row — all 4 real, computed above */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => <OverviewMetric key={k.label} {...k} />)}
      </div>

      {/* Chart + attention queue */}
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1.7fr_1fr]">
        <TransactionActivityChart orders={orders} payouts={payouts} loading={dataLoading} sampleSize={orders?.length} />
        <RequiresAttentionCard items={attentionItems} totalCount={attentionTotal} loading={attentionTotal === null} />
      </div>

      {/* Routing & capacity — no backend model exists for either concept
          (confirmed: no RoutingConfig/capacity table anywhere), so this stays
          a Preview card with no fabricated numbers rather than porting the
          design's mock progress bars. */}
      <Card className="mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: 0 }}>Routing &amp; capacity overview</h2>
              <Badge color="gray">Preview</Badge>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0 0' }}>
              No live routing/capacity backend exists yet — see the Routing and Capacity pages.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/routing')}
            style={{ border: 0, background: 'transparent', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 650, fontSize: 12, cursor: 'pointer' }}
          >
            Open routing <ArrowRight size={13} />
          </button>
        </div>
      </Card>

      {/* Recent operational activity — real, 6 most recent orders. */}
      <Card className="mt-6">
        <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--cardborder)' }}>
          <div>
            <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: 0 }}>Recent operational activity</h2>
            <p style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0 0' }}>Latest pay-in orders across the network</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/orders')}
            style={{ border: 0, background: 'transparent', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 650, fontSize: 12, cursor: 'pointer' }}
          >
            View all orders <ArrowRight size={13} />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ borderBottom: '1px solid var(--cardborder)', color: 'var(--muted)' }}>
                <th className="w-10 px-4 py-3" />
                <th className="px-4 py-3 font-medium">Merchant</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Trader</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Age</th>
              </tr>
            </thead>
            <tbody>
              {dataLoading ? (
                <tr><td colSpan={6} className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>Loading…</td></tr>
              ) : recentOrders.length === 0 ? (
                <tr><td colSpan={6} className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>No orders yet.</td></tr>
              ) : (
                recentOrders.map((o) => (
                  <tr key={o.id} className="tf-row-hover cursor-pointer" style={{ borderTop: '1px solid var(--cardborder)' }} onClick={() => navigate('/orders')}>
                    <td className="px-4 py-2.5">
                      <AdminIdPopover
                        rows={[
                          { label: 'Transaction ID', value: o.id },
                          { label: 'UUID', value: o.uuid },
                          { label: 'Merchant Order ID', value: o.merchant_order_id },
                          { label: 'Customer Reference', value: o.customer_ref },
                        ]}
                      />
                    </td>
                    <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--text)' }}>{o.merchant?.business_name || '—'}</td>
                    <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--text)' }}>{inr(o.amount_inr)}</td>
                    <td className="px-4 py-2.5" style={{ color: 'var(--muted)' }}>{o.trader?.id ? `#${o.trader.id}` : '—'}</td>
                    <td className="px-4 py-2.5"><Badge color="gray">{o.status}</Badge></td>
                    <td className="px-4 py-2.5" style={{ color: 'var(--muted)' }}>{ageLabel(o.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Live feed — real order:update socket events only. */}
      <Card className="mt-6 flex flex-col">
        <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--cardborder)' }}>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              {feed.length > 0 && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: feed.length > 0 ? '#22c55e' : 'var(--muted)' }} />
            </span>
            <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: 0 }}>Live Activity Feed</h2>
          </div>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Cancellations &amp; disputes · live</span>
        </div>
        <div className="tf-scroll max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0" style={{ background: 'var(--card)' }}>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-4 py-2 font-medium">Order ID</th>
                <th className="px-4 py-2 font-medium">Event</th>
                <th className="px-4 py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {feed.map((f) => (
                <tr key={f.id} style={{ borderTop: '1px solid var(--cardborder)' }}>
                  <td className="px-4 py-2.5 font-mono text-xs" style={{ color: 'var(--muted)' }}>{f.time}</td>
                  <td className="px-4 py-2.5 font-mono text-xs" style={{ color: 'var(--muted)' }}>{f.orderId}</td>
                  <td className="px-4 py-2.5">
                    <Badge color={feedStatus[f.status]}>{feedLabel[f.status]}</Badge>
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--muted)' }}>{f.reason || '—'}</td>
                </tr>
              ))}
              {feed.length === 0 && (
                <tr><td colSpan={4} className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>No live activity yet — cancellations and disputes will appear here as they happen.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
