import { useEffect, useMemo, useState } from 'react';
import { Card, StatCard, Badge, PageHeader } from '../components/ui';
import { IconRupee, IconTransactions, IconActivity, IconClock, IconBalance, IconTrendUp } from '../components/icons';
import { stats, revenue30Days, transactions, ACCOUNT_TYPES, inr, usdt, pct } from '../utils/mock';
import { useApi } from '../hooks/useApi';
import { merchantApi } from '../services/api';

function RevenueChart({ data }) {
  const [hover, setHover] = useState(null);
  if (!data || data.length === 0) {
    return (
      <div className="flex h-44 items-center justify-center text-sm" style={{ color: 'var(--muted)' }}>
        No revenue data yet
      </div>
    );
  }
  const max = Math.max(...data.map((d) => d.inr)) || 1;
  return (
    <div>
      <div className="flex h-44 items-end gap-1">
        {data.map((d, i) => {
          const h = Math.round((d.inr / max) * 100);
          return (
            <div
              key={d.day}
              className="group relative flex flex-1 items-end"
              style={{ minHeight: '150px' }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <div
                className="w-full rounded-t bg-gradient-to-t from-violet-500/40 to-violet-500 transition-all hover:to-violet-400"
                style={{ height: `${h}%` }}
              />
              {hover === i && (
                <div
                  className="pointer-events-none absolute -top-10 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1 text-[10px] shadow-lg"
                  style={{ background: 'var(--card)', border: '1px solid var(--cardborder)', color: 'var(--text)', boxShadow: 'var(--shadow)' }}
                >
                  {d.day}<br />{inr(d.inr)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px]" style={{ color: 'var(--muted)' }}>
        <span>{data[0].day}</span>
        <span>{data[Math.floor(data.length / 2)].day}</span>
        <span>{data[data.length - 1].day}</span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const recent = transactions.slice(0, 10);

  const { data: d, loading, refetch } = useApi(
    () => merchantApi.dashboard().then((res) => res.data.data),
    { fallback: stats }
  );

  // Refresh dashboard stats when a real-time order event arrives.
  useEffect(() => {
    const onUpdate = () => { if (typeof refetch === 'function') refetch(); };
    window.addEventListener('order:update', onUpdate);
    return () => window.removeEventListener('order:update', onUpdate);
  }, [refetch]);

  const cards = useMemo(
    () => [
      { label: "Today's Collections", value: inr(d.today_collections_inr ?? stats.todayCollections), icon: IconRupee, accent: 'indigo', trend: { up: true, value: '9.2% vs yesterday' } },
      { label: 'Total Transactions', value: (d.total_orders_today ?? stats.totalTransactions).toLocaleString(), icon: IconTransactions, accent: 'sky' },
      { label: 'Success Rate', value: pct(d.success_rate ?? stats.successRate), icon: IconActivity, accent: 'emerald' },
      { label: 'Pending Orders', value: d.pending_orders ?? stats.pendingOrders, icon: IconClock, accent: 'amber' },
      { label: 'USDT Balance', value: usdt(d.balance_usdt ?? d.balance ?? stats.balanceUsdt), icon: IconBalance, accent: 'violet' },
      { label: 'Pay-in Fee', value: `${d.payin_fee_percent ?? 0}%`, sub: d.payout_fee_percent != null ? `Pay-out ${d.payout_fee_percent}%` : undefined, icon: IconTrendUp, accent: 'rose' },
    ],
    [d]
  );

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={loading ? 'Loading your payments…' : 'Your payments at a glance'}
      />

      <div className="tf-grid">
        {cards.map((c, i) => (
          <StatCard key={c.label} {...c} index={i} />
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: 0 }}>Daily Revenue</h2>
            <Badge color="indigo">Last 30 days</Badge>
          </div>
          <RevenueChart data={revenue30Days} />
        </Card>

        <Card className="flex flex-col">
          <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--cardborder)' }}>
            <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: 0 }}>Recent Transactions</h2>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>Last 10</span>
          </div>
          <ul>
            {recent.length === 0 && (
              <li className="px-4 py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>No data yet</li>
            )}
            {recent.map((t, i) => (
              <li key={t.id} className="flex items-center justify-between px-4 py-2.5" style={{ borderTop: i === 0 ? 'none' : '1px solid var(--cardborder)' }}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" style={{ color: 'var(--text)' }}>{t.sender}</p>
                  <p className="truncate text-xs" style={{ color: 'var(--muted)' }}>{t.id} · {ACCOUNT_TYPES[t.method].label}</p>
                </div>
                <span className="text-sm font-semibold" style={{ color: '#22c55e' }}>{inr(t.amountInr)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
