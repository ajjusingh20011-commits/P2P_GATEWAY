import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Coins, Smartphone, Clock3, ChevronRight, CheckCircle2 } from 'lucide-react';
import { traderApi } from '../services/api';
import { getDevices } from '../lib/ngoApi';

/*
  Two dashboard sections used below the trader stat grid:

  - CommissionSection: REAL data from GET /trader/commission?period=. The big
    number toggles between ₹ (INR) and USDT on click; it counts up on change.
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
          below when it's paired with a taller sibling card. */}
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
    return () => { alive = false; };
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
