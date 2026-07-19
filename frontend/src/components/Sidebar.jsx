import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { theme } from '../theme'
import { activityBus } from '../lib/bus'

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: HomeIcon },
  { to: '/accounts', label: 'Offers & Details', icon: CardIcon },
  { to: '/transactions', label: 'Transactions', icon: ListIcon },
  { to: '/ledger', label: 'Ledger', icon: LinkIcon },
  { to: '/settings', label: 'Settings', icon: GearIcon },
]

export default function Sidebar() {
  const [activity, setActivity] = useState([])

  useEffect(() => {
    return activityBus.subscribe((item) => {
      setActivity((prev) => [item, ...prev].slice(0, 6))
    })
  }, [])

  return (
    <aside
      style={{
        width: 244,
        flexShrink: 0,
        background: theme.bgElevated,
        borderRight: `1px solid ${theme.border}`,
        display: 'flex',
        flexDirection: 'column',
        position: 'sticky',
        top: 0,
        height: '100vh',
      }}
    >
      {/* Brand */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 11,
          padding: '20px 20px 18px',
          borderBottom: `1px solid ${theme.border}`,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 11,
            background: theme.accent,
            color: '#00201a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: 15,
          }}
        >
          P2P
        </div>
        <div style={{ lineHeight: 1.2 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: theme.textPrimary }}>
            NGO Panel
          </div>
          <div style={{ fontSize: 11.5, color: theme.textSecondary }}>
            Donation Gateway
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {NAV.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className="nav-link"
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '11px 13px',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? theme.accent : theme.textSecondary,
                background: isActive ? theme.accentDim : 'transparent',
                border: `1px solid ${isActive ? theme.accentBorder : 'transparent'}`,
              })}
            >
              {({ isActive }) => (
                <>
                  <Icon color={isActive ? theme.accent : theme.textSecondary} />
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          )
        })}
      </nav>

      {/* Live activity feed (fed by raw_event socket messages) */}
      <div
        style={{
          marginTop: 'auto',
          padding: 16,
          borderTop: `1px solid ${theme.border}`,
        }}
      >
        <div
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
            color: theme.textSecondary,
            marginBottom: 10,
            fontWeight: 600,
          }}
        >
          Live Activity
        </div>
        {activity.length === 0 ? (
          <div style={{ fontSize: 12, color: theme.textSecondary }}>
            No recent activity
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activity.map((a) => (
              <div
                key={a.id}
                style={{
                  fontSize: 12,
                  color: theme.textPrimary,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: theme.accent,
                    flexShrink: 0,
                  }}
                />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.category}
                  {a.amount ? ` · ₹${a.amount}` : ''}
                  {a.sender ? ` · ${a.sender}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

/* --- Minimal inline SVG icons (no icon library dependency) --- */
function HomeIcon({ color }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
    </svg>
  )
}
function CardIcon({ color }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  )
}
function ListIcon({ color }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <circle cx="3.5" cy="6" r="1" />
      <circle cx="3.5" cy="12" r="1" />
      <circle cx="3.5" cy="18" r="1" />
    </svg>
  )
}
function LinkIcon({ color }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" />
    </svg>
  )
}
function GearIcon({ color }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15H4.5a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 6 9.4a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 11 4.6h.01A1.65 1.65 0 0 0 12 3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 18 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.01c.36.14.68.36.95.63" />
    </svg>
  )
}
