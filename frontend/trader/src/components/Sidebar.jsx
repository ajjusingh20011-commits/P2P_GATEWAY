import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ArrowUpRight,
  ArrowDownLeft,
  Landmark,
  Bell,
  Smartphone,
  Settings as SettingsIcon,
  LogOut,
  HelpCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import usdtLogo from '../assets/logos/usdt.svg';

// Balance amount only (no unit suffix) — the sidebar shows the USDT unit as the
// real logo instead of the word "USDT".
const usdtAmount = (n) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ₹ lakh-compact formatter, matching the reference's `compact()` helper —
// used only for the sidebar's secondary (INR-equivalent) balance line.
const compactInr = (n) => (n >= 100000 ? `₹${(n / 100000).toFixed(2)}L` : `₹${Math.round(n).toLocaleString('en-IN')}`);

// Order and badge placement match the MaxPay reference NAV exactly (Overview,
// Sell USDT, Buy USDT, Payment details, Notifications, Smartphones, Settings).
// The reference has no "Downloads" entry — that item never had a real route
// here either (disabled placeholder only), so it's dropped rather than kept
// as a dead nav item the design doesn't show.
const NAV = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { to: '/trades', label: 'Sell USDT', icon: ArrowUpRight },
  { to: '/buy-usdt', label: 'Buy USDT', icon: ArrowDownLeft, badge: 'buyUsdt' },
  { to: '/offers', label: 'Payment details', icon: Landmark },
  { to: '/notifications', label: 'Notifications', icon: Bell, badge: 'notifications' },
  { to: '/smartphones', label: 'Smartphones', icon: Smartphone, badge: 'smartphones' },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

// Soft indigo count pill (matches the reference nav badge).
function CountBadge({ value }) {
  if (value == null) return null;
  const text = value > 99 ? '99+' : String(value);
  return (
    <span
      className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
    >
      {text}
    </span>
  );
}

/**
 * Trader sidebar (MaxPay visual system). Collapse is controlled from the top
 * header (single collapse control), so this is a presentational component that
 * only reads `collapsed`. Balance is real (from the trader's dashboard).
 */
export default function Sidebar({ balance, baseRate, online, onToggleOnline, badges = {}, collapsed = false, mobileOpen = false, onNavigate }) {
  const { logout } = useAuth();

  const linkClass = ({ isActive }) => `tf-nav${isActive ? ' active' : ''}${collapsed ? ' tf-tip' : ''}`;
  const collapsedNavStyle = collapsed ? { justifyContent: 'center', gap: 0 } : undefined;

  return (
    <aside
      className={`tf-sidebar flex h-screen flex-shrink-0 flex-col${mobileOpen ? ' tf-sidebar-mobile-open' : ''}`}
      style={{
        width: collapsed ? 72 : 216,
        background: 'var(--sidebar)',
        borderRight: '1px solid var(--cardborder)',
        padding: '16px 10px',
        transition: 'width .25s ease, background-color .3s',
      }}
    >
      {/* Brand mark */}
      <div className="flex items-center gap-2.5" style={{ padding: collapsed ? '0 0 12px' : '0 6px 12px', justifyContent: collapsed ? 'center' : undefined }}>
        <span
          className="flex items-center justify-center font-extrabold text-white"
          style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(145deg,#5b55ee,#3d36bd)', fontSize: 15, boxShadow: '0 7px 20px rgba(79,70,229,.24)' }}
        >
          M
        </span>
        {!collapsed && (
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16 }}>MaxPay</div>
            <div style={{ color: 'var(--muted)', fontSize: 11 }}>Trader</div>
          </div>
        )}
      </div>

      {/* Purple-gradient balance card (expanded only) — real available balance.
          Reference also shows an INR-equivalent + a period delta%; the delta
          has no real backing (no balance-history endpoint), so only the real,
          derivable INR-equivalent (balance × current base rate) is shown. */}
      {!collapsed && (
        <div style={{ margin: '10px 2px 18px', padding: 16, borderRadius: 14, background: 'linear-gradient(145deg,#4f46e5,#3730a3)', color: '#fff' }}>
          <p style={{ opacity: 0.72, fontSize: 12, margin: 0 }}>Available balance</p>
          <p style={{ fontWeight: 800, fontSize: 21, margin: '7px 0 0', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <span>{usdtAmount(balance)}</span>
            <img src={usdtLogo} alt="USDT" style={{ width: 22, height: 22, objectFit: 'contain', display: 'block' }} />
          </p>
          {baseRate > 0 && (
            <div className="flex items-center justify-between" style={{ fontSize: 12 }}>
              <span style={{ opacity: 0.85 }}>{compactInr(balance * baseRate)}</span>
            </div>
          )}

          {/* Same real online/receiving state as the header pill (TraderLayout's
              `online` + `toggleOnline`, backed by PUT /trader/online-status) —
              not a second, independently-tracked toggle that could drift out
              of sync with it. */}
          <div
            className="flex items-center justify-between"
            style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,.16)' }}
          >
            <span className="flex items-center gap-1.5" style={{ fontSize: 11, opacity: 0.85 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: online ? '#4ade80' : 'rgba(255,255,255,.45)', flexShrink: 0 }} />
              {online ? 'Online & receiving' : 'Offline'}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={!!online}
              aria-label={online ? 'Go offline' : 'Go online'}
              onClick={() => onToggleOnline?.(!online)}
              style={{
                position: 'relative', width: 34, height: 19, borderRadius: 999, border: 'none', cursor: 'pointer', flexShrink: 0,
                background: online ? '#22c55e' : 'rgba(255,255,255,.25)', transition: 'background-color .2s',
              }}
            >
              <span
                style={{
                  position: 'absolute', top: 2, left: online ? 17 : 2, width: 15, height: 15, borderRadius: '50%',
                  background: '#fff', transition: 'left .2s',
                }}
              />
            </button>
          </div>
        </div>
      )}

      {/* Workspace nav */}
      <nav className="tf-scroll mt-1 flex-1 space-y-1 overflow-y-auto overflow-x-hidden">
        <small style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--subtle)', padding: '9px 11px', letterSpacing: '.12em' }}>
          {collapsed ? '•••' : 'WORKSPACE'}
        </small>
        {NAV.map(({ to, label, icon: Icon, badge }) => {
          const count = badge ? badges[badge] : null;
          const hasCount = count != null && count > 0;
          return (
            <NavLink key={to} to={to} onClick={onNavigate} className={linkClass} data-tip={collapsed ? label : undefined} style={collapsedNavStyle}>
              <span style={{ position: 'relative', display: 'flex' }}>
                <Icon className="h-[19px] w-[19px]" />
                {collapsed && hasCount && (
                  <span
                    style={{ position: 'absolute', top: -3, right: -4, width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', border: '1.5px solid var(--sidebar)' }}
                  />
                )}
              </span>
              {!collapsed && (
                <>
                  {label}
                  <CountBadge value={count} />
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Footer: support card + neutral logout */}
      <div style={{ marginTop: 'auto', paddingTop: 8 }}>
        {!collapsed && (
          <div
            className="flex items-center gap-2.5"
            style={{ border: '1px solid var(--cardborder)', background: 'var(--surface2)', borderRadius: 12, padding: 12, marginBottom: 8 }}
          >
            <HelpCircle className="h-[18px] w-[18px]" style={{ color: 'var(--muted)', flexShrink: 0 }} />
            <div style={{ lineHeight: 1.3 }}>
              <div style={{ color: 'var(--text)', fontWeight: 600, fontSize: 12 }}>Need help?</div>
              <div style={{ color: 'var(--muted)', fontSize: 10 }}>Contact MaxPay support</div>
            </div>
          </div>
        )}
        <button
          onClick={logout}
          className={`tf-nav${collapsed ? ' tf-tip' : ''}`}
          data-tip={collapsed ? 'Sign out' : undefined}
          style={collapsedNavStyle}
        >
          <LogOut className="h-[19px] w-[19px]" />
          {!collapsed && 'Sign out'}
        </button>
      </div>
    </aside>
  );
}
