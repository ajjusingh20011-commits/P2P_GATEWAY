import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info, Copy, Check } from 'lucide-react';

/**
 * The one info-icon-reveals-an-ID interaction used across the trader panel
 * (Notifications' N.ID + real Transaction ID, Sell USDT's T.ID). Single
 * source of truth so the trigger only ever renders ONE tooltip element —
 * the previous per-page copies each stacked a native `title` tooltip *and*
 * a custom click-toggled div on the same button, which is what caused the
 * duplicate/overlapping tooltip bug.
 *
 * Hover opens it automatically (icon bolds as the affordance); click is a
 * fallback for touch, where hover never fires — but if hover already has it
 * open, a click is swallowed instead of toggling a second time, so touch
 * and mouse can never produce two tooltips.
 *
 * The panel renders through a portal into document.body, positioned via the
 * trigger's real getBoundingClientRect() — both table pages that use this
 * (Trades.jsx's tradeLedger, Notifications.jsx's table Card) wrap their rows
 * in an `overflow: hidden` card for rounded corners, which silently clipped
 * an absolutely-positioned-in-place panel on any row near that container's
 * edge (worst on the first row). Escaping to body sidesteps that ancestor
 * clipping entirely instead of chasing overflow tweaks per page.
 *
 * Hover-intent grace zone, both directions:
 *
 * CLOSE — because the panel is portaled, it's no longer a DOM descendant of
 * the trigger, so the cursor unavoidably leaves the trigger's bounds while
 * travelling toward the panel. A close is therefore *scheduled* (short delay)
 * on mouseleave rather than applied immediately, and cancelled if the cursor
 * lands on either the trigger OR the panel before it fires — keeps the
 * tooltip open long enough to actually reach and click its copy button.
 *
 * OPEN — symmetric, and for the same reason the close delay exists: a pointer
 * merely crossing the icon on its way somewhere else is not intent. These
 * triggers sit in dense table rows, so dragging the cursor down a column used
 * to flash a tooltip open for every row it brushed past. The open is now
 * scheduled too, and cancelled if the pointer leaves before it fires, so only
 * a deliberate rest on the icon reveals anything.
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

export default function IdReveal({ value, label, size = 16 }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pos, setPos] = useState(null); // { top, left, openUp } in viewport (fixed) coordinates
  const hoverOpenRef = useRef(false);
  const triggerRef = useRef(null);
  const closeTimerRef = useRef(null);
  const openTimerRef = useRef(null);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
  }, []);

  if (value == null || value === '') return null; // genuinely absent, not just hidden

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
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const openUp = r.top > 140; // enough headroom above; else flip below the trigger
    setPos({
      left: Math.min(Math.max(r.left + r.width / 2, 110), window.innerWidth - 110),
      top: openUp ? r.top - 8 : r.bottom + 8,
      openUp,
    });
  };

  const openPanel = () => { computePos(); setOpen(true); };
  const closePanel = () => setOpen(false); // instant — used for explicit click-to-close only

  const copy = (e) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(String(value)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div
      ref={triggerRef}
      className="idReveal"
      onMouseEnter={() => { cancelClose(); scheduleOpen(); }}
      onMouseLeave={() => { cancelOpen(); hoverOpenRef.current = false; scheduleClose(); }}
    >
      <button
        type="button"
        className="idRevealTrigger"
        aria-label={label ? `${label}: ${value}` : 'Show ID'}
        onClick={(e) => {
          e.stopPropagation();
          cancelClose();
          cancelOpen(); // a real click supersedes any pending hover-open
          if (hoverOpenRef.current) return; // hover already showing it — don't also toggle
          if (open) closePanel(); else openPanel();
        }}
      >
        <Info size={size} />
      </button>
      {open && pos && createPortal(
        <div
          className="idRevealPanel"
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            transform: pos.openUp ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
          }}
        >
          {label && <p className="idRevealLabel">{label}</p>}
          <div className="idRevealInset">
            <span className="idRevealValue">{value}</span>
            <button type="button" className="idRevealCopy" onClick={copy} aria-label="Copy">
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
