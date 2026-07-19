import { useEffect, useState } from 'react';
import { IconX } from './icons';

/**
 * Minimal, dependency-free toast system.
 *
 * Usage:
 *   import { toast, Toaster } from '../components/Toaster';
 *   toast('Saved!', 'success');
 *
 * Render <Toaster /> once, near the app root (TraderLayout).
 */

let listeners = [];
let seq = 0;

/** Fire a toast from anywhere (module-level API). */
export function toast(message, type = 'info') {
  const t = { id: ++seq, message, type };
  listeners.forEach((fn) => fn(t));
}

const STYLES = {
  info: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
  success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  error: 'border-red-500/40 bg-red-500/10 text-red-200',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
};

export function Toaster({ duration = 5000 }) {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const add = (t) => {
      setToasts((prev) => [...prev, t]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, duration);
    };
    listeners.push(add);
    return () => {
      listeners = listeners.filter((fn) => fn !== add);
    };
  }, [duration]);

  const dismiss = (id) => setToasts((prev) => prev.filter((x) => x.id !== id));

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg backdrop-blur ${STYLES[t.type] || STYLES.info}`}
        >
          <span className="flex-1">{t.message}</span>
          <button
            onClick={() => dismiss(t.id)}
            className="text-gray-400 hover:text-white"
            aria-label="Dismiss"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

export default Toaster;
