import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers3, TrendingUp, ShieldCheck, Plus } from 'lucide-react';
import { Card, Badge, SearchInput, Button } from '../components/ui';
import { CommissionSection, AttentionSection, LivePoolSection, TransactionActivityChart } from '../components/DashboardSections';
import { useApi } from '../hooks/useApi';
import { traderApi } from '../services/api';
import { balance, stats, inr, ACCOUNT_TYPES } from '../utils/mock';

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

// ₹ lakh-compact formatter, matching the reference's `compact()` helper.
const compact = (n) => (n >= 100000 ? `₹${(n / 100000).toFixed(2)}L` : inr(n));

// Reference's .overviewMetric shell: icon in a left column, label/value/sub
// stacked on the right. No `delta`/`period` slot is rendered unless a real
// one is passed in — the reference shows a delta% and a period dropdown on
// every card, but today's volume and success rate have no real weekly/
// monthly or trend source on this backend, so those stay single-period with
// no fabricated comparison number.
function OverviewMetric({ label, value, sub, icon: Icon, tone, period }) {
  return (
    <Card style={{ position: 'relative', minHeight: 148, padding: 18, display: 'grid', gridTemplateColumns: '46px 1fr', gap: 12, alignItems: 'start' }}>
      <span
        style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: tone.bg, color: tone.fg }}
      >
        <Icon size={20} />
      </span>
      <div>
        <small style={{ display: 'block', color: 'var(--muted)', fontSize: 12 }}>{label}</small>
        <strong style={{ display: 'block', fontSize: 23, letterSpacing: '-.4px', margin: '8px 0', color: 'var(--text)' }}>{value}</strong>
        {sub && <em style={{ display: 'block', fontStyle: 'normal', color: 'var(--muted)', fontSize: 11 }}>{sub}</em>}
      </div>
      {period}
    </Card>
  );
}
const METRIC_TONE = {
  purple: { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  green: { bg: 'rgba(34,197,94,.14)', fg: '#22c55e' },
  blue: { bg: 'rgba(59,130,246,.14)', fg: '#3b82f6' },
};

export default function Dashboard() {
  const navigate = useNavigate();
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
        base_rate: 100,
        trader_margin: 4,
        trader_rate: 104,
        commission_rate: 4,
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

  // Real success-rate distribution across accounts with order history — same
  // red/amber/green bands rateColor() uses above. Replaces a previous
  // permanently-hardcoded-full-width "Values by Currency" widget that never
  // reflected any real data (there's also only one currency, INR, so a
  // by-currency breakdown never applied here).
  const rateBands = useMemo(() => {
    const withUsage = details.filter((d) => deriveMetrics(d).hasUsage);
    const bands = [
      { range: 'Up to 30%', bar: 'bg-red-500', text: 'text-red-400', note: 'Payment details can be disabled automatically', test: (r) => r < 30 },
      { range: '30–50%', bar: 'bg-amber-500', text: 'text-amber-400', note: 'Average success rate. Keep monitoring', test: (r) => r >= 30 && r < 50 },
      { range: '50%+', bar: 'bg-emerald-500', text: 'text-emerald-400', note: 'Good conversion rate', test: (r) => r >= 50 },
    ];
    return bands.map((b) => {
      const count = withUsage.filter((d) => b.test(deriveMetrics(d).rate)).length;
      const pct = withUsage.length ? Math.round((count / withUsage.length) * 100) : 0;
      return { ...b, count, pct };
    });
  }, [details]);
  const hasRateData = rateBands.some((b) => b.count > 0);

  // Top stat row — exactly the set the approved design calls for. No My
  // Rate / FTD / STD cards (FTD/STD is an admin-only concept, not shown on
  // the trader panel at all) and no score/health metric (none is computed
  // anywhere in the backend, so none is shown — correction 1). Today's
  // Volume and Success Rate have no real weekly/monthly source, so they stay
  // single-period; Commission Earned (below, its own component) is the only
  // card with a real period selector since /trader/commission genuinely
  // backs today/week/month.
  const statCards = [
    { label: 'Total UPI accounts', value: details.length, sub: 'All connected accounts', icon: Layers3, tone: METRIC_TONE.purple },
    { label: "Today's volume", value: compact(dash.today_volume_inr ?? 0), sub: `${dash.today_trades ?? 0} processed orders`, icon: TrendingUp, tone: METRIC_TONE.blue },
    { label: 'Success rate', value: `${dash.success_rate}%`, sub: 'Today', icon: ShieldCheck, tone: METRIC_TONE.green },
  ];

  return (
    <div>
      <div className="flex justify-end" style={{ marginBottom: 16 }}>
        {loading && <span style={{ fontSize: 12, color: 'var(--muted)', marginRight: 12, alignSelf: 'center' }}>Loading…</span>}
        <Button onClick={() => navigate('/offers')}>
          <Plus size={16} />
          Add payment detail
        </Button>
      </div>

      {/* 4 equal top-row cards: 3 real single-period metrics (no delta% or
          period dropdown — the backend has no weekly/monthly or trend source
          for volume/success-rate, so nothing fake is shown in their place)
          + Commission Earned (its own component, with a real today/week/month
          period selector since /trader/commission genuinely backs all three).
          Balance lives in the sidebar, so it is not duplicated here. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" style={{ marginBottom: 18 }}>
        {statCards.map((s, i) => (
          <div key={s.label} className="tf-enter" style={{ animationDelay: `${i * 0.1}s` }}>
            <OverviewMetric label={s.label} value={s.value} sub={s.sub} icon={s.icon} tone={s.tone} />
          </div>
        ))}
        <div className="tf-enter" style={{ animationDelay: '0.3s' }}><CommissionSection /></div>
      </div>

      {/* Transaction activity (65%, real order/payout data) + Requires
          attention (35%, real device/payout data) — same row. Live pool
          (real payment-details data) spans full width in the row below via
          its own .tf-livepool-full class, matching the design's dashboardCore
          layout (chart + attention side-by-side, live pool full-width). */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.65fr_.72fr]" style={{ marginBottom: 18 }}>
        <div className="tf-enter" style={{ animationDelay: '0.15s' }}>
          <TransactionActivityChart />
        </div>
        <div className="tf-enter" style={{ animationDelay: '0.25s' }}><AttentionSection /></div>
        <div className="tf-enter" style={{ animationDelay: '0.2s' }}>
          <LivePoolSection details={details} todayVolumeInr={dash.today_volume_inr ?? 0} onChanged={loadDetails} />
        </div>
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

        {/* Success Rate Distribution — real counts/percentages of this
            trader's own accounts, grouped into the same rate bands used
            above (formerly a "Values by Currency" widget whose bars were
            hardcoded to 100% width regardless of any real data). */}
        <Card className="flex flex-col">
          <div className="p-4" style={{ borderBottom: '1px solid var(--cardborder)' }}>
            <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: 0 }}>Success Rate Distribution</h2>
            <p style={{ color: 'var(--muted)', fontSize: 12, margin: '3px 0 0' }}>Accounts with order history, by conversion rate</p>
          </div>
          <div className="space-y-4 p-4">
            {rateBands.map((r) => (
              <div key={r.range} className="p-3" style={{ borderRadius: 12, border: '1px solid var(--cardborder)', background: 'var(--hover)' }}>
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-semibold ${r.text}`}>{r.range}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{r.count} account{r.count === 1 ? '' : 's'}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: 'var(--hover)' }}>
                  <div className={`h-full ${r.bar}`} style={{ width: `${r.pct}%` }} />
                </div>
                <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>{r.note}</p>
              </div>
            ))}
            {!hasRateData && (
              <p className="py-2 text-center text-xs" style={{ color: 'var(--muted)' }}>No accounts with order history yet.</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
