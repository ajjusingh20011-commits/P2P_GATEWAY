import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers3, TrendingUp, ShieldCheck, Plus } from 'lucide-react';
import { Card, StatCard, Badge, SearchInput, Button } from '../components/ui';
import { CommissionSection, AttentionSection, LivePoolSection } from '../components/DashboardSections';
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

  // Live pool = payment details actually gated live for routing right now
  // (is_active), not just toggled on — same distinction Offers.jsx enforces.
  const livePoolCount = useMemo(() => details.filter((d) => d.is_active).length, [details]);

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
    { label: 'Total UPI Accounts', value: details.length, sub: 'All connected accounts', icon: Layers3, accent: '#8b5cf6' },
    { label: "Today's Volume", value: inr(dash.today_volume_inr ?? 0), sub: 'Today', icon: TrendingUp, accent: '#14b8c4' },
    { label: 'Success Rate', value: `${dash.success_rate}%`, sub: 'Today', icon: ShieldCheck, accent: '#22c55e' },
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

      {/* 4 equal top-row cards: 3 real single-period metrics + Commission
          Earned (its own component — the only one with a real period toggle).
          Balance lives in the sidebar, so it is not duplicated here. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" style={{ marginBottom: 18 }}>
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
        <div className="tf-enter" style={{ animationDelay: '0.3s' }}><CommissionSection /></div>
      </div>

      {/* Live pool (65%, real payment-details data) + Requires attention
          (35%, real device/payout data) — same row. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.85fr_1fr]" style={{ marginBottom: 18 }}>
        <div className="tf-enter" style={{ animationDelay: '0.15s' }}>
          <LivePoolSection details={details} todayVolumeInr={dash.today_volume_inr ?? 0} />
        </div>
        <div className="tf-enter" style={{ animationDelay: '0.25s' }}><AttentionSection /></div>
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
