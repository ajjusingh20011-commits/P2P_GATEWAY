import { useNavigate } from 'react-router-dom'
import { theme } from '../theme'
import { PageHeader, Card } from '../components/ui'

export default function Settings() {
  const navigate = useNavigate()
  const user = JSON.parse(localStorage.getItem('user') || 'null') || {}

  function logout() {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    navigate('/login', { replace: true })
  }

  const rows = [
    { label: 'Name', value: user.name || '—' },
    { label: 'Email', value: user.email || '—' },
    { label: 'Role', value: (user.role || '—').replace('_', ' ') },
    { label: 'NGO ID', value: user.ngoId || '—' },
  ]

  return (
    <div>
      <PageHeader title="Settings" subtitle="Your account and session" />

      <Card style={{ maxWidth: 560 }}>
        <div
          style={{
            padding: '16px 20px',
            borderBottom: `1px solid ${theme.border}`,
            fontWeight: 700,
            fontSize: 16,
          }}
        >
          Profile
        </div>
        <div style={{ padding: '8px 20px' }}>
          {rows.map((r) => (
            <div
              key={r.label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '13px 0',
                borderBottom: `1px solid ${theme.border}`,
              }}
            >
              <span style={{ color: theme.textSecondary, fontSize: 13.5 }}>{r.label}</span>
              <span
                style={{
                  color: theme.textPrimary,
                  fontSize: 13.5,
                  fontWeight: 500,
                  textTransform: r.label === 'Role' ? 'capitalize' : 'none',
                  fontFamily: r.label === 'NGO ID' ? 'monospace' : 'inherit',
                }}
              >
                {r.value}
              </span>
            </div>
          ))}
        </div>
        <div style={{ padding: 20 }}>
          <button
            className="btn"
            onClick={logout}
            style={{
              background: 'transparent',
              border: `1px solid ${theme.error}`,
              color: theme.error,
              borderRadius: 10,
              padding: '10px 18px',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Log out
          </button>
        </div>
      </Card>
    </div>
  )
}
