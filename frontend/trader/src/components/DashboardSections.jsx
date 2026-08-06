import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Coins, Smartphone, Clock3, ChevronRight, CheckCircle2, ArrowRight, MoreHorizontal, TrendingUp, ShieldCheck } from 'lucide-react';
import { traderApi } from '../services/api';
import { getDevices } from '../lib/ngoApi';
import { BankBadge, Segments } from './ui';
import { IconRobot, IconGlobe } from './icons';
import { toast } from './Toaster';
import { ACCOUNT_TYPES, inr } from '../utils/mock';
import ConfirmModal from './ConfirmModal';

/*
  Dashboard sections used below the trader stat grid:

  - CommissionSection: REAL data from GET /trader/commission?period=. The big
    number toggles between ₹ (INR) and USDT on click; it counts up on change.
  - VolumeStatCard / SuccessRateStatCard: REAL data from GET /trader/stats?
    period=, a dedicated endpoint (not a param on /dashboard, whose other
    fields are genuinely today/point-in-time and shouldn't become ambiguous
    based on a volume-card period selector). Each card owns its own period
    state, matching the design's independent-per-card selectors.
  - TransactionActivityChart: REAL data — confirmed orders (pay-in) and
    completed payout requests (payout), fetched once and bucketed client-side
    into the selected range (1H/1D/7D/30D). No random/synthetic points; an
    empty range shows a genuine empty state.
  - LivePoolSection: REAL payment-details data already fetched by Dashboard
    (is_active accounts), joined with real device names (getDevices(), same
    source Smartphones.jsx/AttentionSection already read) and real
    in-processing payout totals (traderApi.payoutRequests, same source
    BuyUsdt.jsx reads) for the summary strip. Success rate is the same real
    confirmed/total ratio used elsewhere on this page — no separate "score"
    metric is shown since none is computed anywhere in the backend.
  - AttentionSection: REAL data from two existing sources — device online
    state (same field Smartphones.jsx's own poll reads) and in-processing
    payout requests' expires_at (same field BuyUsdt.jsx reads). No score/
    health-based alert; if nothing is real-actionable it shows a genuine
    empty state rather than a padded placeholder.
*/

function hexA(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const prefersReduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Column widths for the Dashboard's full-width Live Pool table (reuses
// Trades' .tradeLedgerHead/.tradeLedgerRow typography at a wider template).
const LIVE_POOL_GRID = '31px minmax(170px,1.3fr) minmax(110px,.8fr) minmax(130px,.9fr) 70px minmax(90px,.7fr) minmax(100px,.85fr) minmax(85px,.7fr) 56px 40px';

const PERIODS = ['today', 'week', 'month'];
const TAB_LABEL = { today: 'Today', week: 'Weekly', month: 'Monthly' };
const NOTE = { today: 'Today', week: 'Last week', month: 'Last month' };

function fmtValue(val, cur) {
  if (cur === 'inr') return '₹' + val.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return val.toLocaleString(undefined, { maximumFractionDigits: 4 }) + ' USDT';
}

// ---- Commission section (REAL data) --------------------------------------
export function CommissionSection() {
  const [period, setPeriod] = useState('today');
  const [cur, setCur] = useState('inr'); // 'inr' | 'usdt'
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const fetchFor = (p) => {
    let alive = true;
    setLoading(true);
    setError(false);
    traderApi
      .commission(p)
      .then((res) => { if (alive) setData(res.data.data); })
      .catch(() => { if (alive) setError(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  };

  useEffect(() => fetchFor(period), [period]);

  // Refresh the active period when a real-time order event arrives.
  useEffect(() => {
    const onUpdate = () => fetchFor(period);
    window.addEventListener('order:update', onUpdate);
    window.addEventListener('order:new', onUpdate);
    return () => {
      window.removeEventListener('order:update', onUpdate);
      window.removeEventListener('order:new', onUpdate);
    };
  }, [period]);

  // Count up only when the NUMBER changes (new data / period / live refresh),
  // NOT when the currency is toggled — so flipping ₹↔USDT is instant, no rerun.
  const [reveal, setReveal] = useState(1);
  useEffect(() => {
    if (prefersReduced()) { setReveal(1); return undefined; }
    setReveal(0);
    let raf;
    let startT;
    const step = (t) => {
      if (!startT) startT = t;
      const p = Math.min((t - startT) / 800, 1);
      setReveal(1 - Math.pow(1 - p, 3));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [data]);

  const raw = data ? (cur === 'inr' ? Number(data.value_inr) : Number(data.value_usdt)) : 0;
  const shown = raw * reveal;
  const delta = data?.delta_pct;
  const toggleCur = () => setCur((c) => (c === 'inr' ? 'usdt' : 'inr'));

  const valueText = loading && !data
    ? '…'
    : error
      ? '—'
      : (raw > 0 ? '+' : '') + fmtValue(shown, cur);

  return (
    <div
      className="tf-card"
      style={{ position: 'relative', minHeight: 148, padding: 18, display: 'grid', gridTemplateColumns: '46px 1fr', gap: 12, alignItems: 'start' }}
    >
      <span
        className="tf-badge"
        style={{
          width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center',
          justifyContent: 'center', flexShrink: 0, background: hexA('#f59e0b', 0.14), color: '#f59e0b',
        }}
      >
        <Coins size={20} />
      </span>
      <div>
        <small style={{ display: 'block', color: 'var(--muted)', fontSize: 12 }}>Commission earned</small>
        <button
          type="button"
          onClick={toggleCur}
          title="Click to switch currency"
          style={{
            display: 'block', fontWeight: 800, fontSize: 23, margin: '8px 0', letterSpacing: '-.4px', lineHeight: 1,
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
            color: error ? 'var(--muted)' : 'var(--text)',
          }}
        >
          {valueText}
          {delta != null && (
            <span style={{ marginLeft: 8, color: delta >= 0 ? '#22c55e' : '#ef4444', fontSize: 11, fontWeight: 700 }}>
              {(delta >= 0 ? '▲ ' : '▼ ') + Math.abs(delta) + '%'}
            </span>
          )}
        </button>
        <em style={{ display: 'block', fontStyle: 'normal', color: 'var(--muted)', fontSize: 11 }}>
          {NOTE[period]} · {error ? '—' : `${data?.trades ?? 0} trades`}
        </em>
      </div>
      <select
        value={period}
        onChange={(e) => setPeriod(e.target.value)}
        style={{
          position: 'absolute', right: 12, top: 12, fontSize: 10, fontWeight: 600, color: 'var(--muted)', background: 'var(--surface2)',
          border: '1px solid var(--cardborder)', borderRadius: 7, padding: '5px 7px', outline: 'none',
        }}
      >
        {PERIODS.map((k) => (
          <option key={k} value={k}>{TAB_LABEL[k]}</option>
        ))}
      </select>
    </div>
  );
}

// ---- Volume / Success rate period cards (REAL data, GET /trader/stats) ----
// Own period set from Commission's — includes "Overall" (all-time, no lower
// bound), which /trader/commission genuinely does not support, so it must
// stay off that dropdown to avoid a selector that silently no-ops.
const STATS_PERIODS = ['today', 'week', 'month', 'overall'];
const STATS_TAB_LABEL = { today: 'Today', week: 'Weekly', month: 'Monthly', overall: 'Overall' };
const STATS_NOTE = { today: 'Today', week: 'Last 7 days', month: 'Last 30 days', overall: 'All time' };
const STATS_VOLUME_LABEL = { today: "Today's volume", week: "This week's volume", month: "This month's volume", overall: 'All-time volume' };
const compactInr = (n) => (n >= 100000 ? `₹${(n / 100000).toFixed(2)}L` : inr(n));

function useTraderStats(period) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchFor = (p) => {
    let alive = true;
    setLoading(true);
    setError(false);
    traderApi
      .stats(p)
      .then((res) => { if (alive) setData(res.data.data); })
      .catch(() => { if (alive) setError(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  };

  useEffect(() => fetchFor(period), [period]);

  // Refresh the active period when a real-time order event arrives — same
  // trigger CommissionSection already reacts to.
  useEffect(() => {
    const onUpdate = () => fetchFor(period);
    window.addEventListener('order:update', onUpdate);
    window.addEventListener('order:new', onUpdate);
    return () => {
      window.removeEventListener('order:update', onUpdate);
      window.removeEventListener('order:new', onUpdate);
    };
  }, [period]);

  return { data, loading, error };
}

const statsSelectStyle = {
  position: 'absolute', right: 12, top: 12, fontSize: 10, fontWeight: 600, color: 'var(--muted)', background: 'var(--surface2)',
  border: '1px solid var(--cardborder)', borderRadius: 7, padding: '5px 7px', outline: 'none',
};

function PeriodSelect({ period, onChange }) {
  return (
    <select value={period} onChange={(e) => onChange(e.target.value)} style={statsSelectStyle}>
      {STATS_PERIODS.map((k) => (
        <option key={k} value={k}>{STATS_TAB_LABEL[k]}</option>
      ))}
    </select>
  );
}

export function VolumeStatCard() {
  const [period, setPeriod] = useState('today');
  const { data, loading, error } = useTraderStats(period);
  const valueText = loading && !data ? '…' : error ? '—' : compactInr(data?.volume_inr ?? 0);

  return (
    <div className="tf-card" style={{ position: 'relative', minHeight: 148, padding: 18, display: 'grid', gridTemplateColumns: '46px 1fr', gap: 12, alignItems: 'start' }}>
      <span style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: hexA('#3b82f6', 0.14), color: '#3b82f6' }}>
        <TrendingUp size={20} />
      </span>
      <div>
        <small style={{ display: 'block', color: 'var(--muted)', fontSize: 12 }}>{STATS_VOLUME_LABEL[period]}</small>
        <strong style={{ display: 'block', fontSize: 23, letterSpacing: '-.4px', margin: '8px 0', color: error ? 'var(--muted)' : 'var(--text)' }}>{valueText}</strong>
        <em style={{ display: 'block', fontStyle: 'normal', color: 'var(--muted)', fontSize: 11 }}>
          {error ? '—' : `${data?.trades ?? 0} processed orders`}
        </em>
      </div>
      <PeriodSelect period={period} onChange={setPeriod} />
    </div>
  );
}

export function SuccessRateStatCard() {
  const [period, setPeriod] = useState('today');
  const { data, loading, error } = useTraderStats(period);
  const valueText = loading && !data ? '…' : error ? '—' : `${data?.success_rate ?? 0}%`;

  return (
    <div className="tf-card" style={{ position: 'relative', minHeight: 148, padding: 18, display: 'grid', gridTemplateColumns: '46px 1fr', gap: 12, alignItems: 'start' }}>
      <span style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: hexA('#22c55e', 0.14), color: '#22c55e' }}>
        <ShieldCheck size={20} />
      </span>
      <div>
        <small style={{ display: 'block', color: 'var(--muted)', fontSize: 12 }}>Success rate</small>
        <strong style={{ display: 'block', fontSize: 23, letterSpacing: '-.4px', margin: '8px 0', color: error ? 'var(--muted)' : 'var(--text)' }}>{valueText}</strong>
        <em style={{ display: 'block', fontStyle: 'normal', color: 'var(--muted)', fontSize: 11 }}>
          {error ? '—' : STATS_NOTE[period]}
        </em>
      </div>
      <PeriodSelect period={period} onChange={setPeriod} />
    </div>
  );
}

// ---- Transaction activity (REAL data: confirmed orders = pay-in, completed
// payout requests = payout) — bucketed client-side, never randomly generated.
// A trader with more history than the fetch below just shows the most recent
// slice; nothing is backfilled or estimated to fill empty buckets. -------
const TXN_RANGES = [
  { value: '1H', label: '1H' },
  { value: '1D', label: '1D' },
  { value: '7D', label: '7D' },
  { value: '30D', label: '30D' },
];
const TXN_METRICS = [
  { value: 'volume', label: 'Volume' },
  { value: 'count', label: 'Count' },
];

function bucketConfig(range) {
  if (range === '1H') return { buckets: 6, stepMs: 10 * 60000, fmt: (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) };
  if (range === '1D') return { buckets: 24, stepMs: 3600000, fmt: (d) => d.toLocaleTimeString([], { hour: 'numeric' }) };
  if (range === '7D') return { buckets: 7, stepMs: 86400000, fmt: (d) => d.toLocaleDateString([], { weekday: 'short' }) };
  return { buckets: 30, stepMs: 86400000, fmt: (d) => d.toLocaleDateString([], { month: 'short', day: 'numeric' }) };
}

function buildActivitySeries(orders, payoutReqs, range) {
  const { buckets, stepMs, fmt } = bucketConfig(range);
  const now = Date.now();
  const points = Array.from({ length: buckets }, (_, i) => {
    const start = now - (buckets - i) * stepMs;
    return { label: fmt(new Date(start + stepMs)), payInVolume: 0, payoutVolume: 0, payInCount: 0, payoutCount: 0, _start: start, _end: start + stepMs };
  });
  const place = (list, dateField, volKey, countKey) => {
    (list || []).forEach((r) => {
      const raw = r[dateField];
      if (!raw) return;
      const ts = new Date(raw).getTime();
      if (!Number.isFinite(ts) || ts < points[0]._start) return;
      const bucket = points.find((p) => ts >= p._start && ts < p._end) || points[points.length - 1];
      bucket[volKey] += Number(r.amount_inr) || 0;
      bucket[countKey] += 1;
    });
  };
  place(orders, 'created_at', 'payInVolume', 'payInCount');
  place(payoutReqs, 'settled_at', 'payoutVolume', 'payoutCount');
  return points;
}

export function TransactionActivityChart() {
  const [range, setRange] = useState('7D');
  const [metric, setMetric] = useState('volume');
  const [orders, setOrders] = useState([]);
  const [payoutReqs, setPayoutReqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hovered, setHovered] = useState(null);

  const load = () => {
    Promise.allSettled([
      traderApi.orders('success', { limit: 500 }),
      traderApi.payoutRequests('settlement_completed'),
    ]).then(([oRes, pRes]) => {
      setOrders(oRes.status === 'fulfilled' ? (oRes.value.data?.data?.orders || []) : []);
      setPayoutReqs(pRes.status === 'fulfilled' ? (pRes.value.data?.data?.payout_requests || []) : []);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    window.addEventListener('order:new', load);
    window.addEventListener('order:update', load);
    return () => {
      window.removeEventListener('order:new', load);
      window.removeEventListener('order:update', load);
    };
  }, []);

  const data = useMemo(() => buildActivitySeries(orders, payoutReqs, range), [orders, payoutReqs, range]);
  const isVolume = metric === 'volume';
  const values = data.flatMap((p) => [isVolume ? p.payInVolume : p.payInCount, isVolume ? p.payoutVolume : p.payoutCount]);
  const max = Math.max(1, ...values);
  const hasAny = values.some((v) => v > 0);

  return (
    <div className="tf-card" style={{ padding: '20px 22px', maxHeight: 420, overflow: 'hidden' }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 style={{ fontWeight: 700, fontSize: 17, margin: 0 }}>Transaction activity</h3>
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0 0' }}>
            {isVolume ? 'Pay-in vs payout volume (INR)' : 'Pay-in vs payout count'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Segments options={TXN_METRICS} value={metric} onChange={setMetric} />
          <Segments options={TXN_RANGES} value={range} onChange={setRange} />
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        {loading ? (
          <p style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>Loading…</p>
        ) : !hasAny ? (
          <p style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>No transactions in this range yet.</p>
        ) : (
          <>
            <div style={{ position: 'relative' }}>
              {hovered != null && (() => {
                const p = data[hovered];
                const inVal = isVolume ? p.payInVolume : p.payInCount;
                const outVal = isVolume ? p.payoutVolume : p.payoutCount;
                const fmt = (v) => (isVolume ? inr(v) : v.toLocaleString());
                // Center over the hovered bar group; anchor to an edge at
                // the first/last group instead of centering, so the fixed-
                // width tooltip never spills past the chart's own edges.
                const pct = ((hovered + 0.5) / data.length) * 100;
                const posStyle = hovered === 0
                  ? { left: 0 }
                  : hovered === data.length - 1
                    ? { right: 0 }
                    : { left: `${pct}%`, transform: 'translateX(-50%)' };
                return (
                  <div className="tf-chart-tooltip" style={posStyle}>
                    <p className="tf-chart-tooltip-label">{p.label}</p>
                    <div className="tf-chart-tooltip-row">
                      <span className="tf-chart-tooltip-dot" style={{ background: '#818cf8' }} />
                      <span className="tf-chart-tooltip-name">Pay-in</span>
                      <span className="tf-chart-tooltip-value">{fmt(inVal)}</span>
                    </div>
                    <div className="tf-chart-tooltip-row">
                      <span className="tf-chart-tooltip-dot" style={{ background: '#94a3b8' }} />
                      <span className="tf-chart-tooltip-name">Payout</span>
                      <span className="tf-chart-tooltip-value">{fmt(outVal)}</span>
                    </div>
                  </div>
                );
              })()}
              <div className="tf-chart-bars">
                {data.map((p, i) => {
                  const inVal = isVolume ? p.payInVolume : p.payInCount;
                  const outVal = isVolume ? p.payoutVolume : p.payoutCount;
                  return (
                    <div
                      className="tf-chart-group"
                      key={i}
                      onMouseEnter={() => setHovered(i)}
                      onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
                    >
                      <div
                        className="tf-chart-bar"
                        style={{ height: `${Math.max(2, (inVal / max) * 100)}%`, background: 'linear-gradient(180deg,#818cf8,#4f46e5)' }}
                      />
                      <div
                        className="tf-chart-bar"
                        style={{ height: `${Math.max(2, (outVal / max) * 100)}%`, background: 'linear-gradient(180deg,#94a3b8,#475569)' }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="tf-chart-axis">
              {data.map((p, i) => <span key={i}>{p.label}</span>)}
            </div>
          </>
        )}
      </div>

      <div className="tf-chart-legend">
        <b><i style={{ background: '#4f46e5' }} />Pay-in</b>
        <b><i style={{ background: '#475569' }} />Payout</b>
      </div>
    </div>
  );
}

// ---- Live pool (REAL payment-details data, joined with real devices +
// real in-processing payout totals) --------------------------------------
export function LivePoolSection({ details, todayVolumeInr, onChanged }) {
  const navigate = useNavigate();
  const [deviceNames, setDeviceNames] = useState({});
  const [payoutSummary, setPayoutSummary] = useState({ count: 0, total: 0 });
  const [busyId, setBusyId] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null);

  // Every row here is already live (is_active), so this control only ever
  // turns an account OFF — the same real field (is_active_detail) Offers.jsx's
  // own toggle writes. Turning an account back ON stays Offers-only: that path
  // runs a liveness check (device heartbeat / web-session status) this page
  // has no access to, and skipping it would let a trader "activate" an
  // account with no live data source with no warning.
  const deactivate = (d) => setConfirmTarget(d);

  const confirmDeactivate = async () => {
    const d = confirmTarget;
    if (!d) return;
    setBusyId(d.id);
    try {
      await traderApi.updatePaymentDetail(d.id, { is_active_detail: false });
      toast('Account turned off', 'success');
      onChanged?.();
    } catch (e) {
      toast(e.response?.data?.message || 'Could not turn off this account', 'error');
    } finally {
      setBusyId(null);
      setConfirmTarget(null);
    }
  };

  useEffect(() => {
    let alive = true;
    getDevices()
      .then((devices) => {
        if (!alive) return;
        const map = {};
        (devices || []).forEach((d) => { map[d.id] = d.deviceName || 'Smartphone'; });
        setDeviceNames(map);
      })
      .catch(() => {});
    traderApi
      .payoutRequests('in_processing')
      .then((res) => {
        if (!alive) return;
        const list = res.data?.data?.payout_requests || [];
        setPayoutSummary({
          count: list.length,
          total: list.reduce((sum, r) => sum + (Number(r.amount_inr) || 0), 0),
        });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Routing requires BOTH flags (routingEngine.pickEligibleAccount: is_active
  // is the linkage/admin gate, is_active_detail is the trader's own on/off
  // intent) — filtering on is_active alone would keep showing an account
  // here as "live" even after the trader had turned it off.
  const live = (details || []).filter((d) => d.is_active && d.is_active_detail !== false);

  const liveOrdersToday = live.reduce((sum, d) => sum + (Number(d.usage?.used_today) || 0), 0);
  const withUsage = live.filter((d) => (d.usage?.orders_total || 0) > 0);
  const avgSuccess = withUsage.length
    ? Math.round(withUsage.reduce((sum, d) => sum + (d.usage.orders_confirmed / d.usage.orders_total) * 100, 0) / withUsage.length)
    : null;

  return (
    <>
    <div className="tf-card tf-livepool-full" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '20px 22px 16px' }}>
        <div>
          <h3 style={{ fontWeight: 700, fontSize: 17, margin: 0 }}>Live pool</h3>
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0 0' }}>Accounts currently eligible for incoming orders</p>
        </div>
        <button
          onClick={() => navigate('/offers')}
          style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 0, color: 'var(--accent)', fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
        >
          {live.length} live of {(details || []).length}
          <ArrowRight size={13} />
        </button>
      </div>

      {/* Real 5-tile summary strip — every figure derived from `details` /
          the payout-requests fetch above, nothing estimated. */}
      <div className="grid grid-cols-2 sm:grid-cols-5" style={{ margin: '0 22px 16px', border: '1px solid var(--cardborder)', borderRadius: 11, overflow: 'hidden' }}>
        {[
          { label: 'Live accounts', value: live.length },
          { label: 'Pay-in today', value: inr(todayVolumeInr || 0) },
          { label: 'Orders today', value: liveOrdersToday },
          { label: 'Payout processing', value: inr(payoutSummary.total) },
          { label: 'Avg success rate', value: avgSuccess == null ? '—' : `${avgSuccess}%` },
        ].map((s, i) => (
          <div key={s.label} style={{ padding: '11px 13px', borderTop: i >= 2 && i < 3 ? undefined : undefined, borderLeft: '1px solid var(--cardborder)' }}>
            <p style={{ margin: 0, fontSize: 10, color: 'var(--muted)' }}>{s.label}</p>
            <p style={{ margin: '4px 0 0', fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="tradeLedger tf-livepool-full-table" style={{ margin: '0 22px 20px', border: '1px solid var(--cardborder)', borderRadius: 11 }}>
        <div className="tradeLedgerHead" style={{ gridTemplateColumns: LIVE_POOL_GRID }}>
          <span />
          <span>Account</span>
          <span>Payment method</span>
          <span>Device / session</span>
          <span>Connection</span>
          <span>Orders today</span>
          <span>Pay-in volume</span>
          <span>Success rate</span>
          <span>Limit</span>
          <span />
        </div>
        {live.length === 0 ? (
          <p style={{ padding: '22px', color: 'var(--muted)', fontSize: 13, margin: 0, textAlign: 'center' }}>No live accounts right now.</p>
        ) : (
          live.map((d) => {
            const type = ACCOUNT_TYPES[d.account_type] || { label: d.account_type };
            const isWeb = d.connectionType === 'web';
            const sessionLabel = isWeb
              ? 'Web session'
              : d.ngo_device_id
                ? (deviceNames[d.ngo_device_id] || 'APK device')
                : '—';
            const hasLimit = !!(d.max_per_day || d.daily_limit_amount);
            const total = d.usage?.orders_total || 0;
            const rate = total ? Math.round((d.usage.orders_confirmed / total) * 100) : null;
            return (
              <div key={d.id} className="tradeLedgerRow" style={{ gridTemplateColumns: LIVE_POOL_GRID }}>
                <button
                  className="tf-pool-toggle on"
                  onClick={() => deactivate(d)}
                  disabled={busyId === d.id}
                  aria-label={`Turn off ${d.account_name}`}
                  title="Turn off — stop receiving new orders on this account"
                />
                <div className="tradeProvider">
                  <BankBadge type={d.account_type} label={type.label} size={30} />
                  <div className="min-w-0">
                    <strong className="truncate" title={d.account_name}>{d.account_name}</strong>
                    <small className="truncate" title={d.upi_id}>{d.upi_id}</small>
                  </div>
                </div>
                <div className="personCell"><strong>{type.label}</strong></div>
                <div className="personCell">
                  <strong className="truncate">{sessionLabel}</strong>
                </div>
                <span className="tf-connmark">
                  {isWeb ? <IconGlobe className="h-3 w-3" /> : <IconRobot className="h-3 w-3" />}
                  {isWeb ? 'WEB' : 'APK'}
                </span>
                <div className="personCell"><strong>{d.usage?.used_today ?? 0}{d.max_per_day ? ` / ${d.max_per_day}` : ''}</strong></div>
                <div className="personCell"><strong>{inr(d.usage?.daily_amount_total || 0)}</strong></div>
                <div className="personCell">
                  <strong className={rate == null ? '' : rate >= 50 ? 'autoClose' : 'manualReview'} style={rate == null ? { color: 'var(--muted)' } : undefined}>
                    {rate == null ? '—' : `${rate}%`}
                  </strong>
                </div>
                <span style={{ display: 'flex', justifyContent: 'center' }}>
                  {hasLimit ? <CheckCircle2 size={15} style={{ color: '#22c55e' }} /> : <span style={{ color: 'var(--subtle)' }}>—</span>}
                </span>
                <button
                  className="tf-hbtn"
                  style={{ width: 28, height: 28 }}
                  onClick={() => navigate('/offers')}
                  aria-label={`Open ${d.account_name} in Payment details`}
                >
                  <MoreHorizontal size={15} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
    <ConfirmModal
      open={!!confirmTarget}
      title="Turn off this account?"
      description={confirmTarget ? `Turn off "${confirmTarget.account_name}"? It will stop receiving new orders.` : ''}
      confirmLabel="Turn off"
      tone="danger"
      busy={busyId === confirmTarget?.id}
      onConfirm={confirmDeactivate}
      onClose={() => setConfirmTarget(null)}
    />
    </>
  );
}

// ---- Requires attention (REAL data, two sources) --------------------------
function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

function timeAgo(dateStr) {
  if (!dateStr) return 'never';
  const ms = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const EXPIRING_SOON_MS = 5 * 60 * 1000;
const TONE_HEX = { blue: '#1570ef', amber: '#dc6803' };

export function AttentionSection() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () => {
      Promise.allSettled([getDevices(), traderApi.payoutRequests('in_processing')])
        .then(([devicesRes, payoutRes]) => {
          if (!alive) return;
          const list = [];

          const devices = devicesRes.status === 'fulfilled' ? (devicesRes.value || []) : [];
          devices.filter((d) => !d.online).forEach((d) => {
            list.push({
              key: `device-${d.id}`,
              icon: Smartphone,
              tone: 'blue',
              title: `${d.deviceName || 'Device'} is offline`,
              sub: `Last seen ${timeAgo(d.lastSeen)}`,
              to: '/smartphones',
            });
          });

          const payouts = payoutRes.status === 'fulfilled' ? (payoutRes.value.data?.data?.payout_requests || []) : [];
          payouts.forEach((r) => {
            if (!r.expires_at) return;
            const msLeft = new Date(r.expires_at).getTime() - Date.now();
            if (msLeft < EXPIRING_SOON_MS) {
              list.push({
                key: `payout-${r.id}`,
                icon: Clock3,
                tone: 'amber',
                title: msLeft <= 0 ? 'A payout request expired' : 'Payout request expiring soon',
                sub: msLeft <= 0 ? `#${r.id} needs review` : `#${r.id} — ${fmtDuration(msLeft)} left`,
                to: '/buy-usdt',
              });
            }
          });

          setAlerts(list);
        })
        .finally(() => { if (alive) setLoading(false); });
    };

    load();
    // Refresh on real payout state changes (accepted/settled/canceled/
    // disputed/expired) and device disconnects — both re-emitted by
    // TraderLayout as 'order:update' / 'device:disconnected' window events.
    window.addEventListener('order:update', load);
    window.addEventListener('device:disconnected', load);
    return () => {
      alive = false;
      window.removeEventListener('order:update', load);
      window.removeEventListener('device:disconnected', load);
    };
  }, []);

  return (
    <div className="tf-card" style={{ padding: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 22px 16px' }}>
        <div>
          <h3 style={{ fontWeight: 700, fontSize: 17, margin: 0 }}>Requires attention</h3>
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0 0' }}>Actionable items only</p>
        </div>
        {alerts.length > 0 && (
          <span
            style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '4px 9px', background: hexA('#dc6803', 0.14), color: '#dc6803' }}
          >
            {alerts.length} item{alerts.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {loading ? (
        <p style={{ padding: '0 22px 22px', color: 'var(--muted)', fontSize: 13, margin: 0 }}>Checking…</p>
      ) : alerts.length === 0 ? (
        <div style={{ padding: '4px 22px 24px', display: 'flex', alignItems: 'center', gap: 10, color: '#22c55e' }}>
          <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 500 }}>Nothing needs your attention right now.</span>
        </div>
      ) : (
        <div style={{ flex: 1 }}>
          {alerts.map((a) => {
            const Icon = a.icon;
            const hex = TONE_HEX[a.tone];
            return (
              <button
                key={a.key}
                onClick={() => navigate(a.to)}
                className="tf-row-hover"
                style={{
                  width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12,
                  padding: '11px 22px', border: 0, borderTop: '1px solid var(--cardborder)',
                  background: 'transparent', cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    width: 32, height: 32, borderRadius: 10, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', background: hexA(hex, 0.14), color: hex, flexShrink: 0,
                  }}
                >
                  <Icon size={16} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{a.title}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--muted)' }}>{a.sub}</p>
                </span>
                <ChevronRight size={16} style={{ color: 'var(--muted)', flexShrink: 0 }} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
