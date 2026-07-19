import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { merchantApi } from '../services/api';

const SEEN_KEY = 'merchant-notif-last-seen-id';

// merchantApi.orders() resolves to an axios response; unwrap { orders }.
function extractOrders(res) {
  const d = res?.data?.data;
  if (Array.isArray(d)) return d;
  return Array.isArray(d?.orders) ? d.orders : [];
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return '';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

const STATUS_HEX = {
  confirmed: '#22c55e', paid: '#3b82f6', assigned: '#f59e0b',
  disputed: '#ef4444', cancelled: '#94a3b8', expired: '#94a3b8', new: '#8b5cf6',
};
const short = (uuid, id) => (uuid ? String(uuid).split('-')[0].toUpperCase() : `#${id}`);

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [lastSeenId, setLastSeenId] = useState(() => {
    const v = localStorage.getItem(SEEN_KEY);
    return v != null ? Number(v) : null;
  });
  const wrapRef = useRef(null);

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await merchantApi.orders();
      setItems(extractOrders(res));
    } catch (e) {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  // Initial fetch + refresh whenever useSocket re-broadcasts an order event.
  useEffect(() => {
    load();
    const onUpdate = () => load();
    window.addEventListener('order:update', onUpdate);
    return () => window.removeEventListener('order:update', onUpdate);
  }, []);

  // Close on outside click.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const unread = items.filter((o) => lastSeenId == null || Number(o.id) > lastSeenId).length;

  const markSeen = () => {
    const maxId = items.reduce((m, o) => Math.max(m, Number(o.id) || 0), 0);
    if (maxId > 0 && maxId !== lastSeenId) {
      setLastSeenId(maxId);
      localStorage.setItem(SEEN_KEY, String(maxId));
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) markSeen();
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button className="tf-hbtn" aria-label="Notifications" onClick={toggle}>
        <Bell size={18} />
        {unread > 0 && (
          <span
            style={{
              position: 'absolute', top: 3, right: 3, minWidth: 15, height: 15, padding: '0 4px',
              borderRadius: 99, background: '#ef4444', color: '#fff', fontSize: 9, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
            }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="tf-scroll"
          style={{
            position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 360, maxHeight: 440,
            overflowY: 'auto', background: 'var(--card)', border: '1px solid var(--cardborder)',
            borderRadius: 14, boxShadow: 'var(--shadow)', zIndex: 60,
          }}
        >
          <div className="flex items-center justify-between" style={{ padding: '12px 14px', borderBottom: '1px solid var(--cardborder)' }}>
            <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: 14 }}>Recent activity</span>
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>{items.length}</span>
          </div>

          {loading && <p style={{ padding: '18px 14px', color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>Loading…</p>}
          {!loading && error && (
            <p style={{ padding: '18px 14px', color: '#ef4444', fontSize: 13, textAlign: 'center' }}>Couldn’t load activity.</p>
          )}
          {!loading && !error && items.length === 0 && (
            <p style={{ padding: '24px 14px', color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>No recent activity.</p>
          )}

          {!loading && !error && items.map((o) => (
            <div key={o.id} style={{ padding: '11px 14px', borderBottom: '1px solid var(--cardborder)' }}>
              <div className="flex items-center justify-between gap-3">
                <span style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600 }}>Order {short(o.uuid, o.id)}</span>
                <span style={{ color: '#8b5cf6', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>₹{o.amount_inr}</span>
              </div>
              <div className="flex items-center gap-2" style={{ marginTop: 3 }}>
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'capitalize', color: STATUS_HEX[o.status] || 'var(--muted)' }}>{o.status}</span>
                <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 'auto' }}>{timeAgo(o.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
