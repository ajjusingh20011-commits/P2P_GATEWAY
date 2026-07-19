/**
 * Reusable presentational primitives for the trader panel.
 * Theme-aware: colors are driven by the CSS variables defined on `.tf-scope`
 * in index.css, so every primitive follows the light/dark toggle automatically.
 */
import { IconSearch, IconChevron } from './icons';

/* Map a named accent (legacy usage) or a hex string to a hex color. */
const ACCENT_HEX = {
  emerald: '#22c55e',
  green: '#22c55e',
  sky: '#3b82f6',
  blue: '#3b82f6',
  violet: '#8b5cf6',
  purple: '#8b5cf6',
  amber: '#f59e0b',
  teal: '#14b8c4',
  red: '#ef4444',
  gray: '#94a3b8',
};
function accentHex(accent) {
  if (!accent) return ACCENT_HEX.teal;
  return accent[0] === '#' ? accent : ACCENT_HEX[accent] || ACCENT_HEX.teal;
}
/* rgba tint from a hex + alpha. */
function hexA(hex, alpha) {
  const h = accentHex(hex).slice(1);
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function Card({ className = '', children, style }) {
  return (
    <div
      className={`tf-card ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}

export function StatCard({ label, value, sub, icon: Icon, accent = 'teal', index = 0 }) {
  const hex = accentHex(accent);
  return (
    <Card style={{ padding: '20px 22px' }}>
      <div className="flex items-start justify-between">
        <div>
          <p style={{ color: 'var(--muted)', fontWeight: 500, fontSize: 13, margin: '0 0 7px' }}>{label}</p>
          <p style={{ color: 'var(--text)', fontWeight: 800, fontSize: 26, margin: 0, letterSpacing: '-.5px' }}>{value}</p>
          {sub && <p style={{ color: 'var(--muted)', fontSize: 11, margin: '7px 0 0' }}>{sub}</p>}
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
  amber: '#f59e0b', sky: '#3b82f6', blue: '#3b82f6', violet: '#8b5cf6', purple: '#8b5cf6',
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

export function SearchInput({ value, onChange, placeholder = 'Search…', className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--muted)' }} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl py-2 pl-9 pr-3 text-sm outline-none focus:ring-2"
        style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text)' }}
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
        style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text)' }}
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

export function Button({ variant = 'primary', className = '', children, ...props }) {
  const styles = {
    primary: { background: 'var(--accent)', color: '#fff', border: '1px solid transparent' },
    ghost: { background: 'var(--hover)', color: 'var(--text)', border: '1px solid var(--cardborder)' },
    danger: { background: '#ef4444', color: '#fff', border: '1px solid transparent' },
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition disabled:opacity-60 ${className}`}
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
            style={{
              borderColor: isActive ? 'var(--accent)' : 'transparent',
              color: isActive ? 'var(--accent)' : 'var(--muted)',
            }}
          >
            {t.label}
            {t.count != null && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ background: 'var(--hover)', color: 'var(--text)' }}
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
        <button
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="rounded-lg px-3 py-1.5 disabled:opacity-40"
          style={btn}
        >
          Prev
        </button>
        <span className="px-2">
          {page} / {pageCount}
        </span>
        <button
          onClick={() => onPage(Math.min(pageCount, page + 1))}
          disabled={page >= pageCount}
          className="rounded-lg px-3 py-1.5 disabled:opacity-40"
          style={btn}
        >
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
