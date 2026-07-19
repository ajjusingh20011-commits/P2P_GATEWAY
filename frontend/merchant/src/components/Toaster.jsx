import { useEffect, useState } from 'react';
import { IconCheck, IconClose } from './icons';

/**
 * Minimal, dependency-free toast system.
 *
 * Usage:
 *   import { toast, Toaster } from './Toaster';
 *   toast('Saved', 'success');       // call from anywhere (module-level)
 *   <Toaster />                       // render once near the app root
 */

let counter = 0;
const listeners = new Set();

// Module-level API — safe to import and call from non-React code.
export function toast(message, type = 'info') {
  const item = { id: ++counter, message, type };
  listeners.forEach((fn) => fn(item));
  return item.id;
}

const TYPE_STYLES = {
  success: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
  warning: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
  error: 'border-red-500/40 bg-red-500/15 text-red-200',
  info: 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200',
};

export function Toaster({ duration = 4000 }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const add = (item) => {
      setItems((list) => [...list, item]);
      setTimeout(() => {
        setItems((list) => list.filter((t) => t.id !== item.id));
      }, duration);
    };
    listeners.add(add);
    return () => listeners.delete(add);
  }, [duration]);

  const dismiss = (id) => setItems((list) => list.filter((t) => t.id !== id));

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg backdrop-blur ${
            TYPE_STYLES[t.type] || TYPE_STYLES.info
          }`}
        >
          {t.type === 'success' && <IconCheck className="mt-0.5 h-4 w-4 flex-shrink-0" />}
          <span className="min-w-0 flex-1 break-words">{t.message}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="flex-shrink-0 opacity-60 transition-opacity hover:opacity-100"
            aria-label="Dismiss"
          >
            <IconClose className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

export default Toaster;
