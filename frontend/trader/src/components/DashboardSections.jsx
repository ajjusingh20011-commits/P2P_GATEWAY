import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Coins, Smartphone, Clock3, ChevronRight, CheckCircle2, ArrowRight } from 'lucide-react';
import { traderApi } from '../services/api';
import { getDevices } from '../lib/ngoApi';
import { BankBadge, ScoreCircle } from './ui';
import { ACCOUNT_TYPES, inr } from '../utils/mock';

/*
  Dashboard sections used below the trader stat grid:

  - CommissionSection: REAL data from GET /trader/commission?period=. The big
    number toggles between ₹ (INR) and USDT on click; it counts up on change.
  - LivePoolSection: REAL payment-details data already fetched by Dashboard
    (is_active accounts), joined with real device names (getDevices(), same
    source Smartphones.jsx/AttentionSection already read) and real
    in-processing payout totals (traderApi.payoutRequests, same source
    BuyUsdt.jsx reads) for the pay-in/payout summary strip. Score is a
    placeholder (ScoreCircle) — no success-score metric exists yet.
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
    <div className="tf-card" style={{ padding: '20px 22px', position: 'relative' }}>
      <div className="flex items-start justify-between">
        <p style={{ color: 'var(--muted)', fontWeight: 500, fontSize: 13, margin: '0 0 7px' }}>Commission earned</p>
        <span
          className="tf-badge"
          style={{
            width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center',
            justifyContent: 'center', flexShrink: 0, background: hexA('#f59e0b', 0.14), color: '#f59e0b',
          }}
        >
          <Coins size={20} />
        </span>
      </div>
      <button
        type="button"
        onClick={toggleCur}
        title="Click to switch currency"
        style={{
          display: 'block', fontWeight: 800, fontSize: 23, margin: 0, letterSpacing: '-.4px', lineHeight: 1,
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
      <div className="flex items-center justify-between" style={{ marginTop: 9 }}>
        <span style={{ color: 'var(--muted)', fontSize: 11 }}>
          {NOTE[period]} · {error ? '—' : `${data?.trades ?? 0} trades`}
        </span>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          style={{
            fontSize: 10, fontWeight: 600, color: 'var(--muted)', background: 'var(--surface2)',
            border: '1px solid var(--cardborder)', borderRadius: 7, padding: '3px 6px', outline: 'none',
          }}
        >
          {PERIODS.map((k) => (
            <option key={k} value={k}>{TAB_LABEL[k]}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ---- Live pool (REAL payment-details data, joined with real devices +
// real in-processing payout totals) --------------------------------------
export function LivePoolSection({ details, todayVolumeInr }) {
  const navigate = useNavigate();
  const [deviceNames, setDeviceNames] = useState({});
  const [payoutSummary, setPayoutSummary] = useState({ count: 0, total: 0 });

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

  const live = (details || []).filter((d) => d.is_active);
  const rows = live.slice(0, 6);

  return (
    <div className="tf-card" style={{ padding: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
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

      <div className="flex items-center" style={{ margin: '0 22px 16px', border: '1px solid var(--cardborder)', borderRadius: 11, padding: '12px 4px' }}>
        <div className="flex flex-1 items-center justify-center gap-2.5">
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#12b76a', flexShrink: 0 }} />
          <div>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)' }}>Pay-in today</p>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{inr(todayVolumeInr || 0)} <span style={{ fontWeight: 500, color: 'var(--muted)', fontSize: 11 }}>· {live.length} accounts</span></p>
          </div>
        </div>
        <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--cardborder)' }} />
        <div className="flex flex-1 items-center justify-center gap-2.5">
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#f04438', flexShrink: 0 }} />
          <div>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)' }}>Payout processing</p>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{inr(payoutSummary.total)} <span style={{ fontWeight: 500, color: 'var(--muted)', fontSize: 11 }}>· {payoutSummary.count} accounts</span></p>
          </div>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--cardborder)' }}>
        <div
          className="grid"
          style={{ gridTemplateColumns: '2fr 1.3fr 1fr 60px', gap: 8, padding: '9px 22px', background: 'var(--surface2)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700, color: 'var(--muted)' }}
        >
          <span>Account</span>
          <span>Device / session</span>
          <span>Orders today</span>
          <span style={{ textAlign: 'right' }}>Score</span>
        </div>
        {rows.length === 0 ? (
          <p style={{ padding: '22px', color: 'var(--muted)', fontSize: 13, margin: 0, textAlign: 'center' }}>No live accounts right now.</p>
        ) : (
          rows.map((d) => {
            const type = ACCOUNT_TYPES[d.account_type] || { label: d.account_type };
            const isWeb = d.connectionType === 'web';
            const sessionLabel = isWeb
              ? 'Web session'
              : d.ngo_device_id
                ? (deviceNames[d.ngo_device_id] || 'APK device')
                : '—';
            return (
              <button
                key={d.id}
                onClick={() => navigate('/offers')}
                className="tf-row-hover grid w-full items-center text-left"
                style={{ gridTemplateColumns: '2fr 1.3fr 1fr 60px', gap: 8, padding: '10px 22px', border: 0, borderTop: '1px solid var(--cardborder)', background: 'transparent', cursor: 'pointer' }}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <BankBadge type={d.account_type} label={type.label} size={30} />
                  <span className="min-w-0">
                    <p className="truncate" style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{d.account_name}</p>
                    <p className="truncate" style={{ margin: 0, fontSize: 10, color: 'var(--muted)' }}>{type.label}</p>
                  </span>
                </span>
                <span className="truncate" style={{ fontSize: 11, color: 'var(--muted)' }}>{sessionLabel}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                  {d.usage?.used_today ?? 0}{d.max_per_day ? ` / ${d.max_per_day}` : ''}
                </span>
                <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <ScoreCircle size={28} />
                </span>
              </button>
            );
          })
        )}
      </div>

      {live.length > rows.length && (
        <button
          onClick={() => navigate('/offers')}
          style={{ width: '100%', border: 0, borderTop: '1px solid var(--cardborder)', background: 'transparent', color: 'var(--accent)', padding: '11px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
        >
          View all live pool accounts →
        </button>
      )}
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
