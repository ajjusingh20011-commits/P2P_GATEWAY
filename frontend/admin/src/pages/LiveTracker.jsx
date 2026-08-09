import { useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Card, Badge, Button, SearchInput, Select, Pagination, PageHeader, InlineLoader } from '../components/ui';
import AdminIdPopover from '../components/AdminIdPopover';
import { adminApi } from '../services/api';
import { inr, usdt } from '../utils/mock';
import { toast } from '../components/toast';

/*
  Admin Live Tracker — Phase 7 of the MaxPay UI/UX migration.

  Scope: the real Order checkout lifecycle (see GET /admin/live-tracker in
  adminController.js). PayoutRequest was deliberately NOT folded into this
  table — it has no real "engine"/"customer action" analogue, and forcing a
  shared row shape would mean inventing values for one side. Payouts already
  have their own real admin view (Payouts.jsx).

  Realtime: this page does NOT open its own socket connection — it reads the
  shared one AdminLayout already owns (one Socket.IO connection per admin
  session, joined to the real `admin` room — see backend/src/websocket/
  index.js) via the Outlet context, and listens for the same `order:update`
  window CustomEvent useSocket.js already re-broadcasts app-wide (the same
  mechanism Orders.jsx uses). On a real event, only the affected row (if
  currently in view) is re-fetched and patched in place — no full-table
  refetch, no synthetic events, no fake events/sec counter, no pause button
  (there is nothing to pause: it's a real subscription, always on).
*/

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', second: '2-digit' });
}
function relativeTime(iso) {
  if (!iso) return 'N/A';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return fmtDateTime(iso);
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m`;
  const day = Math.floor(hr / 24);
  return `${day}d ${hr % 24}h`;
}

const STATUS_META = {
  pending: { color: 'gray', label: 'Pending' },
  checkout_open: { color: 'sky', label: 'Checkout Open' },
  claimed_paid: { color: 'amber', label: 'Claimed Paid' },
  under_review: { color: 'violet', label: 'Under Review' },
  success: { color: 'green', label: 'Success' },
  failed: { color: 'gray', label: 'Failed' },
  rejected: { color: 'red', label: 'Rejected' },
  disputed: { color: 'amber', label: 'Disputed' },
  cancelled: { color: 'gray', label: 'Cancelled' },
};
const statusMeta = (s) => STATUS_META[s] || { color: 'gray', label: s || '—' };

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  ...Object.entries(STATUS_META).map(([value, m]) => ({ value, label: m.label })),
];

const ENGINE_OPTIONS = [
  { value: 'all', label: 'All engines' },
  { value: 'apk_notification', label: 'APK notification' },
  { value: 'scraper', label: 'Web scraper' },
  { value: 'trader_manual', label: 'Trader manual' },
  { value: 'admin_manual', label: 'Admin manual' },
  { value: 'manual', label: 'Legacy manual' },
  { value: 'sms', label: 'Legacy · SMS' },
  { value: 'notification', label: 'Legacy · Notification' },
  { value: 'screen_scraper', label: 'Legacy · Screen scraper' },
  { value: 'null', label: 'Not recorded' },
];
const ENGINE_LABEL = Object.fromEntries(ENGINE_OPTIONS.map((o) => [o.value, o.label]));

const METHOD_OPTIONS = [
  { value: 'all', label: 'All methods' },
  { value: 'gpay', label: 'GPay' },
  { value: 'phonepe', label: 'PhonePe' },
  { value: 'paytm', label: 'Paytm' },
  { value: 'bharat_pe', label: 'BharatPe' },
  { value: 'airtel', label: 'Airtel' },
];

const WINDOW_OPTIONS = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: '24h', label: 'Last 24h' },
  { value: '7d', label: 'Last 7 days' },
];

const PER_PAGE = 20;
// How often a real socket event is allowed to trigger a fresh summary-count
// refetch — bounds DB load under sustained update volume (task: design for
// 60-100 updates/minute) without making the metrics noticeably stale.
const SUMMARY_REFRESH_MIN_INTERVAL_MS = 3000;

export default function LiveTracker() {
  const { connected } = useOutletContext() || {};
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [merchantId, setMerchantId] = useState('all');
  const [traderId, setTraderId] = useState('all');
  const [method, setMethod] = useState('all');
  const [engine, setEngine] = useState('all');
  const [window_, setWindow_] = useState('all');

  const [merchantOptions, setMerchantOptions] = useState([{ value: 'all', label: 'All merchants' }]);
  const [traderOptions, setTraderOptions] = useState([{ value: 'all', label: 'All traders' }]);

  const [flashIds, setFlashIds] = useState(() => new Set());
  const lastSummaryFetch = useRef(0);

  useEffect(() => {
    adminApi.listMerchants({ limit: 100 }).then((data) => {
      setMerchantOptions([{ value: 'all', label: 'All merchants' }, ...(data.merchants || []).map((m) => ({ value: String(m.id), label: m.business_name }))]);
    }).catch(() => {});
    adminApi.listTraders({ limit: 100 }).then((data) => {
      setTraderOptions([{ value: 'all', label: 'All traders' }, ...(data.traders || []).map((t) => ({ value: String(t.id), label: t.user?.email ? t.user.email.split('@')[0] : `trader-${t.id}` }))]);
    }).catch(() => {});
  }, []);

  const buildParams = (pageArg) => {
    const params = { page: pageArg, limit: PER_PAGE };
    if (q.trim()) params.search = q.trim();
    if (status !== 'all') params.status = status;
    if (merchantId !== 'all') params.merchant_id = merchantId;
    if (traderId !== 'all') params.trader_id = traderId;
    if (method !== 'all') params.method = method;
    if (engine !== 'all') params.engine = engine;
    if (window_ !== 'all') params.window = window_;
    return params;
  };

  const load = (pageArg = page) => {
    setLoading(true);
    setError(null);
    adminApi.listLiveTracker(buildParams(pageArg))
      .then((data) => {
        setItems(data.items || []);
        setTotal(data.total || 0);
        setSummary(data.summary || null);
        lastSummaryFetch.current = Date.now();
      })
      .catch((e) => setError(e.response?.data?.message || e.message || 'Could not load live orders.'))
      .finally(() => setLoading(false));
  };

  // Re-fetch whenever a structured filter or the page changes.
  useEffect(() => { load(page); }, [page, status, merchantId, traderId, method, engine, window_]); // eslint-disable-line react-hooks/exhaustive-deps

  // Free-text search debounced separately so it doesn't refetch per keystroke.
  useEffect(() => {
    const id = setTimeout(() => { setPage(1); load(1); }, 350);
    return () => clearTimeout(id);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime: patch the one affected row in place from a real order event.
  // Never inserts a new row or reflows pagination — an order not currently
  // in view is left alone rather than risking a duplicate/out-of-filter row.
  useEffect(() => {
    const onUpdate = async (e) => {
      const orderUuid = e.detail?.order_id || e.detail?.orderId || e.detail?.id;
      if (!orderUuid) return;

      const inView = items.some((it) => it.orderId === orderUuid);
      if (inView) {
        try {
          const fresh = await adminApi.listLiveTracker({ search: orderUuid, limit: 1 });
          const updatedRow = (fresh.items || []).find((it) => it.orderId === orderUuid);
          if (updatedRow) {
            setItems((prev) => prev.map((it) => (it.orderId === orderUuid ? updatedRow : it)));
            setFlashIds((prev) => new Set(prev).add(orderUuid));
            setTimeout(() => setFlashIds((prev) => { const n = new Set(prev); n.delete(orderUuid); return n; }), 1600);
          }
        } catch (_) { /* silent — next filter change or manual refresh will resync */ }
      }

      if (Date.now() - lastSummaryFetch.current > SUMMARY_REFRESH_MIN_INTERVAL_MS) {
        lastSummaryFetch.current = Date.now();
        adminApi.listLiveTracker({ ...buildParams(page), limit: 1 }).then((data) => setSummary(data.summary || null)).catch(() => {});
      }
    };
    window.addEventListener('order:update', onUpdate);
    return () => window.removeEventListener('order:update', onUpdate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, page, status, merchantId, traderId, method, engine, window_]);

  const merchantOpts = useMemo(() => merchantOptions, [merchantOptions]);
  const traderOpts = useMemo(() => traderOptions, [traderOptions]);

  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div>
      <PageHeader
        title="Live Tracker"
        subtitle="Real-time order checkout activity"
        actions={
          <span
            className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold"
            style={{
              border: connected ? '1px solid #abefc6' : '1px solid var(--cardborder)',
              background: connected ? '#ecfdf3' : 'var(--hover)',
              color: connected ? '#067647' : 'var(--muted)',
            }}
            title={connected ? 'Subscribed to the real admin event stream' : 'Realtime disconnected — showing last-loaded data until reconnected'}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: connected ? '#12b76a' : 'var(--muted)' }} />
            {connected ? 'Live' : 'Reconnecting…'}
          </span>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card style={{ padding: '16px 18px' }}>
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 6px' }}>Active checkouts</p>
          <p style={{ color: 'var(--text)', fontWeight: 800, fontSize: 22, margin: 0 }}>{summary ? summary.activeCheckouts : '—'}</p>
        </Card>
        <Card style={{ padding: '16px 18px' }}>
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 6px' }}>Claimed paid</p>
          <p style={{ color: 'var(--text)', fontWeight: 800, fontSize: 22, margin: 0 }}>{summary ? summary.claimedPaid : '—'}</p>
        </Card>
        <Card style={{ padding: '16px 18px' }}>
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 6px' }}>Under review</p>
          <p style={{ color: 'var(--text)', fontWeight: 800, fontSize: 22, margin: 0 }}>{summary ? summary.underReview : '—'}</p>
        </Card>
        <Card style={{ padding: '16px 18px' }}>
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 6px' }}>Completed today</p>
          <p style={{ color: 'var(--text)', fontWeight: 800, fontSize: 22, margin: 0 }}>{summary ? summary.completedToday : '—'}</p>
        </Card>
      </div>

      <Card className="mb-4 flex flex-wrap items-center gap-2.5 p-4">
        <SearchInput value={q} onChange={setQ} placeholder="Order ID, UTR, customer ref…" className="sm:max-w-xs" />
        <Select value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={STATUS_OPTIONS} className="sm:w-44" />
        <Select value={merchantId} onChange={(v) => { setMerchantId(v); setPage(1); }} options={merchantOpts} className="sm:w-48" />
        <Select value={traderId} onChange={(v) => { setTraderId(v); setPage(1); }} options={traderOpts} className="sm:w-44" />
        <Select value={method} onChange={(v) => { setMethod(v); setPage(1); }} options={METHOD_OPTIONS} className="sm:w-40" />
        <Select value={engine} onChange={(v) => { setEngine(v); setPage(1); }} options={ENGINE_OPTIONS} className="sm:w-52" />
        <Select value={window_} onChange={(v) => { setWindow_(v); setPage(1); }} options={WINDOW_OPTIONS} className="sm:w-40" />
        {loading && <InlineLoader />}
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ borderBottom: '1px solid var(--cardborder)', color: 'var(--muted)' }}>
                <th className="w-10 px-3 py-2.5" />
                <th className="px-3 py-2.5 font-medium">Merchant</th>
                <th className="px-3 py-2.5 font-medium">Trader</th>
                <th className="px-3 py-2.5 font-medium">Amount</th>
                <th className="px-3 py-2.5 font-medium">Method</th>
                <th className="px-3 py-2.5 font-medium">Customer Action</th>
                <th className="px-3 py-2.5 font-medium">Engine</th>
                <th className="px-3 py-2.5 font-medium">Time in State</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {error ? (
                <tr><td colSpan={10} className="py-14 text-center text-sm" style={{ color: '#ef4444' }}>{error} — <button className="underline" onClick={() => load()}>retry</button></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={10} className="py-14 text-center text-sm" style={{ color: 'var(--muted)' }}>{loading ? 'Loading…' : 'No orders match this filter.'}</td></tr>
              ) : (
                items.map((r) => {
                  const attention = r.hasDiscrepancy || r.disputeStatus || r.isStaleClaim || r.isReviewOverdue;
                  const flashing = flashIds.has(r.orderId);
                  return (
                    <tr
                      key={r.orderId}
                      className={attention ? 'lt-attentionRow' : ''}
                      style={{ borderTop: '1px solid var(--cardborder)', transition: 'background-color .4s ease', backgroundColor: flashing ? 'rgba(59,130,246,0.08)' : undefined }}
                    >
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <AdminIdPopover rows={[{ label: 'Order ID', value: r.orderId }, { label: 'Numeric ID', value: r.id }, { label: 'Customer Reference', value: r.customerRef }]} />
                      </td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text)' }}>{r.merchantName || '—'}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--muted)' }}>{r.traderName || 'Unassigned'}</td>
                      <td className="px-3 py-2.5">
                        <div style={{ color: 'var(--text)' }}>{inr(r.amountInr)}</div>
                        {r.amountUsdt != null && <div style={{ color: 'var(--muted)', fontSize: 11 }}>{usdt(r.amountUsdt)}</div>}
                      </td>
                      <td className="px-3 py-2.5">{r.method ? <Badge color="sky">{r.method}</Badge> : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--muted)', fontSize: 12.5 }}>{r.customerAction || '—'}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--muted)', fontSize: 12.5 }}>{r.engine ? (ENGINE_LABEL[r.engine] || r.engine) : 'N/A'}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text)', fontSize: 12.5 }}>
                        {relativeTime(r.stateEnteredAt)}
                        {r.isStaleClaim && <span title="Claimed paid 30+ minutes ago" className="ml-1.5"><Badge color="amber">stale</Badge></span>}
                        {r.isReviewOverdue && <span title="Under review 2+ hours" className="ml-1.5"><Badge color="red">overdue</Badge></span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge color={statusMeta(r.status).color}>{statusMeta(r.status).label}</Badge>
                          {r.hasDiscrepancy && <Badge color="red">UTR mismatch</Badge>}
                          {r.disputeStatus && <Badge color="red">dispute</Badge>}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--muted)' }}>{fmtDateTime(r.updatedAt)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div style={{ borderTop: '1px solid var(--cardborder)' }}>
          <div className="flex items-center justify-between px-4 py-3 text-sm" style={{ color: 'var(--muted)' }}>
            <span>{total.toLocaleString()} orders match this filter</span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</Button>
              <span className="px-2">{page} / {pageCount}</span>
              <Button variant="ghost" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </div>
      </Card>

      <style>{`
        .lt-attentionRow { border-left: 3px solid #f04438; }
      `}</style>
    </div>
  );
}
