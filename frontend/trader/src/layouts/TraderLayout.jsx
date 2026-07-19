import { useCallback, useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sun, Moon } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import NotificationBell from '../components/NotificationBell';
import HeaderSearch from '../components/HeaderSearch';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../hooks/useSocket';
import { Toaster, toast } from '../components/Toaster';
import { traderApi } from '../services/api';
import { inr, balance, counts } from '../utils/mock';

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

  // Panel light/dark theme (the one allowed new UI state), persisted locally.
  const [theme, setTheme] = useState('light');
  useEffect(() => {
    const saved = localStorage.getItem('panel-theme');
    if (saved) setTheme(saved);
  }, []);
  useEffect(() => {
    localStorage.setItem('panel-theme', theme);
  }, [theme]);
  const isLight = theme === 'light';

  // Load the trader's real is_online + balance on mount so the sidebar/toggle
  // reflect the DB (not the mock 0 fallback).
  const refreshProfile = useCallback(() => {
    traderApi
      .dashboard()
      .then((res) => {
        const d = res.data?.data;
        if (!d) return;
        setOnline(!!d.is_online);
        if (d.balance_usdt != null) setLiveBalance(Number(d.balance_usdt));
      })
      .catch(() => {});
  }, []);

  useEffect(() => { refreshProfile(); }, [refreshProfile]);

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
        online={online}
        onToggleOnline={toggleOnline}
        badges={{ notifications: counts.notifications, smartphones: counts.smartphones }}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Slim top bar */}
        <header
          className="flex items-center justify-between"
          style={{ padding: '12px 22px', background: 'var(--headbar)', borderBottom: '1px solid var(--cardborder)', transition: 'background-color .3s' }}
        >
          <div className="flex items-center gap-2" style={{ fontSize: 13, fontWeight: 500, color: connected ? '#22c55e' : 'var(--muted)' }}>
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: connected ? '#22c55e' : 'var(--muted)' }}
            />
            {connected ? 'Realtime connected' : 'Realtime offline'}
          </div>

          <div className="flex items-center gap-2.5">
            {/* Search — live lookup over the trader's orders + payment details */}
            <HeaderSearch />

            {/* Notifications — real /trader/notifications feed */}
            <NotificationBell socket={socket} />

            {/* Theme toggle */}
            <button className="tf-hbtn" onClick={() => setTheme(isLight ? 'dark' : 'light')} aria-label="Toggle theme">
              {isLight ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* User */}
            <div className="text-right" style={{ lineHeight: 1.2 }}>
              <p style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600, margin: 0 }}>{user?.email || 'trader@p2p.com'}</p>
              <p style={{ color: 'var(--muted)', fontSize: 11, margin: 0, textTransform: 'capitalize' }}>{user?.role || 'trader'}</p>
            </div>
            <span
              className="flex items-center justify-center font-semibold text-white"
              style={{ width: 34, height: 34, borderRadius: '50%', background: '#10b981', fontSize: 13 }}
            >
              {(user?.email || 'T')[0].toUpperCase()}
            </span>
          </div>
        </header>

        {/* Routed page */}
        <main className="tf-scroll flex-1 overflow-y-auto" style={{ padding: '20px 22px' }}>
          <Outlet context={{ online, setOnline: toggleOnline, connected }} />
        </main>
      </div>

      <Toaster />
    </div>
  );
}
