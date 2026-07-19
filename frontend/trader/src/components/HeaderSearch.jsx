import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { traderApi } from '../services/api';

// Tolerant extraction (real envelope OR offline-mock bare []).
function pick(res, key) {
  const d = res?.data?.data;
  if (Array.isArray(d)) return d;
  return Array.isArray(d?.[key]) ? d[key] : [];
}

const has = (v, q) => String(v ?? '').toLowerCase().includes(q);

export default function HeaderSearch() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [orders, setOrders] = useState([]);
  const [details, setDetails] = useState([]);
  const wrapRef = useRef(null);

  // Load the trader's own orders + payment details (real endpoints), then
  // filter locally. Called on first focus and on Enter (force refresh).
  const load = async (force = false) => {
    if (loaded && !force) return;
    setLoading(true);
    setError(false);
    try {
      const [ordersRes, detailsRes] = await Promise.all([
        traderApi.orders(),
        traderApi.paymentDetails(),
      ]);
      setOrders(pick(ordersRes, 'orders'));
      setDetails(pick(detailsRes, 'payment_details'));
      setLoaded(true);
    } catch (e) {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  // Debounce the query (300ms).
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim().toLowerCase()), 300);
    return () => clearTimeout(id);
  }, [q]);

  // Close on outside click.
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
    return orders
      .filter((o) =>
        has(o.order_id, debounced) ||
        has(o.amount_inr, debounced) ||
        has(o.status, debounced) ||
        has(o.upi_ref_id, debounced) ||
        has(o.customer_ref, debounced) ||
        has(o.paymentDetail?.upi_id, debounced)
      )
      .slice(0, 8);
  }, [orders, debounced]);

  const detailMatches = useMemo(() => {
    if (!debounced) return [];
    return details
      .filter((d) =>
        has(d.account_name, debounced) ||
        has(d.upi_id, debounced) ||
        has(d.account_type, debounced)
      )
      .slice(0, 8);
  }, [details, debounced]);

  const total = orderMatches.length + detailMatches.length;
  const showDropdown = open && debounced.length > 0;

  const rowStyle = { padding: '9px 14px', borderBottom: '1px solid var(--cardborder)' };
  const short = (uuid) => String(uuid || '').split('-')[0].toUpperCase();

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
            position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 360, maxHeight: 440,
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
              <p style={{ padding: '9px 14px 4px', color: 'var(--muted)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>Orders</p>
              {orderMatches.map((o) => (
                <div key={o.order_id || o.id} style={rowStyle}>
                  <div className="flex items-center justify-between gap-3">
                    <span style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600 }}>#{short(o.order_id)}</span>
                    <span style={{ color: '#14b8c4', fontSize: 13, fontWeight: 700 }}>₹{o.amount_inr}</span>
                  </div>
                  <div className="flex items-center gap-2" style={{ marginTop: 2 }}>
                    <span style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'capitalize' }}>{o.status}</span>
                    {o.paymentDetail?.upi_id && (
                      <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 190 }}>
                        {o.paymentDetail.upi_id}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}

          {!loading && !error && detailMatches.length > 0 && (
            <>
              <p style={{ padding: '9px 14px 4px', color: 'var(--muted)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>Payment details</p>
              {detailMatches.map((d) => (
                <div key={d.id} style={rowStyle}>
                  <div className="flex items-center justify-between gap-3">
                    <span style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.account_name}</span>
                    {d.account_type && <span style={{ color: 'var(--muted)', fontSize: 11 }}>{d.account_type}</span>}
                  </div>
                  <p style={{ color: 'var(--muted)', fontSize: 11, margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.upi_id}</p>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
