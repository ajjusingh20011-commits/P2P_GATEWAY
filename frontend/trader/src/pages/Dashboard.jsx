import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Activity, TrendingUp, UserPlus, Repeat } from 'lucide-react';
import { Card, StatCard, Badge, Toggle, SearchInput, PageHeader } from '../components/ui';
import { CommissionSection, StatisticSection } from '../components/DashboardSections';
import { useApi } from '../hooks/useApi';
import { traderApi } from '../services/api';
import { balance, stats, ACCOUNT_TYPES } from '../utils/mock';

// Success-rate → red / yellow / green thresholds (shared with the currency widget).
function rateColor(rate) {
  if (rate >= 50) return { bar: 'bg-emerald-500', text: 'text-emerald-400', label: 'good', badge: 'green' };
  if (rate >= 30) return { bar: 'bg-amber-500', text: 'text-amber-400', label: 'monitor', badge: 'amber' };
  return { bar: 'bg-red-500', text: 'text-red-400', label: 'warning', badge: 'red' };
}

// Per-UPI success rate = confirmed orders / total orders on this payment detail,
// as COUNTS (not amounts). Zero orders → 0% with no divide-by-zero.
function deriveMetrics(d) {
  const successful = d.usage?.orders_confirmed ?? 0;
  const total = d.usage?.orders_total ?? 0;
  const hasUsage = total > 0;
  const rate = hasUsage ? Math.round((successful / total) * 100) : 0;
  return { successful, total, hasUsage, rate };
}

export default function Dashboard() {
  const { online, setOnline } = useOutletContext();
  const [query, setQuery] = useState('');
  const [details, setDetails] = useState([]);

  const { data: dash, loading } = useApi(
    () => traderApi.dashboard().then((res) => res.data.data),
    {
      fallback: {
        balance_usdt: balance,
        available_usdt: 0,
        locked_usdt: 0,
        commission_today_usdt: 0,
        commission_total_usdt: 0,
        my_rate: 4,
        base_rate: 100,
        trader_margin: 4,
        trader_rate: 104,
        rate_label: 'My Rate',
        commission_rate: 4,
        ftd_today: 0,
        std_today: 0,
        today_trades: stats.todayTrades,
        today_volume_inr: stats.todayVolume,
        success_rate: stats.successRate,
      },
    }
  );

  const loadDetails = async () => {
    try {
      const res = await traderApi.paymentDetails();
      setDetails(res?.data?.data?.payment_details || []);
    } catch (e) {
      setDetails([]);
    }
  };

  useEffect(() => {
    loadDetails();
    // Refresh when a new order arrives over the socket (re-emitted by the layout).
    const onOrder = () => loadDetails();
    window.addEventListener('order:new', onOrder);
    return () => window.removeEventListener('order:new', onOrder);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return details;
    return details.filter(
      (d) =>
        (d.account_name || '').toLowerCase().includes(q) ||
        (d.upi_id || '').toLowerCase().includes(q)
    );
  }, [details, query]);

  // Bucket each detail into Good / Paused Manually / New for the conversion widget.
  const sections = useMemo(() => {
    const good = [];
    const paused = [];
    const fresh = [];
    for (const d of filtered) {
      const { hasUsage } = deriveMetrics(d);
      const active = d.is_active_detail !== false && (d.is_active || d.is_active_detail);
      if (!active || d.is_active_detail === false) paused.push(d);
      else if (!hasUsage) fresh.push(d);
      else good.push(d);
    }
    return [
      { key: 'good', label: 'Good', accent: '#22c55e', items: good },
      { key: 'paused', label: 'Paused Manually', accent: 'var(--muted)', items: paused },
      { key: 'new', label: 'New', accent: '#3b82f6', items: fresh },
    ];
  }, [filtered]);

  // Stat cards — only My Rate + Success Rate live in the top grid now. Commission
  // and volume/trades moved to the dedicated sections below (Change 1).
  const statCards = [
    {
      label: dash.rate_label || 'My Rate',
      value: dash.trader_rate != null ? `₹${dash.trader_rate}` : '—',
      sub: `Base ₹${dash.base_rate ?? 100} + margin ${dash.trader_margin ?? dash.my_rate ?? 0}%`,
      icon: Activity,
      accent: '#14b8c4',
    },
    { label: 'Success Rate', value: `${dash.success_rate}%`, sub: 'All-time', icon: TrendingUp, accent: '#8b5cf6' },
    // FTD vs STD split for today (Order System v2).
    { label: 'FTD orders today', value: dash.ftd_today ?? 0, sub: 'First-time deposits', icon: UserPlus, accent: '#22c55e' },
    { label: 'STD orders today', value: dash.std_today ?? 0, sub: 'Returning customers', icon: Repeat, accent: '#3b82f6' },
  ];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Overview of your trading activity"
        actions={
          <div className="flex items-center gap-2">
            {loading && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Loading…</span>}
            <div
              className="flex items-center gap-2"
              style={{ borderRadius: 12, border: '1px solid var(--cardborder)', background: 'var(--card)', padding: '8px 12px' }}
            >
              <Activity size={16} style={{ color: online ? '#22c55e' : 'var(--muted)' }} />
              <span style={{ fontSize: 14, fontWeight: 500, color: online ? '#22c55e' : 'var(--muted)' }}>
                {online ? 'Online' : 'Offline'}
              </span>
              <Toggle checked={online} onChange={setOnline} />
            </div>
          </div>
        }
      />

      {/* Earnings & activity (USDT). Balance lives in the sidebar, so it is not
          duplicated here. */}
      <div className="tf-grid" style={{ marginBottom: 18 }}>
        {statCards.map((s, i) => (
          <StatCard
            key={s.label}
            label={s.label}
            value={s.value}
            sub={s.sub}
            icon={s.icon}
            accent={s.accent}
            index={i}
          />
        ))}
      </div>

      {/* Commission (real data) + Statistic (demo — real pay-in/payout later) */}
      <div className="tf-two" style={{ marginBottom: 18 }}>
        <div className="tf-enter" style={{ animationDelay: '0.15s' }}><CommissionSection /></div>
        <div className="tf-enter" style={{ animationDelay: '0.25s' }}><StatisticSection /></div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Payment Details Conversion — spans 2 cols */}
        <Card className="flex flex-col xl:col-span-2">
          <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--cardborder)' }}>
            <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: 0 }}>Payment Details Conversion</h2>
            <Badge color="green">{details.length} total</Badge>
          </div>
          <div className="p-4">
            <SearchInput value={query} onChange={setQuery} placeholder="Search account or UPI…" />

            <div className="mt-4 space-y-5">
              {sections.map((s) => (
                s.items.length > 0 && (
                  <div key={s.key}>
                    <div className="mb-2 flex items-center gap-2">
                      <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: s.accent }}>{s.label}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>({s.items.length})</span>
                    </div>
                    <ul className="space-y-3">
                      {s.items.map((d) => {
                        const type = ACCOUNT_TYPES[d.account_type] || { label: d.account_type, color: 'gray' };
                        const { successful, total, hasUsage, rate } = deriveMetrics(d);
                        const c = rateColor(rate);
                        const isNew = s.key === 'new';
                        return (
                          <li
                            key={d.id}
                            className="px-4 py-3"
                            style={{ borderRadius: 12, border: '1px solid var(--cardborder)', background: 'var(--hover)' }}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="truncate text-sm font-medium" style={{ color: 'var(--text)' }}>{d.account_name}</p>
                                  <Badge color={type.color}>{type.label}</Badge>
                                </div>
                                <p className="truncate text-xs" style={{ color: 'var(--muted)' }}>{d.upi_id}</p>
                              </div>
                              <div className="text-right">
                                <p className={`text-sm font-semibold ${isNew ? '' : c.text}`} style={isNew ? { color: 'var(--muted)' } : undefined}>
                                  {isNew ? '—' : `${Math.round(rate)}%`}
                                </p>
                                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                                  {isNew ? 'No transactions' : `${successful} / ${total}`}
                                </p>
                              </div>
                            </div>
                            <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: 'var(--hover)' }}>
                              <div
                                className={`h-full ${s.key === 'paused' ? 'bg-gray-400' : c.bar}`}
                                style={{ width: `${isNew ? 0 : Math.round(rate)}%` }}
                              />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )
              ))}

              {details.length === 0 && (
                <p className="py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>No payment details yet.</p>
              )}
              {details.length > 0 && filtered.length === 0 && (
                <p className="py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>No matching accounts.</p>
              )}
            </div>
          </div>
        </Card>

        {/* Values by Currency — static conversion legend */}
        <Card className="flex flex-col">
          <div className="p-4" style={{ borderBottom: '1px solid var(--cardborder)' }}>
            <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: 0 }}>Values by Currency</h2>
          </div>
          <div className="space-y-4 p-4">
            {[
              { range: 'Up to 30%', bar: 'bg-red-500', text: 'text-red-400', note: 'Payment details can be disabled automatically' },
              { range: '30–50%', bar: 'bg-amber-500', text: 'text-amber-400', note: 'Average success rate. Keep monitoring' },
              { range: '50%+', bar: 'bg-emerald-500', text: 'text-emerald-400', note: 'Good conversion rate' },
            ].map((r) => (
              <div key={r.range} className="p-3" style={{ borderRadius: 12, border: '1px solid var(--cardborder)', background: 'var(--hover)' }}>
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-semibold ${r.text}`}>{r.range}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: 'var(--hover)' }}>
                  <div className={`h-full w-full ${r.bar}`} />
                </div>
                <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>{r.note}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
