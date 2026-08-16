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

// Presence cadence. The backend marks a trader offline once last_heartbeat is
// older than HEARTBEAT_TIMEOUT_MS (config.platform, 2 min by default), so the
// ping interval has to sit comfortably inside that window.
const HEARTBEAT_INTERVAL_MS = 30 * 1000;
// How long a hidden tab still counts as presence. Kept comfortably BELOW the
// server's HEARTBEAT_TIMEOUT_MS (config.platform, 2 min) so the client stops
// asserting presence before — never after — the server would sweep the trader
// offline. The mismatch used to run the other way (5 min grace vs 2 min
// timeout), so a buried tab believed it was still present for minutes after the
// server had already dropped it. A tab that returns to the foreground re-pings
// and recovers immediately (see the heartbeat effect below).
const HIDDEN_GRACE_MS = 90 * 1000;
// How often the sidebar re-reads the trader's real is_online from the DB.
const PRESENCE_INTERVAL_MS = 30 * 1000;

/**
 * Shell for all authenticated trader pages: sidebar + top bar + routed content.
 * Shares { online, setOnline, connected, theme, setTheme } with child pages
 * via Outlet context — theme/setTheme is the same real, localStorage-persisted
 * state the header's own theme toggle uses, so a page-level dark-mode control
 * (Settings' Appearance card) stays backed by one real source, not a second one.
 */
export default function TraderLayout() {
  const { user } = useAuth();
  const { connected, socket } = useSocket();
  // Real online state — starts offline; initialised from the backend below.
  const [online, setOnline] = useState(false);
  // The trader's INTENT to be online — distinct from the DB is_online flag. The
  // heartbeat runs on THIS, not on the DB flag, so a transient sweep (a
  // throttled/backgrounded tab, a brief blip) that flips is_online to false is
  // recovered by the very next ping instead of the panel giving up and never
  // pinging again — the non-recovery race that left traders silently offline.
  // Persisted so a reload keeps intent; cleared only on an explicit toggle-off.
  const [wantsOnline, setWantsOnline] = useState(() => localStorage.getItem('trader-wants-online') === 'true');
  useEffect(() => { localStorage.setItem('trader-wants-online', String(wantsOnline)); }, [wantsOnline]);
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

  // Below 900px the sidebar becomes an off-canvas drawer (matches the design's
  // .sidebar.mobileOpen) instead of the desktop width-collapse — the same
  // header button drives both, branching on viewport at click time.
  const MOBILE_QUERY = '(max-width: 900px)';
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const toggleSidebar = () => {
    if (window.matchMedia(MOBILE_QUERY).matches) setMobileNavOpen((v) => !v);
    else setCollapsed((c) => !c);
  };

  // Load the trader's real is_online + balance on mount so the sidebar/toggle
  // reflect the DB (not the mock 0 fallback).
  const refreshProfile = useCallback(() => {
    traderApi
      .dashboard()
      .then((res) => {
        const d = res.data?.data;
        if (!d || Array.isArray(d)) return;
        setOnline(!!d.is_online);
        // Server says online -> the trader intends to be online, so the
        // heartbeat should keep running. Going offline does NOT clear intent
        // here (only an explicit toggle-off does), so a transient sweep can't
        // silence the heartbeat and strand the trader.
        if (d.is_online) setWantsOnline(true);
        if (d.balance_usdt != null) setLiveBalance(Number(d.balance_usdt));
        if (d.base_rate != null) setBaseRate(Number(d.base_rate));
      })
      .catch(() => {});
  }, []);

  // Poll the real is_online rather than trusting the last toggle position.
  // The toggle used to be set once on mount and then never re-checked, so when
  // the backend's heartbeatCheck job flipped is_online to false the sidebar
  // went on showing a green "Online & receiving" indefinitely while routing
  // was already rejecting every order for this trader. Whatever else drifts,
  // the indicator now converges on the DB within one interval.
  useEffect(() => {
    refreshProfile();
    const id = setInterval(refreshProfile, PRESENCE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshProfile]);

  // Presence heartbeat. traders.last_heartbeat is what keeps is_online true;
  // nothing in this panel ever sent one, so a trader who toggled online was
  // silently marked offline by heartbeatCheck ~2 minutes later and every
  // subsequent order failed with no_provider_available.
  //
  // Runs while the trader INTENDS to be online (wantsOnline) AND the panel is
  // present — NOT while the DB flag happens to be true. Keying on intent is
  // what makes a transient offline self-heal: a ping (which sets is_online=true
  // server-side) fires every interval, so a trader swept offline while their
  // tab was briefly buried/throttled is pulled back into the pool on the next
  // tick instead of the panel going quiet forever. Close the tab and pings stop
  // and the trader times out normally; toggle OFF and intent clears and pings
  // stop. A hidden tab keeps pinging for HIDDEN_GRACE_MS; returning to the
  // foreground re-pings and re-reads status immediately.
  useEffect(() => {
    if (!wantsOnline) return undefined;
    let hiddenSince = document.visibilityState === 'hidden' ? Date.now() : null;

    const present = () => hiddenSince == null || Date.now() - hiddenSince < HIDDEN_GRACE_MS;
    const ping = () => { if (present()) traderApi.heartbeat().catch(() => {}); };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSince = Date.now();
        return;
      }
      // Back on screen: resume immediately and re-read the real status, which
      // may have gone offline while the tab was buried.
      hiddenSince = null;
      ping();
      refreshProfile();
    };

    ping();
    const id = setInterval(ping, HEARTBEAT_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [wantsOnline, refreshProfile]);

  // Keep the sidebar balance live: the socket effect below already re-dispatches
  // every settlement/cancellation/payout event as a window 'order:update' event
  // (the same one Dashboard.jsx listens to for its own numbers) — but nothing
  // here ever listened for it, so a real trader-confirm settlement moved the
  // trader's actual balance_usdt in the DB immediately while the sidebar figure
  // sat stale until the next navigation or reload. This re-fetches it the same
  // way toggleOnline already does after a state change.
  useEffect(() => {
    window.addEventListener('order:update', refreshProfile);
    return () => window.removeEventListener('order:update', refreshProfile);
  }, [refreshProfile]);

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
    setWantsOnline(next); // intent drives the heartbeat and its auto-recovery
    setOnline(next); // optimistic
    try {
      await traderApi.setOnline(next);
      toast(next ? 'You are now ONLINE — ready for orders' : 'You are now OFFLINE', next ? 'success' : 'info');
      refreshProfile();
    } catch (err) {
      setWantsOnline(!next);
      setOnline(!next); // revert
      toast('Could not update your status. Try again.', 'error');
    }
  }, [refreshProfile]);

  // Real-time: surface new orders as toasts, and re-broadcast every socket
  // event that can change a Dashboard number as a window CustomEvent so
  // pages/sections don't each need their own socket connection (Dashboard.jsx,
  // DashboardSections.jsx already had 'order:update' listeners wired up for
  // this — nothing ever dispatched that event, so they were dead code).
  useEffect(() => {
    if (!socket) return;
    const onNewOrder = (payload = {}) => {
      const amount = payload.amount ?? payload.amount_inr ?? payload.amountInr ?? 0;
      toast(`New order: ${inr(amount)}`, 'success');
      window.dispatchEvent(new CustomEvent('order:new', { detail: payload }));
      window.dispatchEvent(new CustomEvent('order:update', { detail: payload }));
    };
    // Every one of these is a real, confirmed-firing backend event that
    // changes this trader's own volume/success-rate/commission/live-pool
    // numbers (order settlement/cancellation/expiry, a payment being
    // detected, or a payout request changing state) — see
    // backend/src/services/{smartMerge,payoutService,orderService}.js and
    // backend/src/controllers/orderController.js.
    const REFRESH_EVENTS = [
      'order:confirmed', 'order:completed', 'order:claimed_paid',
      'order:cancelled', 'order:expired', 'payment:detected',
      'payout:accepted', 'payout:settled', 'payout:canceled',
      'payout:disputed', 'payout:expired',
    ];
    const onRefresh = (payload = {}) => window.dispatchEvent(new CustomEvent('order:update', { detail: payload }));
    // Admin force-disconnected one of this trader's devices — the only
    // device-state event actually pushed to the trader room (heartbeat
    // online/offline is polled, not socket-pushed — see the
    // PRESENCE_INTERVAL_MS poll above).
    const onDeviceDisconnected = (payload = {}) => window.dispatchEvent(new CustomEvent('device:disconnected', { detail: payload }));

    socket.on('order:new', onNewOrder);
    REFRESH_EVENTS.forEach((ev) => socket.on(ev, onRefresh));
    socket.on('device:disconnected', onDeviceDisconnected);
    return () => {
      socket.off('order:new', onNewOrder);
      REFRESH_EVENTS.forEach((ev) => socket.off(ev, onRefresh));
      socket.off('device:disconnected', onDeviceDisconnected);
    };
  }, [socket]);

  // Real balance from the dashboard first, then the /me user balance, then mock.
  const displayBalance = liveBalance != null
    ? liveBalance
    : (user?.balance_usdt != null ? Number(user.balance_usdt) : balance);

  return (
    <div className="tf-scope flex" style={{ height: '100vh', overflow: 'hidden' }} data-theme={theme}>
      {mobileNavOpen && <div className="tf-mobile-backdrop" onClick={() => setMobileNavOpen(false)} />}
      <Sidebar
        balance={displayBalance}
        baseRate={baseRate}
        online={online}
        onToggleOnline={toggleOnline}
        collapsed={collapsed}
        mobileOpen={mobileNavOpen}
        onNavigate={() => setMobileNavOpen(false)}
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
            <button className="tf-hbtn" onClick={toggleSidebar} aria-label="Toggle sidebar" title="Toggle sidebar">
              <Menu size={18} />
            </button>
            <div className="tf-header-search">
              <HeaderSearch />
            </div>
          </div>

          {/* Right — online pill (toggles the trader's routing state), theme, bell, user */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => toggleOnline(!online)}
              title={online ? 'Receiving orders — click to go offline' : 'Offline — click to go online'}
              className="tf-online-pill flex items-center gap-2"
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

        {/* Routed page — left/right tightened from 24px: that gutter, not
            anything inside the table cards, was the real source of wasted
            width forcing early horizontal scroll on wide tables. */}
        <main className="tf-scroll flex-1 overflow-y-auto" style={{ padding: '24px 16px 40px' }}>
          <Outlet context={{ online, setOnline: toggleOnline, connected, theme, setTheme }} />
        </main>
      </div>

      <Toaster />
    </div>
  );
}
