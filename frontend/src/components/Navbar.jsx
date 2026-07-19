import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { theme } from '../theme'

// Top navigation bar: live-connection indicator, search, theme toggle,
// user identity, and logout.
export default function Navbar({ connected }) {
  const navigate = useNavigate()
  const [dark, setDark] = useState(true)
  const user = JSON.parse(localStorage.getItem('user') || 'null')
  const email = (user && user.email) || 'unknown@user'
  const role = (user && user.role) || 'ngo_staff'
  const initial = email.charAt(0).toUpperCase()

  function logout() {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    navigate('/login', { replace: true })
  }

  return (
    <header
      style={{
        height: 64,
        flexShrink: 0,
        borderBottom: `1px solid ${theme.border}`,
        background: theme.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 28px',
        position: 'sticky',
        top: 0,
        zIndex: 20,
      }}
    >
      {/* Realtime status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span
          className={connected ? 'live-dot' : ''}
          style={{
            width: 9,
            height: 9,
            borderRadius: '50%',
            background: connected ? theme.success : theme.textSecondary,
            display: 'inline-block',
          }}
        />
        <span
          style={{
            color: connected ? theme.success : theme.textSecondary,
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          {connected ? 'Realtime connected' : 'Connecting…'}
        </span>
      </div>

      {/* Right cluster */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ position: 'relative' }}>
          <span
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              color: theme.textSecondary,
              fontSize: 14,
              pointerEvents: 'none',
            }}
          >
            ⌕
          </span>
          <input
            placeholder="Search here..."
            style={{
              background: theme.card,
              border: `1px solid ${theme.border}`,
              borderRadius: 10,
              color: theme.textPrimary,
              padding: '9px 12px 9px 30px',
              width: 240,
              fontSize: 13.5,
            }}
          />
        </div>

        <button
          className="icon-btn"
          onClick={() => setDark((d) => !d)}
          title="Toggle theme"
          style={{
            background: theme.card,
            border: `1px solid ${theme.border}`,
            borderRadius: 10,
            color: theme.textSecondary,
            width: 38,
            height: 38,
            fontSize: 16,
          }}
        >
          {dark ? '☾' : '☀'}
        </button>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            paddingLeft: 6,
          }}
        >
          <div style={{ textAlign: 'right', lineHeight: 1.25 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: theme.textPrimary }}>
              {email}
            </div>
            <div style={{ fontSize: 12, color: theme.textSecondary, textTransform: 'capitalize' }}>
              {role.replace('_', ' ')}
            </div>
          </div>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              background: theme.accent,
              color: '#00201a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 15,
            }}
          >
            {initial}
          </div>
          <button
            className="icon-btn"
            onClick={logout}
            title="Logout"
            style={{
              background: 'transparent',
              border: `1px solid ${theme.border}`,
              borderRadius: 10,
              color: theme.error,
              width: 38,
              height: 38,
              fontSize: 15,
            }}
          >
            ⎋
          </button>
        </div>
      </div>
    </header>
  )
}
