import { useEffect, useState } from 'react';

/**
 * Minimal module-level toast system.
 * Call `toast(message, type)` from anywhere; render <Toaster/> once in the layout.
 */
let listeners = [];
let idSeq = 0;

export function toast(message, type = 'info') {
  const item = { id: ++idSeq, message, type };
  listeners.forEach((fn) => fn(item));
  return item.id;
}

const TYPE_STYLES = {
  info: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
  success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  error: 'border-red-500/40 bg-red-500/10 text-red-200',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
};

export function Toaster({ duration = 4000 }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const add = (item) => {
      setItems((prev) => [...prev, item]);
      setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== item.id));
      }, duration);
    };
    listeners.push(add);
    return () => {
      listeners = listeners.filter((fn) => fn !== add);
    };
  }, [duration]);

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-80 flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-lg backdrop-blur transition ${TYPE_STYLES[t.type] || TYPE_STYLES.info}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
