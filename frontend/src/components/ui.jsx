import { theme } from '../theme'

export function PageHeader({ title, subtitle, right }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: 24,
        gap: 16,
      }}
    >
      <div>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: theme.textPrimary }}>
          {title}
        </h1>
        {subtitle && (
          <p style={{ margin: '6px 0 0', fontSize: 14.5, color: theme.textSecondary }}>
            {subtitle}
          </p>
        )}
      </div>
      {right}
    </div>
  )
}

export function Card({ children, style }) {
  return (
    <div
      style={{
        background: theme.card,
        border: `1px solid ${theme.border}`,
        borderRadius: 14,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function StatusBadge({ status }) {
  const map = {
    live: { c: theme.success, label: 'Live' },
    paused: { c: theme.textSecondary, label: 'Paused' },
    disconnected: { c: theme.error, label: 'Disconnected' },
    SUCCESS: { c: theme.success, label: 'Success' },
    FAILED: { c: theme.error, label: 'Failed' },
    PENDING: { c: theme.warning, label: 'Pending' },
  }
  const s = map[status] || { c: theme.textSecondary, label: status || '—' }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12.5,
        fontWeight: 600,
        color: s.c,
        background: `${s.c}1f`,
        border: `1px solid ${s.c}55`,
        borderRadius: 20,
        padding: '3px 10px',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.c }} />
      {s.label}
    </span>
  )
}

export function VerifiedBadge() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 12,
        fontWeight: 600,
        color: theme.success,
        background: 'rgba(63,185,80,0.12)',
        border: '1px solid rgba(63,185,80,0.4)',
        borderRadius: 20,
        padding: '3px 9px',
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={theme.success} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      Verified
    </span>
  )
}

export function Spinner({ center }) {
  const el = <span className="spinner" />
  if (!center) return el
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>{el}</div>
  )
}

export function EmptyState({ message }) {
  return (
    <div style={{ textAlign: 'center', padding: 44, color: theme.textSecondary, fontSize: 14 }}>
      {message}
    </div>
  )
}

export function ErrorState({ message }) {
  return (
    <div
      style={{
        margin: 16,
        background: 'rgba(248,81,73,0.1)',
        border: '1px solid rgba(248,81,73,0.4)',
        color: theme.error,
        borderRadius: 10,
        padding: '12px 14px',
        fontSize: 13.5,
      }}
    >
      {message}
    </div>
  )
}

export function Pagination({ page, pages, onChange }) {
  const totalPages = Math.max(pages || 1, 1)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 10,
        padding: '14px 18px',
      }}
    >
      <span style={{ fontSize: 13, color: theme.textSecondary }}>
        Page {page} of {totalPages}
      </span>
      <button
        className="btn"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        style={pagerBtn}
      >
        ‹ Prev
      </button>
      <button
        className="btn"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        style={pagerBtn}
      >
        Next ›
      </button>
    </div>
  )
}

const pagerBtn = {
  background: theme.bg,
  border: `1px solid ${theme.border}`,
  color: theme.textPrimary,
  borderRadius: 8,
  padding: '7px 12px',
  fontSize: 13,
}

// Basic table primitives with consistent header/row styling.
export function Table({ columns, children }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c}
                style={{
                  textAlign: 'left',
                  padding: '13px 18px',
                  fontSize: 12,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  color: theme.textSecondary,
                  fontWeight: 600,
                  borderBottom: `1px solid ${theme.border}`,
                  whiteSpace: 'nowrap',
                }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function Td({ children, style }) {
  return (
    <td
      style={{
        padding: '13px 18px',
        fontSize: 13.5,
        color: theme.textPrimary,
        borderBottom: `1px solid ${theme.border}`,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </td>
  )
}
