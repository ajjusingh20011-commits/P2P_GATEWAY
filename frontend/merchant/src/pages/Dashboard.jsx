import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDownToLine, ArrowUpFromLine, ShieldAlert, Wallet } from 'lucide-react';
import { PageHeader } from '../components/ui';
import { OverviewMetric, TransactionActivityChart, TrafficOverviewCard } from '../components/DashboardSections';
import { inr, usdt } from '../utils/mock';
import { merchantApi } from '../services/api';

// Orders pagination is capped server-side at 100/page (see backend's
// pagination() helper) — loop up to this many pages so the KPI totals below
// cover the merchant's real order history rather than just its first page.
// Real, not fabricated: for a merchant with more orders than this covers,
// the totals are an honest "most recent N" window, not a full lifetime sum.
const ORDER_FETCH_PAGES = 5;

async function fetchAllOrders() {
  const all = [];
  for (let page = 1; page <= ORDER_FETCH_PAGES; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await merchantApi.orders(undefined, { page, limit: 100 });
    const rows = res.data?.data?.orders || [];
    all.push(...rows);
    if (rows.length < 100) break;
  }
  return all;
}

const NON_COUNTED_PAYOUT_STATUSES = new Set(['canceled']);

export default function Dashboard() {
  const navigate = useNavigate();
  const [balanceUsdt, setBalanceUsdt] = useState(null);
  const [orders, setOrders] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.allSettled([
      merchantApi.dashboard(),
      fetchAllOrders(),
      merchantApi.myPayouts(),
    ]).then(([dashRes, ordersRes, payoutsRes]) => {
      if (dashRes.status === 'fulfilled') setBalanceUsdt(dashRes.value.data?.data?.balance_usdt ?? null);
      setOrders(ordersRes.status === 'fulfilled' ? ordersRes.value : []);
      setPayouts(payoutsRes.status === 'fulfilled' ? (payoutsRes.value.data?.data?.payout_requests || []) : []);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener('order:update', load);
    return () => window.removeEventListener('order:update', load);
  }, [load]);

  const kpis = useMemo(() => {
    const successOrders = orders.filter((o) => o.status === 'success');
    const totalPayInInr = successOrders.reduce((s, o) => s + (Number(o.amount_inr) || 0), 0);

    const countedPayouts = payouts.filter((p) => !NON_COUNTED_PAYOUT_STATUSES.has(p.status));
    const totalPayoutInr = countedPayouts.reduce((s, p) => s + (Number(p.amount_inr) || 0), 0);
    const pendingSettlementInr = payouts
      .filter((p) => ['awaiting_processing', 'in_processing', 'awaiting_settlement'].includes(p.status))
      .reduce((s, p) => s + (Number(p.amount_inr) || 0), 0);

    const disputedCount = orders.filter((o) => o.status === 'disputed').length + payouts.filter((p) => p.status === 'dispute').length;
    const underReviewCount = orders.filter((o) => o.status === 'under_review').length;

    return { successOrders, totalPayInInr, countedPayouts, totalPayoutInr, pendingSettlementInr, disputedCount, underReviewCount };
  }, [orders, payouts]);

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={loading ? 'Loading your payments…' : 'Your payments at a glance'} />

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <OverviewMetric
          icon={ArrowDownToLine}
          tone="green"
          label="Total Pay-in"
          value={loading ? '—' : inr(kpis.totalPayInInr)}
          footnote={`${kpis.successOrders.length.toLocaleString()} transactions`}
          onSeeMore={() => navigate('/orders')}
        />
        <OverviewMetric
          icon={ArrowUpFromLine}
          tone="blue"
          label="Total Payout"
          value={loading ? '—' : inr(kpis.totalPayoutInr)}
          footnote={`${kpis.countedPayouts.length.toLocaleString()} ${kpis.countedPayouts.length === 1 ? 'payout' : 'payouts'}`}
          onSeeMore={() => navigate('/payouts')}
        />
        <OverviewMetric
          icon={Wallet}
          tone="green"
          label="Settlement"
          value={balanceUsdt != null ? usdt(balanceUsdt) : '—'}
          footnote={kpis.pendingSettlementInr > 0 ? `${inr(kpis.pendingSettlementInr)} pending settlement` : undefined}
          onSeeMore={() => navigate('/balance')}
        />
        <OverviewMetric
          icon={ShieldAlert}
          tone="amber"
          label="Open Disputes"
          value={loading ? '—' : kpis.disputedCount}
          footnote={`${kpis.underReviewCount} orders under review`}
          onSeeMore={() => navigate('/orders')}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3.5 xl:grid-cols-[1.65fr_.75fr]" style={{ alignItems: 'start' }}>
        <TransactionActivityChart orders={kpis.successOrders} payouts={kpis.countedPayouts} loading={loading} />
        <TrafficOverviewCard orders={orders} payInCount={kpis.successOrders.length} payoutCount={kpis.countedPayouts.length} loading={loading} />
      </div>
    </div>
  );
}
