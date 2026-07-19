import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { traderApi } from '../services/api';

const SEEN_KEY = 'notif-last-seen-id';

// Extract the notifications array from the real envelope, tolerating the
// offline mock shape (which returns a bare []).
function extractNotifications(res) {
  const d = res?.data?.data;
  if (Array.isArray(d)) return d;
  return Array.isArray(d?.notifications) ? d.notifications : [];
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

export default function NotificationBell({ socket }) {
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
      const res = await traderApi.notifications();
      setItems(extractNotifications(res));
    } catch (e) {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  // Initial fetch + refetch on the existing trader socket events that coincide
  // with new notifications (no dedicated notification channel exists).
  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!socket) return undefined;
    const refetch = () => load();
    socket.on('payment:detected', refetch);
    socket.on('order:confirmed', refetch);
    return () => {
      socket.off('payment:detected', refetch);
      socket.off('order:confirmed', refetch);
    };
  }, [socket]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const unread = items.filter((n) => lastSeenId == null || Number(n.id) > lastSeenId).length;

  const markSeen = () => {
    const maxId = items.reduce((m, n) => Math.max(m, Number(n.id) || 0), 0);
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
            position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 340, maxHeight: 420,
            overflowY: 'auto', background: 'var(--card)', border: '1px solid var(--cardborder)',
            borderRadius: 14, boxShadow: 'var(--shadow)', zIndex: 60,
          }}
        >
          <div className="flex items-center justify-between" style={{ padding: '12px 14px', borderBottom: '1px solid var(--cardborder)' }}>
            <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: 14 }}>Notifications</span>
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>{items.length}</span>
          </div>

          {loading && <p style={{ padding: '18px 14px', color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>Loading…</p>}
          {!loading && error && (
            <p style={{ padding: '18px 14px', color: '#ef4444', fontSize: 13, textAlign: 'center' }}>Couldn’t load notifications.</p>
          )}
          {!loading && !error && items.length === 0 && (
            <p style={{ padding: '24px 14px', color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>No notifications yet.</p>
          )}

          {!loading && !error && items.map((n) => (
            <div key={n.id} style={{ padding: '11px 14px', borderBottom: '1px solid var(--cardborder)' }}>
              <div className="flex items-start justify-between gap-3">
                <p style={{ color: 'var(--text)', fontSize: 13, fontWeight: 500, margin: 0, flex: 1, minWidth: 0 }}>
                  {n.description || n.payment_method || 'Payment notification'}
                </p>
                {n.amount != null && (
                  <span style={{ color: '#14b8c4', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {(n.currency || 'INR')} {n.amount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2" style={{ marginTop: 3 }}>
                {n.transaction_id && (
                  <span style={{ color: 'var(--muted)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 170 }}>
                    {n.transaction_id}
                  </span>
                )}
                <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 'auto' }}>{timeAgo(n.created_at || n.received_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
