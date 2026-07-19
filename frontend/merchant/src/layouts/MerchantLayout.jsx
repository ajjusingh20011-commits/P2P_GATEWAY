import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sun, Moon } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import NotificationBell from '../components/NotificationBell';
import HeaderSearch from '../components/HeaderSearch';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../hooks/useSocket';
import { Toaster } from '../components/Toaster';
import { counts } from '../utils/mock';

/**
 * Shell for all authenticated merchant pages: sidebar + top bar + routed content.
 */
export default function MerchantLayout() {
  const { user } = useAuth();
  const { connected } = useSocket();
  const name = user?.businessName || user?.name || 'Test Store';

  // Panel light/dark theme (the one allowed new UI state), persisted under the
  // shared cross-panel key.
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
      <Sidebar badges={{ ordersPending: counts.ordersPending }} />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Slim top bar */}
        <header
          className="flex items-center justify-between"
          style={{ padding: '12px 22px', background: 'var(--headbar)', borderBottom: '1px solid var(--cardborder)', transition: 'background-color .3s' }}
        >
          <div className="flex items-center gap-2" style={{ fontSize: 13, fontWeight: 500, color: connected ? '#22c55e' : 'var(--muted)' }}>
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: connected ? '#22c55e' : 'var(--muted)' }} />
            {connected ? 'Realtime connected' : 'Realtime offline'}
          </div>

          <div className="flex items-center gap-2.5">
            {/* Search — live lookup over orders / transactions */}
            <HeaderSearch />

            {/* Notifications — recent order activity feed */}
            <NotificationBell />

            {/* Theme toggle */}
            <button className="tf-hbtn" onClick={() => setTheme(isLight ? 'dark' : 'light')} aria-label="Toggle theme">
              {isLight ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* Store identity */}
            <div className="text-right" style={{ lineHeight: 1.2 }}>
              <p style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600, margin: 0 }}>{name}</p>
              <p style={{ color: 'var(--muted)', fontSize: 11, margin: 0 }}>{user?.email || 'merchant@p2p.com'}</p>
            </div>
            <span
              className="flex items-center justify-center font-semibold text-white"
              style={{ width: 34, height: 34, borderRadius: '50%', background: '#8b5cf6', fontSize: 13 }}
            >
              {name[0].toUpperCase()}
            </span>
          </div>
        </header>

        {/* Routed page */}
        <main className="tf-scroll flex-1 overflow-y-auto" style={{ padding: '20px 22px' }}>
          <Outlet context={{ connected }} />
        </main>
      </div>

      <Toaster />
    </div>
  );
}
