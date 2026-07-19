import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, StatCard, Badge, PageHeader, InlineLoader } from '../components/ui';
import { useApi } from '../hooks/useApi';
import { adminApi } from '../services/api';
import { IconRupee, IconUsers, IconMerchants, IconOrders, IconActivity, IconWallet, IconTrendUp } from '../components/icons';
import {
  dashboardStats,
  volume7Days,
  successVsFailed,
  topTraders,
  topMerchants,
  liveFeedSeed,
  merchants,
  traders,
  ACCOUNT_TYPES,
  inr,
  compact,
  usdt,
  pct,
} from '../utils/mock';

const feedStatus = {
  confirmed: 'green',
  paid: 'sky',
  assigned: 'amber',
  expired: 'gray',
  disputed: 'red',
};

/** Simple SVG bar chart for 7-day volume. */
function VolumeChart({ data }) {
  const max = Math.max(...data.map((d) => d.inr));
  return (
    <div className="flex h-48 items-end justify-between gap-3 px-1">
      {data.map((d) => {
        const h = Math.round((d.inr / max) * 100);
        return (
          <div key={d.day} className="flex flex-1 flex-col items-center gap-2">
            <div className="relative flex w-full flex-1 items-end" style={{ minHeight: '150px' }}>
              <div
                className="group w-full rounded-t-md bg-gradient-to-t from-red-600/40 to-red-500 transition-all hover:from-red-500 hover:to-red-400"
                style={{ height: `${h}%` }}
                title={inr(d.inr)}
              >
                <span className="pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium opacity-0 transition group-hover:opacity-100" style={{ color: 'var(--muted)' }}>
                  {compact(d.inr)}
                </span>
              </div>
            </div>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>{d.day}</span>
          </div>
        );
      })}
    </div>
  );
}

/** SVG donut for success vs failed. */
function DonutChart({ success, failed }) {
  const total = success + failed || 1;
  const successPct = (success / total) * 100;
  const r = 42;
  const c = 2 * Math.PI * r;
  const successLen = (successPct / 100) * c;
  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 120 120" className="h-36 w-36 -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="currentColor" className="text-red-500/20" strokeWidth="14" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="currentColor"
          className="text-emerald-500"
          strokeWidth="14"
          strokeDasharray={`${successLen} ${c}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="space-y-3">
        <div>
          <p style={{ color: 'var(--text)', fontSize: 24, fontWeight: 800, margin: 0 }}>{pct(successPct)}</p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Success rate</p>
        </div>
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <span style={{ color: 'var(--muted)' }}>Success</span>
            <span className="ml-auto font-medium" style={{ color: 'var(--text)' }}>{success.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500/40" />
            <span style={{ color: 'var(--muted)' }}>Failed</span>
            <span className="ml-auto font-medium" style={{ color: 'var(--text)' }}>{failed.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [feed, setFeed] = useState(liveFeedSeed);
  const counter = useRef(0);

  // Live stats from the backend; the mock aggregates act as the fallback.
  const { data: api, loading } = useApi(() => adminApi.dashboard(), { fallback: null });

  // Simulate a live transaction feed: prepend a new transaction every 3.5s,
  // keeping the list capped at 20 rows.
  useEffect(() => {
    const id = setInterval(() => {
      counter.current += 1;
      const seed = counter.current;
      const merchant = merchants[seed % merchants.length];
      const trader = traders[(seed * 3) % traders.length];
      const methods = Object.keys(ACCOUNT_TYPES);
      const statuses = ['confirmed', 'paid', 'confirmed', 'assigned', 'expired'];
      const now = new Date();
      const next = {
        id: 200000 + seed,
        amountInr: 500 + ((seed * 971) % 40000),
        merchant: merchant.businessName,
        trader: trader.name,
        method: methods[seed % methods.length],
        status: statuses[seed % statuses.length],
        time: now.toLocaleTimeString('en-GB'),
        fresh: true,
      };
      setFeed((prev) => [next, ...prev].slice(0, 20));
    }, 3500);
    return () => clearInterval(id);
  }, []);

  const s = dashboardStats;

  // Prefer live API fields; fall back to mock aggregates when absent.
  const stats = useMemo(
    () => [
      { label: "Today's Volume", value: inr(api?.volume_today_inr ?? s.volumeTodayInr), icon: IconRupee, accent: 'red' },
      { label: 'Active Traders', value: api?.active_traders ?? s.activeTraders, icon: IconUsers, accent: 'sky', sub: `${traders.length} total` },
      { label: 'Active Merchants', value: api?.active_merchants ?? s.activeMerchants, icon: IconMerchants, accent: 'violet', sub: `${merchants.length} total` },
      { label: "Today's Transactions", value: (api?.transactions_today ?? s.transactionsToday).toLocaleString(), icon: IconOrders, accent: 'amber' },
      { label: 'Success Rate', value: pct(api?.success_rate ?? s.successRate), icon: IconActivity, accent: 'emerald' },
      { label: 'Platform Revenue', value: usdt(api?.platform_revenue_usdt ?? s.platformRevenueUsdt), icon: IconWallet, accent: 'rose' },
    ],
    [s, api]
  );

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Platform-wide overview and live activity"
        actions={loading ? <InlineLoader /> : null}
      />

      {/* Stats */}
      <div className="tf-grid">
        {stats.map((st, i) => (
          <StatCard key={st.label} {...st} index={i} />
        ))}
      </div>

      {/* Charts row */}
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: 0 }}>Transaction Volume</h2>
            <Badge color="sky">Last 7 days</Badge>
          </div>
          <VolumeChart data={volume7Days} />
        </Card>

        <Card className="p-5">
          <h2 className="mb-4" style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16 }}>Success vs Failed</h2>
          <DonutChart success={successVsFailed.success} failed={successVsFailed.failed} />
        </Card>
      </div>

      {/* Top lists */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <IconTrendUp className="h-4 w-4 text-emerald-400" />
            <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: 0 }}>Top Traders by Volume</h2>
          </div>
          <ul>
            {topTraders.map((t, i) => (
              <li key={t.id} className="flex items-center gap-3 py-2.5" style={{ borderTop: i === 0 ? 'none' : '1px solid var(--cardborder)' }}>
                <span className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold" style={{ background: 'var(--hover)', color: 'var(--muted)' }}>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" style={{ color: 'var(--text)' }}>{t.name}</p>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>#{t.id} · {pct(t.successRate)} success</p>
                </div>
                <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{inr(t.volume)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <IconTrendUp className="h-4 w-4 text-emerald-400" />
            <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: 0 }}>Top Merchants by Volume</h2>
          </div>
          <ul>
            {topMerchants.map((m, i) => (
              <li key={m.id} className="flex items-center gap-3 py-2.5" style={{ borderTop: i === 0 ? 'none' : '1px solid var(--cardborder)' }}>
                <span className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold" style={{ background: 'var(--hover)', color: 'var(--muted)' }}>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" style={{ color: 'var(--text)' }}>{m.name}</p>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>#{m.id}</p>
                </div>
                <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{inr(m.volume)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Live feed */}
      <Card className="mt-6 flex flex-col">
        <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--cardborder)' }}>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: 0 }}>Live Transaction Feed</h2>
          </div>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Last 20 · live</span>
        </div>
        <div className="tf-scroll max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0" style={{ background: 'var(--card)' }}>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-4 py-2 font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Merchant</th>
                <th className="px-4 py-2 font-medium">Trader</th>
                <th className="px-4 py-2 font-medium">Method</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {feed.map((f) => (
                <tr key={f.id} style={{ borderTop: '1px solid var(--cardborder)', background: f.fresh ? 'rgba(34,197,94,.05)' : 'transparent' }} className={f.fresh ? 'animate-[pulse_1s_ease-in-out_1]' : ''}>
                  <td className="px-4 py-2.5 font-mono text-xs" style={{ color: 'var(--muted)' }}>{f.time}</td>
                  <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--text)' }}>{inr(f.amountInr)}</td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--muted)' }}>{f.merchant}</td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--muted)' }}>{f.trader}</td>
                  <td className="px-4 py-2.5">
                    <Badge color={ACCOUNT_TYPES[f.method].color}>{ACCOUNT_TYPES[f.method].label}</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge color={feedStatus[f.status]}>{f.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
