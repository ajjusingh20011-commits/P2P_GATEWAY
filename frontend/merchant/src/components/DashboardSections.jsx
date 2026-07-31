import { useEffect, useMemo, useState } from 'react';
import { Segments } from './ui';
import { inr } from '../utils/mock';

/*
  Dashboard sections used below the KPI row — all REAL data:

  - OverviewMetric: presentational card matching the MaxPay design's 4-tile
    KPI row (icon, big value, footnote, "See more" link). Values are computed
    by Dashboard.jsx from real orders/payouts, never mock totals.
  - TransactionActivityChart: same shape as the trader panel's dashboard
    chart — real confirmed orders (pay-in) and settled payout requests
    (payout), fetched once and bucketed client-side into the selected range.
    No random/synthetic points; an empty range shows a genuine empty state.
  - TrafficOverviewCard: FTD/STD (first-time vs repeat customer) split
    computed from real customer_ref values across the orders Dashboard.jsx
    fetched — not a fabricated ratio, but honestly scoped to that fetched
    window (see its subtitle, which states the sample size).
*/

// ---- KPI tile (design's OverviewMetric) -----------------------------------
const TONE_HEX = { green: '#15803d', blue: '#1570ef', amber: '#dc6803', red: '#d92d20' };
const TONE_BG = { green: '#ecfdf3', blue: '#eff8ff', amber: '#fffaeb', red: '#fef3f2' };

export function OverviewMetric({ icon: Icon, tone = 'green', label, value, footnote, onSeeMore }) {
  return (
    <div className="tf-card" style={{ position: 'relative', minHeight: 145, padding: '19px' }}>
      <span
        style={{
          position: 'absolute', right: 17, top: 17, width: 36, height: 36, borderRadius: 10,
          display: 'grid', placeItems: 'center', background: TONE_BG[tone] || TONE_BG.green, color: TONE_HEX[tone] || TONE_HEX.green,
        }}
      >
        <Icon size={18} />
      </span>
      <label style={{ color: 'var(--muted)', fontSize: 12, display: 'block' }}>{label}</label>
      <div style={{ marginTop: 13 }}>
        <strong style={{ fontSize: 23, color: 'var(--text)' }}>{value}</strong>
      </div>
      {footnote && <small style={{ display: 'block', color: 'var(--muted)', fontSize: 11, marginTop: 11 }}>{footnote}</small>}
      {onSeeMore && (
        <button
          type="button"
          onClick={onSeeMore}
          style={{ border: 0, background: 'transparent', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 650, fontSize: 12, marginTop: 10, padding: 0, cursor: 'pointer' }}
        >
          See more <span aria-hidden>&rarr;</span>
        </button>
      )}
    </div>
  );
}

// ---- Transaction activity chart (REAL orders + payouts) -------------------
const TXN_RANGES = [
  { value: '1D', label: '1D' },
  { value: '7D', label: '7D' },
  { value: '30D', label: '30D' },
];
const TXN_METRICS = [
  { value: 'volume', label: 'Volume' },
  { value: 'count', label: 'Count' },
];

function bucketConfig(range) {
  if (range === '1D') return { buckets: 24, stepMs: 3600000, fmt: (d) => d.toLocaleTimeString([], { hour: 'numeric' }) };
  if (range === '7D') return { buckets: 7, stepMs: 86400000, fmt: (d) => d.toLocaleDateString([], { weekday: 'short' }) };
  return { buckets: 30, stepMs: 86400000, fmt: (d) => d.toLocaleDateString([], { month: 'short', day: 'numeric' }) };
}

function buildActivitySeries(orders, payouts, range) {
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
  place(payouts, 'created_at', 'payoutVolume', 'payoutCount');
  return points;
}

export function TransactionActivityChart({ orders, payouts, loading }) {
  const [range, setRange] = useState('7D');
  const [metric, setMetric] = useState('volume');

  const data = useMemo(() => buildActivitySeries(orders, payouts, range), [orders, payouts, range]);
  const isVolume = metric === 'volume';
  const values = data.flatMap((p) => [isVolume ? p.payInVolume : p.payInCount, isVolume ? p.payoutVolume : p.payoutCount]);
  const max = Math.max(1, ...values);
  const hasAny = values.some((v) => v > 0);

  return (
    <div className="tf-card" style={{ padding: '20px 22px', height: '100%' }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: 0 }}>Transaction activity</h2>
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
            <div className="tf-chart-bars">
              {data.map((p, i) => {
                const inVal = isVolume ? p.payInVolume : p.payInCount;
                const outVal = isVolume ? p.payoutVolume : p.payoutCount;
                return (
                  <div className="tf-chart-group" key={i}>
                    <div
                      className="tf-chart-bar"
                      style={{ height: `${Math.max(2, (inVal / max) * 100)}%`, background: 'linear-gradient(180deg,#4ade80,#16a34a)' }}
                      title={`${p.label} · Pay-in ${isVolume ? inr(inVal) : inVal}`}
                    />
                    <div
                      className="tf-chart-bar"
                      style={{ height: `${Math.max(2, (outVal / max) * 100)}%`, background: 'linear-gradient(180deg,#64748b,#334155)' }}
                      title={`${p.label} · Payout ${isVolume ? inr(outVal) : outVal}`}
                    />
                  </div>
                );
              })}
            </div>
            <div className="tf-chart-axis">
              {data.map((p, i) => <span key={i}>{p.label}</span>)}
            </div>
          </>
        )}
      </div>

      <div className="tf-chart-legend">
        <b><i style={{ background: '#16a34a' }} />Pay-in</b>
        <b><i style={{ background: '#334155' }} />Payout</b>
      </div>
    </div>
  );
}

// ---- Traffic overview (REAL customer_ref repeat mix, from the same
// fetched orders window as the KPI row) -------------------------------------
function trafficRow(color, label, value) {
  return (
    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: color, flexShrink: 0 }} />
      <span style={{ color: 'var(--muted)', flex: 1 }}>{label}</span>
      <strong style={{ fontSize: 13, color: 'var(--text)' }}>{value}</strong>
    </div>
  );
}

const FTD_COLOR = '#15803d';
const STD_COLOR = '#4ade80';
const PAYIN_COLOR = '#86efac';
const PAYOUT_COLOR = '#475467';

export function TrafficOverviewCard({ orders, payInCount, payoutCount, loading }) {
  const mix = useMemo(() => {
    const byCustomer = new Map();
    (orders || []).forEach((o) => {
      const key = o.customer_ref || `#${o.id}`;
      byCustomer.set(key, (byCustomer.get(key) || 0) + 1);
    });
    let ftd = 0;
    let std = 0;
    byCustomer.forEach((count) => {
      if (count <= 1) ftd += count;
      else std += count;
    });
    const total = ftd + std;
    const ftdPct = total ? Math.round((ftd / total) * 100) : 0;
    return { ftd, std, ftdPct, stdPct: 100 - ftdPct, sampleSize: orders?.length || 0 };
  }, [orders]);

  const ring = `conic-gradient(${FTD_COLOR} 0 ${mix.ftdPct}%, ${STD_COLOR} ${mix.ftdPct}% 100%)`;

  return (
    <div className="tf-card" style={{ padding: '20px 22px', height: '100%' }}>
      <div>
        <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: 0 }}>Traffic Overview</h2>
        <p style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0 0' }}>
          {mix.sampleSize > 0 ? `Customer mix — based on the last ${mix.sampleSize.toLocaleString()} orders` : 'Customer and transaction mix'}
        </p>
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>Loading…</p>
      ) : mix.sampleSize === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>No orders yet.</p>
      ) : (
        <div className="flex items-center flex-wrap" style={{ gap: 22, marginTop: 20 }}>
          <div style={{ width: 120, height: 120, flexShrink: 0, position: 'relative', borderRadius: '50%', background: ring }}>
            <div
              style={{
                position: 'absolute', inset: 10, borderRadius: '50%', background: 'var(--card)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <strong style={{ fontSize: 18, letterSpacing: '-0.3px', color: 'var(--text)' }}>{mix.ftdPct}%</strong>
              <small style={{ fontSize: 9.5, color: 'var(--muted)' }}>FTD</small>
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 160, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {trafficRow(FTD_COLOR, 'FTD customers', `${mix.ftdPct}%`)}
            {trafficRow(STD_COLOR, 'STD customers', `${mix.stdPct}%`)}
            {trafficRow(PAYIN_COLOR, 'Pay-in transactions', payInCount.toLocaleString())}
            {trafficRow(PAYOUT_COLOR, 'Payout transactions', payoutCount.toLocaleString())}
          </div>
        </div>
      )}
    </div>
  );
}
