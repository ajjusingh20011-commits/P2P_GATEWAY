/**
 * Reusable presentational primitives for the Admin Panel.
 * Theme-aware: colors are driven by the CSS variables on `.tf-scope`
 * (index.css), so every primitive follows the light/dark toggle. Admin
 * accent = red, applied with restraint.
 */
import { useEffect } from 'react';
import { IconSearch, IconChevron, IconClose } from './icons';

/* Named accent (legacy) or hex string → hex. */
const ACCENT_HEX = {
  red: '#ef4444',
  rose: '#f43f5e',
  emerald: '#22c55e',
  green: '#22c55e',
  sky: '#3b82f6',
  blue: '#3b82f6',
  violet: '#8b5cf6',
  purple: '#8b5cf6',
  amber: '#f59e0b',
  teal: '#14b8c4',
  gray: '#94a3b8',
};
function accentHex(accent) {
  if (!accent) return ACCENT_HEX.red;
  return accent[0] === '#' ? accent : ACCENT_HEX[accent] || ACCENT_HEX.red;
}
function hexA(hex, alpha) {
  const h = accentHex(hex).slice(1);
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function Card({ className = '', children, style }) {
  return (
    <div className={`tf-card ${className}`} style={style}>
      {children}
    </div>
  );
}

export function StatCard({ label, value, sub, icon: Icon, accent = 'red', trend, index = 0 }) {
  const hex = accentHex(accent);
  return (
    <Card style={{ padding: '20px 22px' }}>
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p style={{ color: 'var(--muted)', fontWeight: 500, fontSize: 13, margin: '0 0 7px' }}>{label}</p>
          <p className="truncate" style={{ color: 'var(--text)', fontWeight: 800, fontSize: 26, margin: 0, letterSpacing: '-.5px' }}>{value}</p>
          {sub && <p style={{ color: 'var(--muted)', fontSize: 11, margin: '7px 0 0' }}>{sub}</p>}
          {trend && (
            <p style={{ marginTop: 5, fontSize: 11, fontWeight: 500, color: trend.up ? '#22c55e' : '#ef4444' }}>
              {trend.up ? '▲' : '▼'} {trend.value}
            </p>
          )}
        </div>
        {Icon && (
          <span
            className="tf-badge"
            style={{
              width: 48, height: 48, borderRadius: 14, display: 'flex', alignItems: 'center',
              justifyContent: 'center', flexShrink: 0, background: hexA(hex, 0.13), color: hex,
              animationDelay: `${index * 0.3}s`,
            }}
          >
            <Icon className="h-[22px] w-[22px]" />
          </span>
        )}
      </div>
    </Card>
  );
}

const BADGE_HEX = {
  green: '#22c55e', emerald: '#22c55e', gray: '#94a3b8', red: '#ef4444',
  amber: '#f59e0b', sky: '#3b82f6', blue: '#3b82f6', violet: '#8b5cf6', purple: '#8b5cf6', rose: '#f43f5e',
};

export function Badge({ color = 'gray', children, className = '' }) {
  const hex = BADGE_HEX[color] || BADGE_HEX.gray;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
      style={{ background: hexA(hex, 0.14), color: hex }}
    >
      {children}
    </span>
  );
}

export function Toggle({ checked, onChange, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className="relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50"
      style={{ background: checked ? 'var(--accent)' : 'var(--hover)' }}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

const inputStyle = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text)' };

export function SearchInput({ value, onChange, placeholder = 'Search…', className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--muted)' }} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl py-2 pl-9 pr-3 text-sm outline-none focus:ring-2"
        style={inputStyle}
      />
    </div>
  );
}

export function Select({ value, onChange, options, className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-xl py-2 pl-3 pr-9 text-sm outline-none focus:ring-2"
        style={inputStyle}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <IconChevron className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--muted)' }} />
    </div>
  );
}

export function Input({ className = '', ...props }) {
  return (
    <input
      className={`w-full rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 ${className}`}
      style={inputStyle}
      {...props}
    />
  );
}

export function Button({ variant = 'primary', size = 'md', className = '', children, ...props }) {
  const styles = {
    primary: { background: 'var(--accent)', color: '#fff', border: '1px solid transparent' },
    ghost: { background: 'var(--hover)', color: 'var(--text)', border: '1px solid var(--cardborder)' },
    danger: { background: '#ef4444', color: '#fff', border: '1px solid transparent' },
    success: { background: '#22c55e', color: '#fff', border: '1px solid transparent' },
    subtle: { background: 'transparent', color: 'var(--muted)', border: '1px solid transparent' },
  };
  const sizes = { sm: 'px-2.5 py-1.5 text-xs', md: 'px-3.5 py-2 text-sm' };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-medium transition disabled:opacity-60 ${sizes[size]} ${className}`}
      style={styles[variant] || styles.primary}
      {...props}
    >
      {children}
    </button>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="flex flex-wrap gap-1" style={{ borderBottom: '1px solid var(--cardborder)' }}>
      {tabs.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className="relative -mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition"
            style={{ borderColor: isActive ? 'var(--accent)' : 'transparent', color: isActive ? 'var(--accent)' : 'var(--muted)' }}
          >
            {t.label}
            {t.count != null && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                style={isActive ? { background: hexA('#ef4444', 0.18), color: '#ef4444' } : { background: 'var(--hover)', color: 'var(--text)' }}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Pagination({ page, perPage, total, onPage }) {
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  const btn = { background: 'var(--hover)', border: '1px solid var(--cardborder)', color: 'var(--text)' };
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm" style={{ color: 'var(--muted)' }}>
      <span>
        Showing {from}–{to} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1} className="rounded-lg px-3 py-1.5 disabled:opacity-40" style={btn}>
          Prev
        </button>
        <span className="px-2">
          {page} / {pageCount}
        </span>
        <button onClick={() => onPage(Math.min(pageCount, page + 1))} disabled={page >= pageCount} className="rounded-lg px-3 py-1.5 disabled:opacity-40" style={btn}>
          Next
        </button>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 style={{ color: 'var(--text)', fontWeight: 800, fontSize: 23, margin: 0, letterSpacing: '-.5px' }}>{title}</h1>
        {subtitle && <p style={{ color: 'var(--muted)', fontSize: 14, margin: '4px 0 0' }}>{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Slide-over / centered modal. Closes on Escape and backdrop click. */
export function Modal({ open, onClose, title, subtitle, children, footer, size = 'lg' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const widths = { md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        className={`relative my-8 w-full ${widths[size]} rounded-2xl`}
        style={{ background: 'var(--card)', border: '1px solid var(--cardborder)', boxShadow: 'var(--shadow)' }}
      >
        <div className="flex items-start justify-between p-5" style={{ borderBottom: '1px solid var(--cardborder)' }}>
          <div>
            <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 18, margin: 0 }}>{title}</h2>
            {subtitle && <p style={{ color: 'var(--muted)', fontSize: 14, margin: '2px 0 0' }}>{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="tf-hbtn"
          >
            <IconClose className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 p-4" style={{ borderTop: '1px solid var(--cardborder)' }}>{footer}</div>}
      </div>
    </div>
  );
}

/** Small labelled key/value pair for detail panels. */
export function Field({ label, children, mono = false }) {
  return (
    <div>
      <p style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</p>
      <p className={mono ? 'font-mono' : ''} style={{ color: 'var(--text)', fontSize: 14, margin: '2px 0 0' }}>{children}</p>
    </div>
  );
}

/** Section wrapper used on Settings and detail modals. */
export function Section({ title, description, children, className = '' }) {
  return (
    <Card className={`p-5 ${className}`}>
      <div className="mb-4">
        <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: 0 }}>{title}</h2>
        {description && <p style={{ color: 'var(--muted)', fontSize: 14, margin: '2px 0 0' }}>{description}</p>}
      </div>
      {children}
    </Card>
  );
}

/** Subtle inline loading indicator (spinner + optional label). */
export function InlineLoader({ label = 'Loading…', className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2 text-xs ${className}`} style={{ color: 'var(--muted)' }}>
      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
      {label}
    </span>
  );
}

/** Reusable empty-state row for tables. */
export function EmptyRow({ colSpan, children = 'No records found' }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>
        {children}
      </td>
    </tr>
  );
}
