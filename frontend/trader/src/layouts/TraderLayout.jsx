import { useCallback, useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sun, Moon, Menu, ChevronDown } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import NotificationBell from '../components/NotificationBell';
import HeaderSearch from '../components/HeaderSearch';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../hooks/useSocket';
import { Toaster, toast } from '../components/Toaster';
import { traderApi } from '../services/api';
import { getDevices } from '../lib/ngoApi';
import { inr, balance } from '../utils/mock';

/**
 * Shell for all authenticated trader pages: sidebar + top bar + routed content.
 * Shares { online, setOnline, connected } with child pages via Outlet context.
 */
export default function TraderLayout() {
  const { user } = useAuth();
  const { connected, socket } = useSocket();
  // Real online state — starts offline; initialised from the backend below.
  const [online, setOnline] = useState(false);
  // Real USDT balance from the traders table (via /trader/dashboard).
  const [liveBalance, setLiveBalance] = useState(null);
  // Real base exchange rate (INR/USDT), for the sidebar's INR-equivalent line.
  const [baseRate, setBaseRate] = useState(null);

  // Panel light/dark theme (the one allowed new UI state), persisted locally.
  // Read synchronously via the lazy initializer — reading it in a mount
  // effect instead raced against the persist-on-change effect below (both
  // fire in the same commit, and the persist effect would overwrite the
  // just-read saved value with the stale initial 'light' state before the
  // read could take effect), so dark mode never survived a reload.
  const [theme, setTheme] = useState(() => localStorage.getItem('panel-theme') || 'light');
  useEffect(() => {
    localStorage.setItem('panel-theme', theme);
  }, [theme]);
  const isLight = theme === 'light';

  // Sidebar collapse — the single collapse control lives in the header, so the
  // state is owned here and shared with the (now presentational) Sidebar.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    if (saved != null) setCollapsed(saved === 'true');
  }, []);
  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(collapsed));
  }, [collapsed]);

  // Load the trader's real is_online + balance on mount so the sidebar/toggle
  // reflect the DB (not the mock 0 fallback).
  const refreshProfile = useCallback(() => {
    traderApi
      .dashboard()
      .then((res) => {
        const d = res.data?.data;
        if (!d || Array.isArray(d)) return;
        setOnline(!!d.is_online);
        if (d.balance_usdt != null) setLiveBalance(Number(d.balance_usdt));
        if (d.base_rate != null) setBaseRate(Number(d.base_rate));
      })
      .catch(() => {});
  }, []);

  useEffect(() => { refreshProfile(); }, [refreshProfile]);

  // Sidebar "Buy USDT" badge — real awaiting-processing pool count (same
  // `counts.awaiting_processing` field BuyUsdt.jsx's own tabs already read).
  // Polled independently on a slower cadence since a nav badge doesn't need
  // BuyUsdt.jsx's 8s freshness, so this doesn't couple the shell to that page.
  const [buyUsdtCount, setBuyUsdtCount] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      traderApi
        .payoutRequests()
        .then((res) => { if (alive) setBuyUsdtCount(res.data?.data?.counts?.awaiting_processing ?? null); })
        .catch(() => { if (alive) setBuyUsdtCount(null); });
    };
    load();
    const id = setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Sidebar "Smartphones" badge — count of devices currently online, from
  // the same heartbeat field Smartphones.jsx's own poll already reads. This
  // is a real live count, so 0 legitimately renders as "0" (unlike the
  // Notifications badge below, which stays hidden because its backing field
  // is dead, not just currently zero).
  const [onlineDeviceCount, setOnlineDeviceCount] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      getDevices()
        .then((devices) => { if (alive) setOnlineDeviceCount((devices || []).filter((d) => d.online).length); })
        .catch(() => { if (alive) setOnlineDeviceCount(null); });
    };
    load();
    const id = setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Toggle Activity: persist to the backend, then flip local state. Optimistic
  // with revert on failure so routing always matches what the trader sees.
  const toggleOnline = useCallback(async (next) => {
    setOnline(next); // optimistic
    try {
      await traderApi.setOnline(next);
      toast(next ? 'You are now ONLINE — ready for orders' : 'You are now OFFLINE', next ? 'success' : 'info');
      refreshProfile();
    } catch (err) {
      setOnline(!next); // revert
      toast('Could not update your status. Try again.', 'error');
    }
  }, [refreshProfile]);

  // Real-time: surface new orders as toasts and let pages refresh their stats.
  useEffect(() => {
    if (!socket) return;
    const onNewOrder = (payload = {}) => {
      const amount = payload.amount ?? payload.amount_inr ?? payload.amountInr ?? 0;
      toast(`New order: ${inr(amount)}`, 'success');
      window.dispatchEvent(new CustomEvent('order:new', { detail: payload }));
    };
    socket.on('order:new', onNewOrder);
    return () => {
      socket.off('order:new', onNewOrder);
    };
  }, [socket]);

  // Real balance from the dashboard first, then the /me user balance, then mock.
  const displayBalance = liveBalance != null
    ? liveBalance
    : (user?.balance_usdt != null ? Number(user.balance_usdt) : balance);

  return (
    <div className="tf-scope flex" style={{ height: '100vh', overflow: 'hidden' }} data-theme={theme}>
      <Sidebar
        balance={displayBalance}
        baseRate={baseRate}
        collapsed={collapsed}
        // No `notifications` key here — its only real source
        // (traderApi.notifications()) reads a confirmed-dead table, so the
        // badge stays hidden (CountBadge renders nothing for a null/absent
        // value) rather than showing a fabricated number.
        badges={{ smartphones: onlineDeviceCount, buyUsdt: buyUsdtCount }}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header
          className="flex items-center justify-between"
          style={{ height: 68, flexShrink: 0, padding: '0 26px', background: 'var(--headbar)', borderBottom: '1px solid var(--cardborder)', transition: 'background-color .3s' }}
        >
          {/* Left — single collapse control + search */}
          <div className="flex items-center gap-2.5" style={{ flex: 1, minWidth: 0 }}>
            <button className="tf-hbtn" onClick={() => setCollapsed((c) => !c)} aria-label="Toggle sidebar" title="Toggle sidebar">
              <Menu size={18} />
            </button>
            <HeaderSearch />
          </div>

          {/* Right — online pill (toggles the trader's routing state), theme, bell, user */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => toggleOnline(!online)}
              title={online ? 'Receiving orders — click to go offline' : 'Offline — click to go online'}
              className="flex items-center gap-2"
              style={{
                height: 32, borderRadius: 999, padding: '0 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: online ? '1px solid #abefc6' : '1px solid var(--cardborder)',
                background: online ? '#ecfdf3' : 'var(--hover)',
                color: online ? '#067647' : 'var(--muted)',
              }}
            >
              <span
                style={{ width: 7, height: 7, borderRadius: '50%', background: online ? '#12b76a' : 'var(--muted)', boxShadow: online ? '0 0 0 4px rgba(18,183,106,.14)' : 'none' }}
              />
              {online ? 'Online & receiving' : 'Offline'}
            </button>

            {/* Theme toggle */}
            <button className="tf-hbtn" onClick={() => setTheme(isLight ? 'dark' : 'light')} aria-label="Toggle theme">
              {isLight ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* Notifications — real /trader/notifications feed */}
            <NotificationBell socket={socket} />

            {/* User */}
            <div className="flex items-center gap-2.5">
              <span
                className="flex items-center justify-center font-semibold"
                style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 13 }}
              >
                {(user?.email || 'T')[0].toUpperCase()}
              </span>
              <div style={{ lineHeight: 1.2 }}>
                <p style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600, margin: 0 }}>{user?.email || 'trader@p2p.com'}</p>
                <p style={{ color: 'var(--muted)', fontSize: 11, margin: 0, textTransform: 'capitalize' }}>{user?.role || 'trader'}</p>
              </div>
              <ChevronDown size={16} style={{ color: 'var(--subtle)' }} />
            </div>
          </div>
        </header>

        {/* Routed page */}
        <main className="tf-scroll flex-1 overflow-y-auto" style={{ padding: '24px 24px 40px' }}>
          <Outlet context={{ online, setOnline: toggleOnline, connected }} />
        </main>
      </div>

      <Toaster />
    </div>
  );
}
