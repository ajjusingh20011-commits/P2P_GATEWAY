import { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Segments } from './ui';
import { inr } from '../utils/mock';

/*
  Dashboard sections below the KPI row — all REAL data:

  - OverviewMetric: presentational card matching the MaxPay design's 4-tile
    KPI row (icon, big value, footnote, "See more" link).
  - TransactionActivityChart: real orders (pay-in) and real payout requests,
    fetched once by Dashboard.jsx and bucketed client-side into the selected
    range. No random/synthetic points; an empty range shows a genuine empty
    state.
  - RequiresAttentionCard: the platform's real "needs review" queue — the
    same three real endpoints the Attention page aggregates (under_review
    orders, open disputes, disputed payout requests), not fabricated
    severity-tagged alerts. See Dashboard.jsx for how items are built.
*/

// ---- KPI tile (design's OverviewMetric) -----------------------------------
const TONE_HEX = { red: '#e5484d', blue: '#1570ef', green: '#15803d', amber: '#dc6803' };
const TONE_BG = { red: '#fff1f2', blue: '#eff8ff', green: '#ecfdf3', amber: '#fffaeb' };

export function OverviewMetric({ icon: Icon, tone = 'red', label, value, footnote, onSeeMore }) {
  return (
    <div className="tf-card" style={{ position: 'relative', minHeight: 145, padding: '19px' }}>
      <span
        style={{
          position: 'absolute', right: 17, top: 17, width: 36, height: 36, borderRadius: 10,
          display: 'grid', placeItems: 'center', background: TONE_BG[tone] || TONE_BG.red, color: TONE_HEX[tone] || TONE_HEX.red,
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
          See more <ArrowRight size={13} />
        </button>
      )}
    </div>
  );
}

// ---- Transaction activity chart (REAL orders + payout requests) -----------
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
  const place = (list, volKey, countKey) => {
    (list || []).forEach((r) => {
      const raw = r.created_at;
      if (!raw) return;
      const ts = new Date(raw).getTime();
      if (!Number.isFinite(ts) || ts < points[0]._start) return;
      const bucket = points.find((p) => ts >= p._start && ts < p._end) || points[points.length - 1];
      bucket[volKey] += Number(r.amount_inr) || 0;
      bucket[countKey] += 1;
    });
  };
  place(orders, 'payInVolume', 'payInCount');
  place(payouts, 'payoutVolume', 'payoutCount');
  return points;
}

export function TransactionActivityChart({ orders, payouts, loading, sampleSize }) {
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
            {isVolume ? 'Pay-in vs payout volume (INR) · platform-wide' : 'Pay-in vs payout count · platform-wide'}
            {sampleSize ? ` · last ${sampleSize.toLocaleString()} orders` : ''}
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
                      style={{ height: `${Math.max(2, (inVal / max) * 100)}%`, background: 'linear-gradient(180deg,#f4626a,#e5484d)' }}
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
        <b><i style={{ background: '#e5484d' }} />Pay-in</b>
        <b><i style={{ background: '#334155' }} />Payout</b>
      </div>
    </div>
  );
}

// ---- Requires Attention (REAL: under_review orders + open disputes +
// disputed payout requests — the same three real lists the Attention page
// aggregates, just the top few of each) --------------------------------
const TONE_STYLE = {
  red: { bg: '#fff1f2', color: '#c62f35' },
  amber: { bg: '#fffaeb', color: '#dc6803' },
  blue: { bg: '#eff8ff', color: '#1570ef' },
};

export function RequiresAttentionCard({ items, totalCount, loading }) {
  return (
    <div className="tf-card" style={{ padding: '20px 22px', height: '100%' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: 0 }}>Requires attention</h2>
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0 0' }}>Orders, disputes and payouts needing review</p>
        </div>
        {totalCount > 0 && (
          <span
            className="flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            {totalCount}
          </span>
        )}
      </div>

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {loading ? (
          <p style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '30px 0' }}>Loading…</p>
        ) : items.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '30px 0' }}>No open platform risks.</p>
        ) : (
          items.map((it) => {
            const tone = TONE_STYLE[it.tone] || TONE_STYLE.blue;
            return (
              <button
                key={it.id}
                type="button"
                onClick={it.onClick}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left tf-row-hover"
                style={{ border: 0, background: 'transparent', cursor: 'pointer' }}
              >
                <span style={{ width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center', flexShrink: 0, background: tone.bg, color: tone.color }}>
                  <it.Icon size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate" style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600, margin: 0 }}>{it.title}</p>
                  <p className="truncate" style={{ color: 'var(--muted)', fontSize: 11.5, margin: '2px 0 0' }}>{it.detail}</p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
