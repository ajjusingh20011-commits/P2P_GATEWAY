import { NavLink } from 'react-router-dom';
import { HelpCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  IconDashboard,
  IconOrders,
  IconTransactions,
  IconBalance,
  IconKey,
  IconWebhook,
  IconProfile,
  IconLogout,
  IconRupee,
  IconBank,
  IconChart,
} from './icons';

// Labels follow the MaxPay Merchant reference nav (Dashboard/Pay-in/Payout/
// Live Tracker/Balance/Settlements/Reports/API & Webhooks); routes are the
// real app's existing ones, unchanged. Settlements/Reports have no backend
// data source yet, so they're flagged `preview` (see pages/Settlements.jsx,
// pages/Reports.jsx) rather than silently presented as live.
const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: IconDashboard },
  { to: '/orders', label: 'Pay-in', icon: IconOrders, badge: 'ordersPending' },
  { to: '/payouts', label: 'Payout', icon: IconRupee },
  { to: '/transactions', label: 'Live Tracker', icon: IconTransactions },
  { to: '/balance', label: 'Balance', icon: IconBalance },
  { to: '/settlements', label: 'Settlements', icon: IconBank, preview: true },
  { to: '/reports', label: 'Reports', icon: IconChart, preview: true },
  { to: '/api-credentials', label: 'API Credentials', icon: IconKey },
  { to: '/webhooks', label: 'Webhooks', icon: IconWebhook },
  { to: '/profile', label: 'Profile', icon: IconProfile },
];

function CountBadge({ value }) {
  if (value == null || value === 0) return null;
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

/** Small "Preview" tag for nav items that aren't backed by real data yet. */
function PreviewTag() {
  return (
    <span
      className="ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
      style={{ background: 'var(--hover)', color: 'var(--muted)' }}
    >
      Preview
    </span>
  );
}

/**
 * Merchant sidebar (MaxPay visual system). Collapse is controlled from the top
 * header (single collapse control), so this is a presentational component that
 * only reads `collapsed`. Balance is real (from the merchant's dashboard).
 */
export default function Sidebar({ badges = {}, balanceUsdt = null, collapsed = false, mobileOpen = false, onNavigate }) {
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
          style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(145deg,#22c55e,#15803d)', fontSize: 15, boxShadow: '0 7px 20px rgba(34,197,94,.24)' }}
        >
          M
        </span>
        {!collapsed && (
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16 }}>MaxPay</div>
            <div style={{ color: 'var(--muted)', fontSize: 11 }}>Merchant</div>
          </div>
        )}
      </div>

      {/* Settlement balance — real merchant.balance_usdt, fetched once in MerchantLayout */}
      {!collapsed && balanceUsdt != null && (
        <div
          className="mb-3"
          style={{
            padding: 14,
            borderRadius: 14,
            background: 'linear-gradient(145deg, #22c55e, var(--accent))',
            color: '#fff',
          }}
        >
          <p style={{ margin: 0, fontSize: 11, opacity: 0.85 }}>Settlement balance</p>
          <p style={{ margin: '7px 0', fontSize: 20, fontWeight: 700 }}>
            {Number(balanceUsdt).toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}
            <span style={{ fontSize: 11, opacity: 0.8, fontWeight: 500 }}>USDT</span>
          </p>
        </div>
      )}

      {/* Nav */}
      <nav className="tf-scroll mt-2 flex-1 space-y-1 overflow-y-auto overflow-x-hidden">
        {NAV.map(({ to, label, icon: Icon, badge, preview }) => {
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
                  {preview ? <PreviewTag /> : <CountBadge value={count} />}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Support + logout */}
      <div style={{ marginTop: 'auto', paddingTop: 8 }}>
        {!collapsed && (
          <div
            className="mb-2 flex items-center gap-2"
            style={{ border: '1px solid var(--cardborder)', background: 'var(--hover)', borderRadius: 12, padding: 12 }}
          >
            <HelpCircle size={18} style={{ color: 'var(--muted)', flexShrink: 0 }} />
            <div style={{ lineHeight: 1.3 }}>
              <div style={{ color: 'var(--text)', fontSize: 12, fontWeight: 600 }}>Need help?</div>
              <div style={{ color: 'var(--muted)', fontSize: 10 }}>Contact support</div>
            </div>
          </div>
        )}
        <button
          onClick={logout}
          className={`tf-nav${collapsed ? ' tf-tip' : ''}`}
          data-tip={collapsed ? 'Logout' : undefined}
          style={{ color: '#ef4444', ...collapsedNavStyle }}
        >
          <IconLogout className="h-[19px] w-[19px]" />
          {!collapsed && 'Logout'}
        </button>
      </div>
    </aside>
  );
}
