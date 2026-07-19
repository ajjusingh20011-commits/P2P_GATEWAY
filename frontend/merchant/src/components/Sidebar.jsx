import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
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
} from './icons';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: IconDashboard },
  { to: '/orders', label: 'Orders', icon: IconOrders, badge: 'ordersPending' },
  { to: '/payouts', label: 'Payouts', icon: IconRupee },
  { to: '/transactions', label: 'Transactions', icon: IconTransactions },
  { to: '/balance', label: 'Balance', icon: IconBalance },
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
      style={{ background: 'rgba(139,92,246,.14)', color: '#8b5cf6' }}
    >
      {text}
    </span>
  );
}

export default function Sidebar({ badges = {} }) {
  const { logout } = useAuth();

  // Collapsed/expanded state (allowed new UI state), persisted.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    if (saved != null) setCollapsed(saved === 'true');
  }, []);
  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(collapsed));
  }, [collapsed]);

  const linkClass = ({ isActive }) => `tf-nav${isActive ? ' active' : ''}${collapsed ? ' tf-tip' : ''}`;
  const collapsedNavStyle = collapsed ? { justifyContent: 'center', gap: 0 } : undefined;

  return (
    <aside
      className="flex h-screen flex-shrink-0 flex-col"
      style={{
        width: collapsed ? 72 : 256,
        background: 'var(--sidebar)',
        borderRight: '1px solid var(--cardborder)',
        padding: collapsed ? '16px 10px' : '16px 14px',
        transition: 'width .25s ease, padding .25s ease, background-color .3s',
      }}
    >
      {/* Logo + collapse toggle (toggle stays visible in both states) */}
      {collapsed ? (
        <div className="flex flex-col items-center gap-2" style={{ padding: '0 0 12px' }}>
          <span
            className="flex items-center justify-center font-extrabold text-white"
            style={{ width: 36, height: 36, borderRadius: 11, background: '#8b5cf6', fontSize: 13 }}
          >
            P2P
          </span>
          <button className="tf-hbtn" onClick={() => setCollapsed(false)} aria-label="Expand sidebar" title="Expand">
            <ChevronsRight size={18} />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between" style={{ padding: '4px 6px 14px' }}>
          <div className="flex items-center gap-2.5">
            <span
              className="flex items-center justify-center font-extrabold text-white"
              style={{ width: 36, height: 36, borderRadius: 11, background: '#8b5cf6', fontSize: 13 }}
            >
              P2P
            </span>
            <div style={{ lineHeight: 1.25 }}>
              <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: 15 }}>Merchant Panel</div>
              <div style={{ color: '#8b5cf6', fontSize: 10, fontWeight: 600, letterSpacing: '.5px' }}>PAYMENTS</div>
            </div>
          </div>
          <button className="tf-hbtn" onClick={() => setCollapsed(true)} aria-label="Collapse sidebar" title="Collapse">
            <ChevronsLeft size={18} />
          </button>
        </div>
      )}

      {/* Nav */}
      <nav className="tf-scroll mt-2 flex-1 space-y-1 overflow-y-auto overflow-x-hidden">
        {NAV.map(({ to, label, icon: Icon, badge }) => {
          const count = badge ? badges[badge] : null;
          const hasCount = count != null && count > 0;
          return (
            <NavLink key={to} to={to} className={linkClass} data-tip={collapsed ? label : undefined} style={collapsedNavStyle}>
              <span style={{ position: 'relative', display: 'flex' }}>
                <Icon className="h-[19px] w-[19px]" />
                {collapsed && hasCount && (
                  <span
                    style={{ position: 'absolute', top: -3, right: -4, width: 8, height: 8, borderRadius: '50%', background: '#8b5cf6', border: '1.5px solid var(--sidebar)' }}
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

      {/* Logout */}
      <div style={{ marginTop: 'auto', paddingTop: 8 }}>
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
