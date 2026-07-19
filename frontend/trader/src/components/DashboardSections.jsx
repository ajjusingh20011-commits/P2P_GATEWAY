import { useEffect, useMemo, useState } from 'react';
import { Coins, BarChart3, AlignLeft } from 'lucide-react';
import { traderApi } from '../services/api';

/*
  Two dashboard sections used below the trader stat grid:

  - CommissionSection: REAL data from GET /trader/commission?period=. The big
    number toggles between ₹ (INR) and USDT on click; it counts up on change.
  - StatisticSection: DEMO data for now (grouped Pay-in / Payout bars). The real
    pay-in/payout series is wired later — the datasets below are placeholders.
*/

// Format a rupee amount to short INR: 10500 -> "₹10.5k", 260000 -> "₹2.6L".
function inrShort(v) {
  if (v >= 10000000) return '₹' + (v / 10000000).toFixed(v % 10000000 ? 1 : 0) + 'Cr';
  if (v >= 100000) return '₹' + (v / 100000).toFixed(v % 100000 ? 1 : 0) + 'L';
  if (v >= 1000) return '₹' + (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'k';
  return '₹' + v;
}

function hexA(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const prefersReduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    <div className="tf-card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ fontWeight: 700, fontSize: 17, margin: 0 }}>Commission</h3>
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0 0' }}>Earnings overview</p>
        </div>
        <div style={{ display: 'flex', gap: 18 }}>
          {PERIODS.map((k) => (
            <button key={k} className={'tf-tab' + (period === k ? ' on' : '')} onClick={() => setPeriod(k)}>
              {TAB_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      {/* Centered in the remaining height so the card doesn't leave a big gap
          below when it's paired with the taller Statistic chart. */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 130 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={toggleCur}
                title="Click to switch currency"
                style={{
                  fontWeight: 800, fontSize: 38, margin: 0, letterSpacing: '-1px', lineHeight: 1,
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  color: error ? 'var(--muted)' : '#22c55e',
                }}
              >
                {valueText}
              </button>
              {delta != null && (
                <span style={{ color: delta >= 0 ? '#22c55e' : '#ef4444', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  {(delta >= 0 ? '▲ ' : '▼ ') + Math.abs(delta) + '%'}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
              <button
                type="button"
                onClick={toggleCur}
                style={{
                  fontSize: 12, fontWeight: 600, color: '#14b8c4', cursor: 'pointer',
                  background: 'rgba(20,184,196,.12)', border: 'none', borderRadius: 8, padding: '4px 10px',
                }}
              >
                {cur === 'inr' ? 'Show in USDT' : 'Show in ₹'}
              </button>
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                {NOTE[period]} · {error ? '—' : `${data?.trades ?? 0} trades`}
              </span>
            </div>
          </div>
          <div
            className="tf-badge"
            style={{
              width: 48, height: 48, borderRadius: 14, display: 'flex', alignItems: 'center',
              justifyContent: 'center', flexShrink: 0, background: hexA('#22c55e', 0.14), color: '#22c55e',
            }}
          >
            <Coins size={22} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Statistic section (DEMO data — real pay-in/payout wired later) -------
// piTrades / poTrades = number of trades behind each bar (shown in tooltip).
const STATDATA = {
  today: { labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], payin: [12000, 18000, 9000, 16000, 20000, 14000, 17000], payout: [8000, 11000, 6000, 13000, 9000, 10000, 12000], piTrades: [4, 6, 3, 5, 7, 5, 6], poTrades: [2, 3, 2, 4, 3, 3, 4] },
  week: { labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'], payin: [52000, 61000, 48000, 70000], payout: [30000, 42000, 26000, 38000], piTrades: [22, 26, 20, 29], poTrades: [12, 17, 11, 15] },
  month: { labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'], payin: [180000, 210000, 160000, 240000, 200000, 260000], payout: [120000, 150000, 110000, 170000, 140000, 160000], piTrades: [88, 102, 79, 118, 96, 124], poTrades: [50, 62, 44, 71, 58, 66] },
};

export function StatisticSection() {
  const [period, setPeriod] = useState('today');
  const [ori, setOri] = useState('v');
  const [hover, setHover] = useState(null);
  const d = STATDATA[period];
  const max = useMemo(() => Math.max(...d.payin, ...d.payout) * 1.1, [d]);

  const W = 640;
  const H = 240;
  const bars = [];
  const onEnter = (label, kind, amount, trades, x, y) => setHover({ label, kind, amount, trades, x, y });
  const onLeave = () => setHover(null);

  if (ori === 'v') {
    const padL = 52;
    const padB = 28;
    const padT = 8;
    const padR = 12;
    const plotW = W - padL - padR;
    const plotH = H - padB - padT;
    [0, 0.5, 1].forEach((f, gi) => {
      const y = padT + plotH * (1 - f);
      bars.push(<line key={'g' + gi} x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--track)" />);
      bars.push(<text key={'gt' + gi} x={padL - 10} y={y + 3} textAnchor="end" fontSize="10" fill="var(--muted)">{inrShort(Math.round(max * f))}</text>);
    });
    const n = d.labels.length;
    const group = plotW / n;
    const bw = Math.min(16, group / 3.2);
    const gap = 5;
    d.labels.forEach((lb, i) => {
      const cx = padL + group * i + group / 2;
      const h1 = (d.payin[i] / max) * plotH;
      const h2 = (d.payout[i] / max) * plotH;
      const x1 = cx - bw - gap / 2;
      const x2 = cx + gap / 2;
      bars.push(<rect key={'pi' + i} x={x1} y={padT + plotH - h1} width={bw} height={h1} rx={bw / 2} fill="#22c55e" style={{ cursor: 'pointer' }}
        onMouseEnter={() => onEnter(lb, 'Pay-in', d.payin[i], d.piTrades[i], ((x1 + bw / 2) / W) * 100, ((padT + plotH - h1) / H) * 100)} onMouseLeave={onLeave}>
        <animate attributeName="height" from="0" to={h1} dur="0.6s" fill="freeze" /><animate attributeName="y" from={padT + plotH} to={padT + plotH - h1} dur="0.6s" fill="freeze" /></rect>);
      bars.push(<rect key={'po' + i} x={x2} y={padT + plotH - h2} width={bw} height={h2} rx={bw / 2} fill="#ef4444" style={{ cursor: 'pointer' }}
        onMouseEnter={() => onEnter(lb, 'Payout', d.payout[i], d.poTrades[i], ((x2 + bw / 2) / W) * 100, ((padT + plotH - h2) / H) * 100)} onMouseLeave={onLeave}>
        <animate attributeName="height" from="0" to={h2} dur="0.6s" fill="freeze" /><animate attributeName="y" from={padT + plotH} to={padT + plotH - h2} dur="0.6s" fill="freeze" /></rect>);
      bars.push(<text key={'lb' + i} x={cx} y={H - 10} textAnchor="middle" fontSize="10" fill="var(--muted)">{lb}</text>);
    });
  } else {
    const padL = 64;
    const padR = 52;
    const padT = 6;
    const padB = 10;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const n = d.labels.length;
    const group = plotH / n;
    const bh = Math.min(13, group / 3.2);
    const gap = 4;
    d.labels.forEach((lb, i) => {
      const cy = padT + group * i + group / 2;
      const w1 = (d.payin[i] / max) * plotW;
      const w2 = (d.payout[i] / max) * plotW;
      const y1 = cy - bh - gap / 2;
      const y2 = cy + gap / 2;
      bars.push(<rect key={'pi' + i} x={padL} y={y1} width={w1} height={bh} rx={bh / 2} fill="#22c55e" style={{ cursor: 'pointer' }}
        onMouseEnter={() => onEnter(lb, 'Pay-in', d.payin[i], d.piTrades[i], ((padL + w1) / W) * 100, (y1 / H) * 100)} onMouseLeave={onLeave}>
        <animate attributeName="width" from="0" to={w1} dur="0.6s" fill="freeze" /></rect>);
      bars.push(<rect key={'po' + i} x={padL} y={y2} width={w2} height={bh} rx={bh / 2} fill="#ef4444" style={{ cursor: 'pointer' }}
        onMouseEnter={() => onEnter(lb, 'Payout', d.payout[i], d.poTrades[i], ((padL + w2) / W) * 100, (y2 / H) * 100)} onMouseLeave={onLeave}>
        <animate attributeName="width" from="0" to={w2} dur="0.6s" fill="freeze" /></rect>);
      bars.push(<text key={'lb' + i} x={padL - 8} y={cy + 3} textAnchor="end" fontSize="10" fill="var(--muted)">{lb}</text>);
    });
  }

  return (
    <div className="tf-card" style={{ padding: '20px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
        <div>
          <h3 style={{ fontWeight: 700, fontSize: 17, margin: 0 }}>Statistic</h3>
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0 0' }}>Pay-in vs Payout volume</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', gap: 16 }}>
            {PERIODS.map((k) => (
              <button key={k} className={'tf-tab' + (period === k ? ' on' : '')} onClick={() => setPeriod(k)}>
                {TAB_LABEL[k]}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className={'tf-obtn' + (ori === 'v' ? ' on' : '')} onClick={() => setOri('v')} title="Vertical"><BarChart3 size={16} /></button>
            <button className={'tf-obtn' + (ori === 'h' ? ' on' : '')} onClick={() => setOri('h')} title="Horizontal"><AlignLeft size={16} /></button>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 18, margin: '14px 0 18px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--muted)', fontSize: 12, fontWeight: 500 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: '#22c55e' }} />Pay-in
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--muted)', fontSize: 12, fontWeight: 500 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: '#ef4444' }} />Payout
        </span>
      </div>

      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} key={period + ori}>{bars}</svg>

        {hover && (
          <div style={{
            position: 'absolute', left: `${hover.x}%`, top: `${hover.y}%`,
            transform: 'translate(-50%, -115%)', pointerEvents: 'none',
            background: 'var(--card)', border: '1px solid var(--cardborder)',
            boxShadow: '0 6px 20px rgba(0,0,0,.12)', borderRadius: 12, padding: '10px 14px',
            minWidth: 150, zIndex: 5,
          }}>
            <p style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 600, margin: '0 0 8px' }}>{hover.label}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: hover.kind === 'Pay-in' ? '#22c55e' : '#ef4444' }} />
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>{hover.kind}:</span>
              <span style={{ color: 'var(--text)', fontSize: 12, fontWeight: 700, marginLeft: 'auto' }}>{inrShort(hover.amount)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#94a3b8' }} />
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>Trades:</span>
              <span style={{ color: 'var(--text)', fontSize: 12, fontWeight: 700, marginLeft: 'auto' }}>{hover.trades}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
