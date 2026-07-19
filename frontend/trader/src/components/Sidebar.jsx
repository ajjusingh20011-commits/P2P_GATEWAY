import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronsLeft, ChevronsRight, Wallet } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Toggle } from './ui';
import { usdt } from '../utils/mock';
import {
  IconDashboard,
  IconSell,
  IconDetails,
  IconBuy,
  IconBell,
  IconPhone,
  IconDownload,
  IconSettings,
  IconLogout,
  IconActivity,
} from './icons';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: IconDashboard },
  { to: '/trades', label: 'Sell USDT', icon: IconSell },
  { to: '/offers', label: 'Details', icon: IconDetails },
  { to: '/buy-usdt', label: 'Buy USDT', icon: IconBuy, badge: 'buyUsdt' },
  { to: '/notifications', label: 'Notifications', icon: IconBell, badge: 'notifications' },
  { to: '/smartphones', label: 'Smartphones', icon: IconPhone, badge: 'smartphones' },
  { to: '/downloads', label: 'Downloads', icon: IconDownload, disabled: true },
  { to: '/settings', label: 'Settings', icon: IconSettings },
];

function CountBadge({ value }) {
  if (value == null) return null;
  const text = value > 99 ? '99+' : String(value);
  return (
    <span
      className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: 'rgba(34,197,94,.14)', color: '#22c55e' }}
    >
      {text}
    </span>
  );
}

export default function Sidebar({ balance, online, onToggleOnline, badges = {} }) {
  const { logout } = useAuth();

  // Collapsed/expanded state (this feature's allowed new state), persisted.
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
            style={{ width: 36, height: 36, borderRadius: 11, background: '#10b981', fontSize: 13 }}
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
              style={{ width: 36, height: 36, borderRadius: 11, background: '#10b981', fontSize: 13 }}
            >
              P2P
            </span>
            <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: 15 }}>Trader Panel</span>
          </div>
          <button className="tf-hbtn" onClick={() => setCollapsed(true)} aria-label="Collapse sidebar" title="Collapse">
            <ChevronsLeft size={18} />
          </button>
        </div>
      )}

      {/* Balance — full card expanded, compact icon badge collapsed */}
      {collapsed ? (
        <div className="tf-tip flex justify-center" data-tip={`Balance ${usdt(balance)}`} style={{ marginBottom: 8 }}>
          <span
            className="flex items-center justify-center"
            style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(20,184,196,.13)', color: '#0f766e' }}
          >
            <Wallet size={19} />
          </span>
        </div>
      ) : (
        <div style={{ borderRadius: 16, padding: 15, marginBottom: 8, background: 'linear-gradient(135deg,#d5f5ef,#c2f0e6)' }}>
          <p style={{ color: '#0d9488', fontWeight: 500, fontSize: 12, margin: '0 0 4px', opacity: 0.85 }}>Total Balance</p>
          <p style={{ color: '#0f766e', fontWeight: 800, fontSize: 19, margin: 0 }}>{usdt(balance)}</p>
        </div>
      )}

      {/* Activity — full toggle expanded, status icon collapsed */}
      {collapsed ? (
        <div className="tf-tip flex justify-center" data-tip={online ? 'Online' : 'Offline'} style={{ padding: '9px 0', marginBottom: 4 }}>
          <IconActivity className="h-[18px] w-[18px]" style={{ color: online ? '#14b8c4' : 'var(--muted)' }} />
        </div>
      ) : (
        <div className="flex items-center justify-between" style={{ padding: '9px 14px', marginBottom: 4 }}>
          <span className="flex items-center gap-2" style={{ color: 'var(--muted)', fontSize: 13, fontWeight: 500 }}>
            <IconActivity className="h-4 w-4" />
            Activity
          </span>
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 12, fontWeight: 500, color: online ? '#14b8c4' : 'var(--muted)' }}>
              {online ? 'Online' : 'Offline'}
            </span>
            <Toggle checked={online} onChange={onToggleOnline} />
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="tf-scroll mt-2 flex-1 space-y-1 overflow-y-auto overflow-x-hidden">
        {NAV.map(({ to, label, icon: Icon, badge, disabled }) => {
          const count = badge ? badges[badge] : null;
          const hasCount = count != null && count > 0;
          return disabled ? (
            <span
              key={to}
              className={`tf-nav${collapsed ? ' tf-tip' : ''}`}
              data-tip={collapsed ? label : undefined}
              style={{ cursor: 'not-allowed', opacity: 0.5, ...collapsedNavStyle }}
            >
              <span style={{ position: 'relative', display: 'flex' }}>
                <Icon className="h-[19px] w-[19px]" />
              </span>
              {!collapsed && (
                <>
                  {label}
                  <span className="ml-auto text-[10px] uppercase tracking-wide">soon</span>
                </>
              )}
            </span>
          ) : (
            <NavLink key={to} to={to} className={linkClass} data-tip={collapsed ? label : undefined} style={collapsedNavStyle}>
              <span style={{ position: 'relative', display: 'flex' }}>
                <Icon className="h-[19px] w-[19px]" />
                {collapsed && hasCount && (
                  <span
                    style={{ position: 'absolute', top: -3, right: -4, width: 8, height: 8, borderRadius: '50%', background: '#22c55e', border: '1.5px solid var(--sidebar)' }}
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
