import { useEffect, useRef, useState } from 'react';
import { Info, Copy, Check } from 'lucide-react';

/**
 * Admin's ID cell — icon trigger that reveals a small panel of real
 * identifiers for a row (transaction id, merchant order id, customer ref…),
 * each with copy-to-clipboard. Local absolutely-positioned panel (no portal
 * library) since it only ever needs to escape its own table cell, not the
 * whole viewport.
 */
export default function AdminIdPopover({ rows }) {
  const [open, setOpen] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const copy = (value, idx) => {
    navigator.clipboard?.writeText(String(value)).catch(() => {});
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1200);
  };

  const visibleRows = rows.filter((r) => r.value != null && r.value !== '');

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Transaction identifiers"
        className="tf-hbtn"
        style={{ width: 26, height: 26, borderRadius: 8 }}
      >
        <Info size={13} />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1.5 rounded-xl p-2"
          style={{ width: 260, background: 'var(--card)', border: '1px solid var(--accent)', boxShadow: 'var(--shadow)' }}
        >
          {visibleRows.map((row, i) => (
            <div key={row.label} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5" style={{ borderTop: i === 0 ? 'none' : '1px solid var(--cardborder)' }}>
              <div className="min-w-0">
                <p style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.04em', margin: 0 }}>{row.label}</p>
                <p className="truncate font-mono" style={{ color: 'var(--text)', fontSize: 12, margin: '2px 0 0' }}>{row.value}</p>
              </div>
              <button type="button" onClick={() => copy(row.value, i)} aria-label={`Copy ${row.label}`} className="tf-hbtn" style={{ width: 24, height: 24, borderRadius: 7, flexShrink: 0 }}>
                {copiedIdx === i ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
          ))}
          {visibleRows.length === 0 && (
            <p style={{ color: 'var(--muted)', fontSize: 12, padding: '4px 2px' }}>No identifiers available.</p>
          )}
        </div>
      )}
    </div>
  );
}
