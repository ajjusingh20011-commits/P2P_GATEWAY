import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sun, Moon, Shield } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import NotificationBell from '../components/NotificationBell';
import HeaderSearch from '../components/HeaderSearch';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../hooks/useSocket';
import { Toaster } from '../components/toast';
import { counts } from '../utils/mock';

/**
 * Shell for all authenticated admin pages: sidebar + top bar + routed content.
 * Shares { connected } with child pages via Outlet context.
 */
export default function AdminLayout() {
  const { user } = useAuth();
  const { connected, paidCount } = useSocket();

  // Panel light/dark theme (the one allowed new UI state), persisted locally
  // under the shared cross-panel key.
  const [theme, setTheme] = useState('light');
  useEffect(() => {
    const saved = localStorage.getItem('panel-theme');
    if (saved) setTheme(saved);
  }, []);
  useEffect(() => {
    localStorage.setItem('panel-theme', theme);
  }, [theme]);
  const isLight = theme === 'light';

  return (
    <div className="tf-scope flex" style={{ height: '100vh', overflow: 'hidden' }} data-theme={theme}>
      <Toaster />
      <Sidebar badges={{ disputes: counts.disputes, payouts: counts.payouts, orders: counts.orders }} />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Slim top bar */}
        <header
          className="flex items-center justify-between"
          style={{ padding: '12px 22px', background: 'var(--headbar)', borderBottom: '1px solid var(--cardborder)', transition: 'background-color .3s' }}
        >
          <div className="flex items-center gap-2" style={{ fontSize: 13, fontWeight: 500, color: connected ? '#22c55e' : 'var(--muted)' }}>
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: connected ? '#22c55e' : 'var(--muted)' }} />
            {connected ? 'Realtime connected' : 'Realtime offline'}
            {paidCount > 0 && (
              <span
                className="ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                style={{ background: 'rgba(139,92,246,.12)', color: '#8b5cf6' }}
              >
                {paidCount} new paid
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {/* Search — live lookup over orders / traders / merchants */}
            <HeaderSearch />

            {/* Administrator badge (red, restraint) */}
            <span
              className="hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex"
              style={{ background: 'rgba(239,68,68,.11)', color: '#ef4444' }}
            >
              <Shield size={14} />
              Administrator
            </span>

            {/* Notifications — recent order activity feed */}
            <NotificationBell />

            {/* Theme toggle */}
            <button className="tf-hbtn" onClick={() => setTheme(isLight ? 'dark' : 'light')} aria-label="Toggle theme">
              {isLight ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* User */}
            <div className="text-right" style={{ lineHeight: 1.2 }}>
              <p style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600, margin: 0 }}>{user?.email || 'admin@p2p.com'}</p>
              <p style={{ color: 'var(--muted)', fontSize: 11, margin: 0, textTransform: 'capitalize' }}>{user?.role || 'admin'}</p>
            </div>
            <span
              className="flex items-center justify-center font-semibold text-white"
              style={{ width: 34, height: 34, borderRadius: '50%', background: '#ef4444', fontSize: 13 }}
            >
              {(user?.email || 'A')[0].toUpperCase()}
            </span>
          </div>
        </header>

        {/* Routed page */}
        <main className="tf-scroll flex-1 overflow-y-auto" style={{ padding: '20px 22px' }}>
          <Outlet context={{ connected }} />
        </main>
      </div>
    </div>
  );
}
