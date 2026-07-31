import { useCallback, useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sun, Moon, Menu } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import NotificationBell from '../components/NotificationBell';
import HeaderSearch from '../components/HeaderSearch';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../hooks/useSocket';
import { Toaster } from '../components/Toaster';
import { counts } from '../utils/mock';
import { merchantApi } from '../services/api';

/**
 * Shell for all authenticated merchant pages: sidebar + top bar + routed content.
 * Mirrors the trader panel's shell structure (same MaxPay shell reference):
 * single header collapse/mobile-drawer control, 68px header, presentational Sidebar.
 */
export default function MerchantLayout() {
  const { user } = useAuth();
  const { connected } = useSocket();
  const name = user?.businessName || user?.name || 'Test Store';

  // Real balance, fetched once to feed the sidebar's settlement-balance card
  // (same "one lightweight fetch in the always-mounted shell" pattern used
  // for the trader sidebar's buy-USDT badge).
  const [balanceUsdt, setBalanceUsdt] = useState(null);
  useEffect(() => {
    merchantApi
      .balance()
      .then((res) => setBalanceUsdt(res.data?.data?.balance_usdt ?? null))
      .catch(() => {});
  }, []);

  // Panel light/dark theme (the one allowed new UI state), persisted under the
  // shared cross-panel key. Read synchronously via the lazy initializer —
  // reading it in a mount effect instead raced against the persist-on-change
  // effect below (both fire in the same commit, and the persist effect would
  // overwrite the just-read saved value with the stale initial 'light' state
  // before the read could take effect), so dark mode never survived a reload.
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

  // Below 900px the sidebar becomes an off-canvas drawer (matches the design's
  // .sidebar.mobileOpen) instead of the desktop width-collapse — the same
  // header button drives both, branching on viewport at click time.
  const MOBILE_QUERY = '(max-width: 900px)';
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const toggleSidebar = useCallback(() => {
    if (window.matchMedia(MOBILE_QUERY).matches) setMobileNavOpen((v) => !v);
    else setCollapsed((c) => !c);
  }, []);

  return (
    <div className="tf-scope flex" style={{ height: '100vh', overflow: 'hidden' }} data-theme={theme}>
      {mobileNavOpen && <div className="tf-mobile-backdrop" onClick={() => setMobileNavOpen(false)} />}
      <Sidebar
        badges={{ ordersPending: counts.ordersPending }}
        balanceUsdt={balanceUsdt}
        collapsed={collapsed}
        mobileOpen={mobileNavOpen}
        onNavigate={() => setMobileNavOpen(false)}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header
          className="flex items-center justify-between"
          style={{ height: 68, flexShrink: 0, padding: '0 26px', background: 'var(--headbar)', borderBottom: '1px solid var(--cardborder)', transition: 'background-color .3s' }}
        >
          {/* Left — single collapse control + search */}
          <div className="flex items-center gap-2.5" style={{ flex: 1, minWidth: 0 }}>
            <button className="tf-hbtn" onClick={toggleSidebar} aria-label="Toggle sidebar" title="Toggle sidebar">
              <Menu size={18} />
            </button>
            <div className="tf-header-search">
              {/* Search — live lookup over orders / transactions */}
              <HeaderSearch />
            </div>
          </div>

          {/* Right — realtime pill (genuinely socket-driven, unlike the design's decorative "Online" badge), theme, bell, profile */}
          <div className="flex items-center gap-2.5">
            <span
              className="tf-online-pill flex items-center gap-2"
              title={connected ? 'Realtime updates connected' : 'Realtime updates offline'}
              style={{
                height: 32, borderRadius: 999, padding: '0 12px', fontSize: 12, fontWeight: 650,
                border: connected ? '1px solid #abefc6' : '1px solid var(--cardborder)',
                background: connected ? '#ecfdf3' : 'var(--hover)',
                color: connected ? '#067647' : 'var(--muted)',
              }}
            >
              <span
                style={{ width: 7, height: 7, borderRadius: '50%', background: connected ? '#12b76a' : 'var(--muted)', boxShadow: connected ? '0 0 0 4px rgba(18,183,106,.14)' : 'none' }}
              />
              {connected ? 'Realtime connected' : 'Realtime offline'}
            </span>

            {/* Notifications — recent order activity feed */}
            <NotificationBell />

            {/* Theme toggle */}
            <button className="tf-hbtn" onClick={() => setTheme(isLight ? 'dark' : 'light')} aria-label="Toggle theme">
              {isLight ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* Store identity */}
            <div className="flex items-center gap-2.5">
              <span
                className="flex items-center justify-center font-semibold"
                style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 13 }}
              >
                {name[0].toUpperCase()}
              </span>
              <div style={{ lineHeight: 1.2 }}>
                <p style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600, margin: 0 }}>{name}</p>
                <p style={{ color: 'var(--muted)', fontSize: 11, margin: 0 }}>{user?.email || 'merchant@p2p.com'}</p>
              </div>
            </div>
          </div>
        </header>

        {/* Routed page */}
        <main className="tf-scroll flex-1 overflow-y-auto" style={{ padding: '24px 24px 40px' }}>
          <Outlet context={{ connected }} />
        </main>
      </div>

      <Toaster />
    </div>
  );
}
