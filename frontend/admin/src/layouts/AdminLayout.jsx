import { useCallback, useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sun, Moon, Menu, Shield } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import NotificationBell from '../components/NotificationBell';
import HeaderSearch from '../components/HeaderSearch';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../hooks/useSocket';
import { Toaster } from '../components/toast';
import { adminApi } from '../services/api';

/**
 * Shell for all authenticated admin pages: sidebar + top bar + routed content.
 * Mirrors the merchant/trader panel's shell structure (same MaxPay shell
 * reference): single header collapse/mobile-drawer control, 68px header,
 * presentational Sidebar.
 */
export default function AdminLayout() {
  const { user } = useAuth();
  const { connected, paidCount } = useSocket();

  // Real per-nav badge counts. All four numbers come from the same three
  // real endpoints the Attention page itself aggregates (under_review
  // orders / open disputes / disputed payout requests) — `attention` is
  // just their sum. Replaces the previously-hardcoded-to-0 counts.disputes/
  // payouts/orders from utils/mock.js.
  //
  // Each admin list endpoint shapes its response differently, so each count
  // is read from wherever it's actually real:
  //  - GET /admin/orders is genuinely paginated -> pagination.total.
  //  - GET /admin/disputes is a plain findAll with no pagination at all
  //    (confirmed in adminController.listDisputes) -> array length.
  //  - GET /admin/payout-requests returns a `counts` object computed across
  //    ALL statuses regardless of the query filter -> counts.dispute.
  const [badgeCounts, setBadgeCounts] = useState({ orders: null, disputes: null, payouts: null, attention: null });
  useEffect(() => {
    let alive = true;
    Promise.all([
      adminApi.listOrders({ status: 'under_review', limit: 1 }).catch(() => ({ pagination: { total: 0 } })),
      adminApi.listDisputes({ status: 'open' }).catch(() => ({ disputes: [] })),
      adminApi.listPayoutRequests({ status: 'dispute' }).catch(() => ({ counts: { dispute: 0 } })),
    ]).then(([o, d, p]) => {
      if (!alive) return;
      const orders = o.pagination?.total ?? 0;
      const disputes = d.disputes?.length ?? 0;
      const payouts = p.counts?.dispute ?? 0;
      setBadgeCounts({ orders, disputes, payouts, attention: orders + disputes + payouts });
    });
    return () => { alive = false; };
  }, []);

  // Panel light/dark theme (the one allowed new UI state), persisted under
  // the shared cross-panel key. Read synchronously via the lazy initializer
  // (not a mount effect) — see the identical fix in trader's/merchant's
  // layout: reading it in an effect races the persist-on-change effect and
  // dark mode never survives a reload.
  const [theme, setTheme] = useState(() => localStorage.getItem('panel-theme') || 'light');
  useEffect(() => {
    localStorage.setItem('panel-theme', theme);
  }, [theme]);
  const isLight = theme === 'light';

  // Sidebar collapse — the single collapse control lives in the header, so
  // the state is owned here and shared with the (now presentational) Sidebar.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    if (saved != null) setCollapsed(saved === 'true');
  }, []);
  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(collapsed));
  }, [collapsed]);

  // Below 900px the sidebar becomes an off-canvas drawer (matches the
  // design's .sidebar.mobileOpen) instead of the desktop width-collapse —
  // the same header button drives both, branching on viewport at click time.
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
        badges={badgeCounts}
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
          {/* Left — single collapse control + realtime pill + search */}
          <div className="flex items-center gap-2.5" style={{ flex: 1, minWidth: 0 }}>
            <button className="tf-hbtn" onClick={toggleSidebar} aria-label="Toggle sidebar" title="Toggle sidebar">
              <Menu size={18} />
            </button>
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
              {paidCount > 0 && (
                <span
                  className="ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{ background: 'rgba(139,92,246,.12)', color: '#8b5cf6' }}
                >
                  {paidCount} new paid
                </span>
              )}
            </span>
            <div className="tf-header-search">
              {/* Search — live lookup over orders / traders / merchants */}
              <HeaderSearch />
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Administrator badge (red, role identity — single real admin role) */}
            <span
              className="hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
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
            <div className="flex items-center gap-2.5">
              <span
                className="flex items-center justify-center font-semibold text-white"
                style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--accent)', fontSize: 13 }}
              >
                {(user?.email || 'A')[0].toUpperCase()}
              </span>
              <div style={{ lineHeight: 1.2 }}>
                <p style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600, margin: 0 }}>{user?.email || 'admin@p2p.com'}</p>
                <p style={{ color: 'var(--muted)', fontSize: 11, margin: 0, textTransform: 'capitalize' }}>{user?.role || 'admin'}</p>
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
