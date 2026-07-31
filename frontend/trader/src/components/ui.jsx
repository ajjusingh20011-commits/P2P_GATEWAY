/**
 * Reusable presentational primitives for the trader panel.
 * Theme-aware: colors are driven by the CSS variables defined on `.tf-scope`
 * in index.css, so every primitive follows the light/dark toggle automatically.
 */
import { useEffect } from 'react';
import { IconSearch, IconChevron, IconX } from './icons';

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

export function Select({ value, onChange, options, disabled = false, className = '' }) {
  return (
    <div className={`relative ${className}`} style={disabled ? { opacity: 0.6 } : undefined}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full appearance-none rounded-xl py-2 pl-3 pr-9 text-sm outline-none focus:ring-2 disabled:cursor-not-allowed"
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

/*
 * Per-provider visual identity for BankBadge. Logo files aren't available
 * yet — every entry renders as a colored initials fallback. To switch one
 * provider over to a real logo later, add a `logo` (image src / data URI) to
 * that entry; nothing else changes.
 */
const BANK_VISUALS = {
  gpay: { initials: 'G', hex: '#4285f4' },
  paytm: { initials: 'P', hex: '#00a7e1' },
  phonepe: { initials: 'Ph', hex: '#5f259f' },
  airtel: { initials: 'A', hex: '#ed1c24' },
  bharat_pe: { initials: 'B', hex: '#8b5cf6' },
};

export function BankBadge({ type, label, size = 28 }) {
  const visual = BANK_VISUALS[type];
  const hex = visual?.hex || accentHex();
  const initials = visual?.initials || (label || type || '?').slice(0, 2).toUpperCase();
  return (
    <span
      title={label || type}
      className="inline-flex flex-shrink-0 items-center justify-center overflow-hidden font-bold"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.32), background: hexA(hex, 0.14), color: hex, fontSize: Math.round(size * 0.4) }}
    >
      {visual?.logo ? (
        <img src={visual.logo} alt={label || type} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      ) : (
        initials
      )}
    </span>
  );
}

const LIVENESS_META = {
  active: { label: 'Active', hex: '#22c55e' },
  resting: { label: 'Resting', hex: '#f59e0b' },
  dead: { label: 'Dead', hex: '#ef4444' },
};

export function LivenessBadge({ state, className = '' }) {
  const m = LIVENESS_META[state] || { label: state || '—', hex: '#94a3b8' };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
      style={{ background: hexA(m.hex, 0.14), color: m.hex }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.hex, flexShrink: 0 }} />
      {m.label}
    </span>
  );
}

/* Placeholder only — no success-score metric is computed anywhere in the
 * backend yet. Renders a neutral dash, never a fabricated number. */
export function ScoreCircle({ size = 40 }) {
  return (
    <span
      title="Coming soon — this metric isn't tracked yet"
      className="inline-flex flex-shrink-0 items-center justify-center font-semibold"
      style={{ width: size, height: size, borderRadius: '50%', border: '2px dashed var(--cardborder)', color: 'var(--muted)', fontSize: Math.round(size * 0.32) }}
    >
      —
    </span>
  );
}

export function EmptyState({ icon: Icon, title = 'Nothing here yet', message, action, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 py-14 text-center ${className}`}>
      {Icon && <Icon className="h-7 w-7" style={{ color: 'var(--muted)' }} />}
      <p style={{ color: 'var(--text)', fontWeight: 600, fontSize: 14, margin: 0 }}>{title}</p>
      {message && <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0, maxWidth: 320 }}>{message}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }) {
  return (
    <p className="py-14 text-center text-sm" style={{ color: 'var(--muted)' }}>
      {label}
    </p>
  );
}

/* Thin table shell: overflow-x wrapper + consistent width, so wide tables
 * never cause the page body to scroll sideways. Column/row markup stays with
 * each page — the data shape differs too much per page for a shared column API. */
export function DataTable({ children, minWidth }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={minWidth ? { minWidth } : undefined}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, align = 'left', className = '' }) {
  return (
    <th
      className={`px-4 py-3 text-xs font-medium uppercase tracking-wide ${className}`}
      style={{ textAlign: align, color: 'var(--muted)', borderBottom: '1px solid var(--cardborder)' }}
    >
      {children}
    </th>
  );
}

/* Shared modal shell — overlay + centered card + optional title/subtitle/footer.
 * Click-outside and Escape both close. Pages own their own body content. */
export function Modal({ open, onClose, title, subtitle, width = 460, children, footer, headerRight }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onMouseDown={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,.5)' }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="tf-card tf-scroll"
        style={{ width, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', padding: 22 }}
      >
        {(title || onClose) && (
          <div className="flex items-center justify-between" style={{ marginBottom: subtitle ? 4 : 14 }}>
            <h3 style={{ fontWeight: 700, fontSize: 17, margin: 0, color: 'var(--text)' }}>{title}</h3>
            <div className="flex items-center gap-1.5">
              {headerRight}
              <button onClick={onClose} className="tf-hbtn" aria-label="Close">
                <IconX className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
        {subtitle && <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 14px' }}>{subtitle}</p>}
        {children}
        {footer && <div style={{ marginTop: 18 }}>{footer}</div>}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 style={{ color: 'var(--text)', fontWeight: 800, fontSize: 28, margin: 0, letterSpacing: '-.8px' }}>{title}</h1>
        {subtitle && <p style={{ color: 'var(--muted)', fontSize: 14, margin: '4px 0 0' }}>{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
