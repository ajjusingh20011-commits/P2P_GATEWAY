import { useEffect, useMemo, useState } from 'react';
import { Check, ExternalLink } from 'lucide-react';
import { SearchInput } from './ui';
import { IconPhone, IconPlus } from './icons';
import { getDevices } from '../lib/ngoApi';

/**
 * The paired-smartphone picker.
 *
 * Extracted from the Add Payment Detail wizard so the same control can be
 * reused when linking a device to an EXISTING account — previously that path
 * just navigated to the Smartphones page, which showed the trader their
 * devices but gave them no way to attach one to the account they were looking
 * at, and no route back.
 *
 * Behaviour carried over verbatim: search once the list is long enough to need
 * it, online devices first (nearly always what the trader is reaching for),
 * capped scroll height, device name as the primary text, and a secondary line
 * that only shows the model when it actually distinguishes one row from
 * another.
 */

// Below this the list is short enough to scan directly; a search box would
// just be another thing to skip past.
const SEARCH_THRESHOLD = 3;

export const deviceLabel = (dev) => dev.deviceName || dev.deviceModel || 'Unnamed device';

export default function DevicePicker({
  devices,
  loading,
  selectedId,
  onSelect,
  onPairNew,
  emptyMessage = 'No paired devices yet.',
  maxHeight = 260,
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? devices.filter((d) => `${d.deviceName || ''} ${d.deviceModel || ''}`.toLowerCase().includes(q))
      : devices;
    return [...matched].sort((a, b) => (b.online === true) - (a.online === true));
  }, [devices, query]);

  // A secondary line repeating the same value on every row is pure noise — it
  // costs a line of height per device and distinguishes nothing.
  const modelVaries = useMemo(() => {
    const models = new Set(devices.map((d) => (d.deviceModel || '').trim()).filter(Boolean));
    return models.size > 1;
  }, [devices]);

  const showSearch = devices.length > SEARCH_THRESHOLD;

  return (
    <div>
      {showSearch && !loading && (
        <div className="mb-2">
          <SearchInput value={query} onChange={setQuery} placeholder={`Search ${devices.length} devices by name…`} />
        </div>
      )}

      {/* Capped so a long list scrolls inside the step/modal rather than
          pushing the surrounding controls out of reach. */}
      <div className="space-y-1.5" style={showSearch ? { maxHeight, overflowY: 'auto' } : undefined}>
        {loading && <p className="text-xs" style={{ color: 'var(--muted)' }}>Loading devices…</p>}

        {!loading && filtered.map((dev) => {
          const selected = String(selectedId || '') === String(dev.id);
          return (
            <button
              key={dev.id}
              type="button"
              onClick={() => onSelect(String(dev.id))}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition"
              style={{
                border: selected ? '1px solid rgba(34,197,94,.5)' : '1px solid var(--cardborder)',
                background: selected ? 'rgba(34,197,94,.06)' : 'transparent',
              }}
            >
              <span
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
                style={dev.online
                  ? { background: 'rgba(34,197,94,.14)', color: '#22c55e' }
                  : { background: 'rgba(239,68,68,.14)', color: '#ef4444' }}
              >
                <IconPhone className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold" style={{ color: 'var(--text)' }}>{deviceLabel(dev)}</p>
                <p className="truncate text-[11px]" style={{ color: dev.online ? '#22c55e' : 'var(--subtle)' }}>
                  {dev.online ? 'Online' : 'Offline'}
                  {modelVaries && dev.deviceModel ? ` · ${dev.deviceModel}` : ''}
                </p>
              </div>
              {selected && <Check className="h-4 w-4 flex-shrink-0" style={{ color: '#22c55e' }} />}
            </button>
          );
        })}

        {!loading && devices.length > 0 && filtered.length === 0 && (
          <p className="py-3 text-center text-xs" style={{ color: 'var(--muted)' }}>No devices match “{query}”.</p>
        )}
        {!loading && devices.length === 0 && (
          <p className="rounded-lg px-3 py-2.5 text-xs" style={{ border: '1px dashed var(--cardborder)', color: 'var(--muted)' }}>
            {emptyMessage}
          </p>
        )}
      </div>

      {onPairNew && (
        <button
          type="button"
          onClick={onPairNew}
          className="mt-2 flex items-center gap-1.5 text-xs font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          <IconPlus className="h-3.5 w-3.5" /> Pair a new smartphone <ExternalLink className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

/** Shared loader so both call sites read the same real device list. */
export function useDevices() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getDevices()
      .then((list) => { if (!cancelled) setDevices(list || []); })
      .catch(() => { if (!cancelled) setDevices([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  return { devices, loading, reload: () => setReloadKey((k) => k + 1) };
}
