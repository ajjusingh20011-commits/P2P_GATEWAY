import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info, Copy, Check } from 'lucide-react';

/**
 * Admin's ID cell — icon trigger that reveals a small panel of real
 * identifiers for a row (transaction id, merchant order id, customer ref…),
 * each with copy-to-clipboard.
 *
 * Interaction matches the trader panel's IdReveal: hover opens it
 * automatically (icon bolds as the cue), click is the touch fallback and is
 * swallowed while hover already has it open — one state, one panel, never
 * two overlapping tooltips. Style also matches IdReveal: a dark rounded
 * card (always dark, independent of the admin panel's own theme), each
 * identifier as a label line + its value in a slightly-lighter inset row
 * with a copy icon on the right.
 *
 * Renders through a portal into document.body, positioned via the trigger's
 * real getBoundingClientRect(), for the same reason as IdReveal: several
 * admin tables (e.g. Traders.jsx) wrap their rows in an `overflow: hidden`
 * card for rounded corners, which clips an absolutely-in-place panel on
 * rows near that container's edge.
 *
 * Hover-intent grace zone, both directions (identical to IdReveal):
 *
 * CLOSE — the panel is portaled, so it's not a DOM descendant of the trigger;
 * the cursor unavoidably leaves the trigger's bounds while travelling toward
 * the panel. A close is *scheduled* on mouseleave (short delay) instead of
 * applied immediately, and cancelled if the cursor lands on either the
 * trigger OR the panel first — otherwise the panel would vanish before a
 * click on its copy button could land.
 *
 * OPEN — symmetric, and for the same reason: a pointer crossing the icon en
 * route elsewhere is not intent. These triggers sit in dense admin tables, so
 * sweeping the cursor down an ID column used to flash a popover open on every
 * row it brushed. The open is scheduled too and cancelled if the pointer
 * leaves first, so only a deliberate rest reveals anything.
 *
 * Click is deliberately NOT delayed — it stays instant, since it's the
 * fallback path on touch devices where hover never fires at all.
 */
// Open and close delays are deliberately NOT the same number — they solve
// different problems. OPEN filters out accidental brushes, so it wants to be
// long enough that only a deliberate rest counts (350ms). CLOSE only has to
// cover the gap the cursor crosses between the trigger and the portaled panel,
// which is a short, fixed travel distance — stretching it just leaves a stale
// panel hanging around after the pointer has clearly left.
const OPEN_DELAY_MS = 400;
const CLOSE_DELAY_MS = 200;

export default function AdminIdPopover({ rows }) {
  const [open, setOpen] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [pos, setPos] = useState(null); // { top, left, openUp } in viewport (fixed) coordinates
  const ref = useRef(null);
  const panelRef = useRef(null);
  const hoverOpenRef = useRef(false);
  const closeTimerRef = useRef(null);
  const openTimerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      const inTrigger = ref.current && ref.current.contains(e.target);
      const inPanel = panelRef.current && panelRef.current.contains(e.target);
      if (!inTrigger && !inPanel) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
  }, []);

  const cancelClose = () => {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => { setOpen(false); hoverOpenRef.current = false; }, CLOSE_DELAY_MS);
  };
  const cancelOpen = () => {
    if (openTimerRef.current) { clearTimeout(openTimerRef.current); openTimerRef.current = null; }
  };
  // hoverOpenRef is only set once the panel has actually been revealed by
  // hover — during the pending window a click must still open instantly
  // rather than be swallowed as "hover already showing it".
  const scheduleOpen = () => {
    cancelOpen();
    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null;
      hoverOpenRef.current = true;
      openPanel();
    }, OPEN_DELAY_MS);
  };

  const computePos = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const openUp = r.top > 220; // enough headroom for the (possibly multi-row) panel; else flip below
    setPos({
      left: Math.min(Math.max(r.left, 8), window.innerWidth - 258),
      top: openUp ? r.top - 6 : r.bottom + 6,
      openUp,
    });
  };

  const openPanel = () => { computePos(); setOpen(true); };
  const closePanel = () => setOpen(false); // instant — used for explicit click-to-close only

  const copy = (value, idx) => {
    navigator.clipboard?.writeText(String(value)).catch(() => {});
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1200);
  };

  const visibleRows = rows.filter((r) => r.value != null && r.value !== '');

  return (
    <div
      ref={ref}
      className="relative"
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={() => { cancelClose(); scheduleOpen(); }}
      onMouseLeave={() => { cancelOpen(); hoverOpenRef.current = false; scheduleClose(); }}
    >
      <button
        type="button"
        onClick={() => {
          cancelClose();
          cancelOpen(); // a real click supersedes any pending hover-open
          if (hoverOpenRef.current) return; // hover already showing it — don't also toggle
          if (open) closePanel(); else openPanel();
        }}
        aria-label="Transaction identifiers"
        className="tf-hbtn"
        style={{ width: 26, height: 26, borderRadius: 8, color: open ? 'var(--text)' : undefined }}
      >
        <Info size={13} />
      </button>
      {open && pos && createPortal(
        <div
          ref={panelRef}
          className="rounded-xl"
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          style={{
            position: 'fixed', top: pos.top, left: pos.left,
            transform: pos.openUp ? 'translateY(-100%)' : 'none',
            width: 250, background: 'rgba(17,24,39,.97)', border: '1px solid rgba(255,255,255,.08)',
            boxShadow: '0 10px 26px rgba(0,0,0,.35)', backdropFilter: 'blur(8px)', padding: '10px 10px 9px',
            display: 'flex', flexDirection: 'column', gap: 8, zIndex: 200,
          }}
        >
          {visibleRows.map((row, i) => (
            <div key={row.label} className="min-w-0">
              <p style={{ margin: '0 0 6px 2px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'rgba(255,255,255,.5)' }}>{row.label}</p>
              <div className="flex items-center justify-between gap-2 rounded-md" style={{ background: 'rgba(255,255,255,.08)', padding: '7px 9px' }}>
                <p className="truncate font-mono" style={{ color: '#fff', fontSize: 12.5, margin: 0, fontWeight: 600 }}>{row.value}</p>
                <button
                  type="button"
                  onClick={() => copy(row.value, i)}
                  aria-label={`Copy ${row.label}`}
                  style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  {copiedIdx === i ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
            </div>
          ))}
          {visibleRows.length === 0 && (
            <p style={{ color: 'rgba(255,255,255,.7)', fontSize: 12, padding: '4px 2px', margin: 0 }}>No identifiers available.</p>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
