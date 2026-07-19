import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { adminApi } from '../services/api';

// adminApi.* returns already-unwrapped data ({ orders }, { traders }, { merchants }).
function pick(data, key) {
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.[key]) ? data[key] : [];
}

const has = (v, q) => String(v ?? '').toLowerCase().includes(q);
const short = (uuid, id) => (uuid ? String(uuid).split('-')[0].toUpperCase() : `#${id}`);

export default function HeaderSearch() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [orders, setOrders] = useState([]);
  const [traders, setTraders] = useState([]);
  const [merchants, setMerchants] = useState([]);
  const wrapRef = useRef(null);

  // Load real admin lists once (on first focus) or on Enter (force refresh).
  const load = async (force = false) => {
    if (loaded && !force) return;
    setLoading(true);
    setError(false);
    try {
      const [o, t, m] = await Promise.all([
        adminApi.listOrders({ limit: 100 }),
        adminApi.listTraders({ limit: 100 }),
        adminApi.listMerchants({ limit: 100 }),
      ]);
      setOrders(pick(o, 'orders'));
      setTraders(pick(t, 'traders'));
      setMerchants(pick(m, 'merchants'));
      setLoaded(true);
    } catch (e) {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim().toLowerCase()), 300);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const orderMatches = useMemo(() => {
    if (!debounced) return [];
    return orders.filter((o) =>
      has(o.uuid, debounced) || has(o.id, debounced) || has(o.amount_inr, debounced) ||
      has(o.status, debounced) || has(o.upi_ref_id, debounced) || has(o.customer_ref, debounced) ||
      has(o.merchant?.business_name, debounced)
    ).slice(0, 6);
  }, [orders, debounced]);

  const traderMatches = useMemo(() => {
    if (!debounced) return [];
    return traders.filter((t) =>
      has(t.id, debounced) || has(t.user?.email, debounced)
    ).slice(0, 6);
  }, [traders, debounced]);

  const merchantMatches = useMemo(() => {
    if (!debounced) return [];
    return merchants.filter((m) =>
      has(m.id, debounced) || has(m.business_name, debounced) || has(m.user?.email, debounced)
    ).slice(0, 6);
  }, [merchants, debounced]);

  const total = orderMatches.length + traderMatches.length + merchantMatches.length;
  const showDropdown = open && debounced.length > 0;
  const rowStyle = { padding: '9px 14px', borderBottom: '1px solid var(--cardborder)' };
  const groupStyle = { padding: '9px 14px 4px', color: 'var(--muted)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div
        className="flex items-center gap-2"
        style={{ background: 'var(--hover)', borderRadius: 11, padding: '8px 13px', color: 'var(--muted)', fontSize: 13, minWidth: 200 }}
      >
        <Search size={16} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => { setOpen(true); load(); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { setDebounced(q.trim().toLowerCase()); load(true); } }}
          placeholder="Search here..."
          style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 13, width: '100%' }}
        />
      </div>

      {showDropdown && (
        <div
          className="tf-scroll"
          style={{
            position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 380, maxHeight: 460,
            overflowY: 'auto', background: 'var(--card)', border: '1px solid var(--cardborder)',
            borderRadius: 14, boxShadow: 'var(--shadow)', zIndex: 60,
          }}
        >
          {loading && <p style={{ padding: '18px 14px', color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>Searching…</p>}
          {!loading && error && (
            <p style={{ padding: '18px 14px', color: '#ef4444', fontSize: 13, textAlign: 'center' }}>Couldn’t search right now.</p>
          )}
          {!loading && !error && total === 0 && (
            <p style={{ padding: '24px 14px', color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>No results found</p>
          )}

          {!loading && !error && orderMatches.length > 0 && (
            <>
              <p style={groupStyle}>Orders</p>
              {orderMatches.map((o) => (
                <div key={o.id} style={rowStyle}>
                  <div className="flex items-center justify-between gap-3">
                    <span style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600 }}>#{short(o.uuid, o.id)}</span>
                    <span style={{ color: '#14b8c4', fontSize: 13, fontWeight: 700 }}>₹{o.amount_inr}</span>
                  </div>
                  <div className="flex items-center gap-2" style={{ marginTop: 2 }}>
                    <span style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'capitalize' }}>{o.status}</span>
                    {o.merchant?.business_name && (
                      <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
                        {o.merchant.business_name}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}

          {!loading && !error && traderMatches.length > 0 && (
            <>
              <p style={groupStyle}>Traders</p>
              {traderMatches.map((t) => (
                <div key={t.id} style={rowStyle}>
                  <div className="flex items-center justify-between gap-3">
                    <span style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600 }}>#{t.id}</span>
                    <span style={{ color: 'var(--muted)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{t.user?.email}</span>
                  </div>
                </div>
              ))}
            </>
          )}

          {!loading && !error && merchantMatches.length > 0 && (
            <>
              <p style={groupStyle}>Merchants</p>
              {merchantMatches.map((m) => (
                <div key={m.id} style={rowStyle}>
                  <div className="flex items-center justify-between gap-3">
                    <span style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.business_name || `#${m.id}`}</span>
                    {m.user?.email && <span style={{ color: 'var(--muted)', fontSize: 11 }}>{m.user.email}</span>}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
