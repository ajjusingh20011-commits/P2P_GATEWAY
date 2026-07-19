import { useEffect, useState } from 'react'
import { toastBus } from '../lib/bus'
import { theme } from '../theme'

// Global toast stack. Mount once (in Layout). Any code can call
// showToast(message, type) from lib/bus.js to push a notification here.
export default function ToastContainer() {
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    return toastBus.subscribe((toast) => {
      setToasts((prev) => [...prev, toast])
      // Auto-dismiss after 4.5s.
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id))
      }, 4500)
    })
  }, [])

  function dismiss(id) {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  const colors = {
    success: theme.success,
    error: theme.error,
    info: theme.accent,
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 78,
        right: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        zIndex: 1000,
        maxWidth: 340,
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => dismiss(t.id)}
          style={{
            background: theme.card,
            border: `1px solid ${theme.border}`,
            borderLeft: `3px solid ${colors[t.type] || theme.accent}`,
            borderRadius: 10,
            padding: '12px 14px',
            color: theme.textPrimary,
            fontSize: 13.5,
            lineHeight: 1.4,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            cursor: 'pointer',
            animation: 'toastIn 0.25s ease',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: colors[t.type] || theme.accent,
              flexShrink: 0,
            }}
          />
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  )
}
