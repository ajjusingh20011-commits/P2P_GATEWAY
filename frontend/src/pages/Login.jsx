import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiCall, SOCKET_URL } from '../config/api'
import { theme } from '../theme'

export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const json = await apiCall('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      localStorage.setItem('token', json.data.token)
      localStorage.setItem('user', JSON.stringify(json.data.user))
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err.message || 'Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: theme.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 400,
          background: theme.card,
          border: `1px solid ${theme.border}`,
          borderRadius: 16,
          padding: 34,
          boxShadow: '0 16px 48px rgba(0,0,0,0.45)',
        }}
      >
        {/* Brand */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 26,
          }}
        >
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 12,
              background: theme.accent,
              color: '#00201a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: 16,
            }}
          >
            P2P
          </div>
          <div>
            <div style={{ fontSize: 19, fontWeight: 700, color: theme.textPrimary }}>
              NGO Panel
            </div>
            <div style={{ fontSize: 13, color: theme.textSecondary }}>
              Sign in to your dashboard
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@ngo.org"
              required
              style={inputStyle}
            />
          </Field>

          <Field label="Password">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={inputStyle}
            />
          </Field>

          {error && (
            <div
              style={{
                background: 'rgba(248, 81, 73, 0.1)',
                border: `1px solid rgba(248, 81, 73, 0.4)`,
                color: theme.error,
                borderRadius: 9,
                padding: '10px 12px',
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn"
            disabled={loading}
            style={{
              width: '100%',
              background: theme.accent,
              color: '#00201a',
              border: 'none',
              borderRadius: 10,
              padding: '12px',
              fontSize: 15,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
            }}
          >
            {loading && (
              <span
                className="spinner"
                style={{ width: 16, height: 16, borderWidth: 2 }}
              />
            )}
            {loading ? 'Signing in…' : 'Login'}
          </button>
        </form>

        <div
          style={{
            marginTop: 20,
            fontSize: 12,
            color: theme.textSecondary,
            textAlign: 'center',
          }}
        >
          Connects to <span style={{ color: theme.accent }}>{SOCKET_URL.replace(/^https?:\/\//, '')}</span>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label
        style={{
          display: 'block',
          fontSize: 13,
          color: theme.textSecondary,
          marginBottom: 7,
          fontWeight: 500,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  )
}

const inputStyle = {
  width: '100%',
  background: theme.bg,
  border: `1px solid ${theme.border}`,
  borderRadius: 10,
  color: theme.textPrimary,
  padding: '11px 13px',
  fontSize: 14,
}
