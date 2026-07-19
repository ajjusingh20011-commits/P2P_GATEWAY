import { useState } from 'react'
import { apiCall } from '../config/api'
import { theme } from '../theme'

// Platform options per connection type. `value` maps to the backend PLATFORMS enum.
const APK_PLATFORMS = [
  { label: 'PhonePe', value: 'phonepe' },
  { label: 'GPay', value: 'gpay' },
  { label: 'BharatPe', value: 'bharatpe' },
  { label: 'Amazon Pay', value: 'amazonpay' },
  { label: 'Other', value: 'other' },
]

const WEB_PLATFORMS = [
  { label: 'Paytm Business', value: 'paytm' },
  { label: 'PhonePe Business', value: 'phonepe' },
  { label: 'BharatPe', value: 'bharatpe' },
  { label: 'Amazon Pay Business', value: 'amazonpay' },
]

const EMPTY = {
  platform: '',
  upiId: '',
  displayName: '',
  loginEmail: '',
  loginPassword: '',
  loginPhone: '',
}

export default function AddAccountModal({ onClose, onCreated }) {
  const [tab, setTab] = useState('apk') // 'apk' | 'web'
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const platforms = tab === 'apk' ? APK_PLATFORMS : WEB_PLATFORMS

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function switchTab(next) {
    setTab(next)
    setForm(EMPTY)
    setError('')
  }

  async function handleSave(e) {
    e.preventDefault()
    setError('')

    if (!form.platform) return setError('Please select a platform.')
    if (!form.upiId.trim()) return setError('UPI ID is required.')
    if (!form.displayName.trim()) return setError('Display name is required.')
    if (tab === 'web') {
      if (!form.loginEmail.trim()) return setError('Login email is required.')
      if (!form.loginPassword) return setError('Login password is required.')
      if (!form.loginPhone.trim()) return setError('Phone number is required.')
    }

    const body =
      tab === 'apk'
        ? {
            type: 'apk',
            platform: form.platform,
            upiId: form.upiId.trim(),
            displayName: form.displayName.trim(),
          }
        : {
            type: 'web',
            platform: form.platform,
            upiId: form.upiId.trim(),
            displayName: form.displayName.trim(),
            loginEmail: form.loginEmail.trim(),
            loginPassword: form.loginPassword,
            loginPhone: form.loginPhone.trim(),
          }

    setSaving(true)
    try {
      const json = await apiCall('/ngo/accounts', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      onCreated(json.data)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(1,4,9,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 500,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 460,
          maxHeight: '90vh',
          overflowY: 'auto',
          background: theme.card,
          border: `1px solid ${theme.border}`,
          borderRadius: 16,
          animation: 'modalIn 0.2s ease',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 20px',
            borderBottom: `1px solid ${theme.border}`,
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 700, color: theme.textPrimary }}>
            Add Payment Detail
          </div>
          <button
            className="icon-btn"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: theme.textSecondary,
              fontSize: 20,
              width: 30,
              height: 30,
              borderRadius: 8,
            }}
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, padding: '16px 20px 0' }}>
          {[
            { id: 'apk', label: 'APK Connection' },
            { id: 'web', label: 'Web Login' },
          ].map((t) => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => switchTab(t.id)}
                className="btn"
                style={{
                  flex: 1,
                  background: active ? theme.accentDim : 'transparent',
                  border: `1px solid ${active ? theme.accentBorder : theme.border}`,
                  color: active ? theme.accent : theme.textSecondary,
                  borderRadius: 10,
                  padding: '10px',
                  fontSize: 13.5,
                  fontWeight: 600,
                }}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Form */}
        <form onSubmit={handleSave} style={{ padding: 20 }}>
          <Field label="Platform">
            <select
              value={form.platform}
              onChange={(e) => set('platform', e.target.value)}
              style={inputStyle}
            >
              <option value="">Select platform…</option>
              {platforms.map((p) => (
                <option key={p.label} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="UPI ID">
            <input
              value={form.upiId}
              onChange={(e) => set('upiId', e.target.value)}
              placeholder={tab === 'apk' ? 'bright@ybl' : '9988776655@paytm'}
              style={inputStyle}
            />
          </Field>

          <Field label="Display Name">
            <input
              value={form.displayName}
              onChange={(e) => set('displayName', e.target.value)}
              placeholder="Bright Future PhonePe"
              style={inputStyle}
            />
          </Field>

          {tab === 'web' && (
            <>
              <Field label="Login Email">
                <input
                  type="email"
                  value={form.loginEmail}
                  onChange={(e) => set('loginEmail', e.target.value)}
                  placeholder="ngo@paytm.com"
                  style={inputStyle}
                />
              </Field>

              <Field label="Login Password">
                <input
                  type="password"
                  value={form.loginPassword}
                  onChange={(e) => set('loginPassword', e.target.value)}
                  placeholder="••••••••"
                  style={inputStyle}
                />
              </Field>

              <Field label="Phone Number">
                <input
                  value={form.loginPhone}
                  onChange={(e) => set('loginPhone', e.target.value)}
                  placeholder="9988776655"
                  style={inputStyle}
                />
              </Field>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12.5,
                  color: theme.success,
                  background: 'rgba(63,185,80,0.08)',
                  border: '1px solid rgba(63,185,80,0.3)',
                  borderRadius: 9,
                  padding: '9px 12px',
                  marginBottom: 16,
                }}
              >
                <LockIcon />
                Credentials are stored with 256-bit encryption. They are never
                returned by the API.
              </div>
            </>
          )}

          {error && (
            <div
              style={{
                background: 'rgba(248,81,73,0.1)',
                border: '1px solid rgba(248,81,73,0.4)',
                color: theme.error,
                borderRadius: 9,
                padding: '10px 12px',
                fontSize: 13,
                marginBottom: 14,
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className="btn"
              onClick={onClose}
              style={{
                flex: 1,
                background: 'transparent',
                border: `1px solid ${theme.border}`,
                color: theme.textSecondary,
                borderRadius: 10,
                padding: '11px',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn"
              disabled={saving}
              style={{
                flex: 2,
                background: theme.accent,
                color: '#00201a',
                border: 'none',
                borderRadius: 10,
                padding: '11px',
                fontSize: 14,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              {saving && (
                <span className="spinner" style={{ width: 15, height: 15, borderWidth: 2 }} />
              )}
              {saving ? 'Saving…' : 'Save Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label
        style={{
          display: 'block',
          fontSize: 12.5,
          color: theme.textSecondary,
          marginBottom: 6,
          fontWeight: 500,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  )
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.success} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

const inputStyle = {
  width: '100%',
  background: theme.bg,
  border: `1px solid ${theme.border}`,
  borderRadius: 10,
  color: theme.textPrimary,
  padding: '11px 12px',
  fontSize: 14,
}
