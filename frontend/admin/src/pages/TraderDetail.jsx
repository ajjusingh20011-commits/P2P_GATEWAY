import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Wallet, Activity, Users, Smartphone as SmartphoneIcon, Gauge } from 'lucide-react';
import { Card, Badge, Button, Select, Segments, Modal, Field, Input, InlineLoader, Pagination } from '../components/ui';
import AdminIdPopover from '../components/AdminIdPopover';
import ConfirmModal from '../components/ConfirmModal';
import { adminApi } from '../services/api';
import { inr, usdt, compactInr, pct } from '../utils/mock';
import { toast } from '../components/toast';

/*
  Admin Trader Detail — Phase 5 of the MaxPay UI/UX migration.

  Real backend integration against the endpoints added in
  backend/src/controllers/adminController.js:
    GET  /admin/traders/:id                 header + top summary + Overview
                                             + Payment Accounts + Devices +
                                             Merchant Routing
    GET  /admin/traders/:id/balance-logs    Balance History tab (paginated)
    GET  /admin/traders/:id/activity        Transaction Activity chart
    GET  /admin/orders?trader_id=           Orders tab (reused, not new)
    GET  /admin/disputes?trader_id=         Disputes tab (reused, not new)
  Mutations reuse the pre-existing endpoints Traders.jsx already used:
    PUT  /admin/traders/:id/balance
    PUT  /admin/traders/:id/commission
    PUT  /admin/traders/:id/suspend

  See adminController.js's "TRADER DETAIL" section for the full real-field
  mapping and the honest gaps (BalanceLog's `commission` type is never
  written; the Smartphone/device table is architecturally superseded by
  ngo-backend's real device pairing, so is realistically near-empty).
*/

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });
}
function relativeTime(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return fmtDateTime(iso);
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return fmtDate(iso);
}

const ORDER_STATUS_META = {
  pending: { color: 'gray', label: 'Pending' },
  checkout_open: { color: 'sky', label: 'Checkout Open' },
  claimed_paid: { color: 'amber', label: 'Claimed Paid' },
  under_review: { color: 'violet', label: 'Under Review' },
  success: { color: 'green', label: 'Success' },
  failed: { color: 'gray', label: 'Failed' },
  rejected: { color: 'red', label: 'Rejected' },
  disputed: { color: 'amber', label: 'Disputed' },
};
const orderStatusMeta = (s) => ORDER_STATUS_META[s] || { color: 'gray', label: s || '—' };

/* -------------------------- Transaction Activity chart -------------------------- */
const RANGE_OPTIONS = [
  { value: '1H', label: '1H' },
  { value: '1D', label: '1D' },
  { value: '7D', label: '7D' },
  { value: '30D', label: '30D' },
];
const METRIC_OPTIONS = [
  { value: 'volume', label: 'Volume' },
  { value: 'count', label: 'Count' },
];

function bucketLabel(iso, range) {
  const d = new Date(iso);
  if (range === '1H') return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (range === '1D') return d.toLocaleTimeString([], { hour: 'numeric' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function TraderActivityChart({ traderId }) {
  const [range, setRange] = useState('7D');
  const [metric, setMetric] = useState('volume');
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    adminApi
      .getTraderActivity(traderId, { range, metric })
      .then((data) => { if (active) setSeries(data.series || []); })
      .catch((e) => { if (active) setError(e.response?.data?.message || 'Could not load activity.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [traderId, range, metric]);

  const isVolume = metric === 'volume';
  const values = series.flatMap((p) => [isVolume ? p.payInVolume : p.payInCount, isVolume ? p.payoutVolume : p.payoutCount]);
  const max = Math.max(1, ...values);
  const hasAny = values.some((v) => v > 0);

  return (
    <Card style={{ padding: '20px 22px', height: '100%' }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: 0 }}>Transaction activity</h2>
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0 0' }}>
            {isVolume ? 'Pay-in (settled orders) vs payout (withdrawal requests) — INR' : 'Pay-in vs payout count'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Segments options={METRIC_OPTIONS} value={metric} onChange={setMetric} />
          <Segments options={RANGE_OPTIONS} value={range} onChange={setRange} />
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        {loading ? (
          <p style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>Loading…</p>
        ) : error ? (
          <p style={{ color: '#ef4444', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>{error}</p>
        ) : !hasAny ? (
          <p style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>No settlements in this range yet.</p>
        ) : (
          <>
            <div className="tf-chart-bars">
              {series.map((p, i) => {
                const inVal = isVolume ? p.payInVolume : p.payInCount;
                const outVal = isVolume ? p.payoutVolume : p.payoutCount;
                return (
                  <div className="tf-chart-group" key={i}>
                    <div className="tf-chart-bar" style={{ height: `${Math.max(2, (inVal / max) * 100)}%`, background: 'linear-gradient(180deg,#f4626a,#e5484d)' }} title={`Pay-in ${isVolume ? inr(inVal) : inVal}`} />
                    <div className="tf-chart-bar" style={{ height: `${Math.max(2, (outVal / max) * 100)}%`, background: 'linear-gradient(180deg,#64748b,#334155)' }} title={`Payout ${isVolume ? inr(outVal) : outVal}`} />
                  </div>
                );
              })}
            </div>
            <div className="tf-chart-axis">
              {series.map((p, i) => <span key={i}>{bucketLabel(p.bucketStart, range)}</span>)}
            </div>
          </>
        )}
      </div>

      <div className="tf-chart-legend">
        <b><i style={{ background: '#e5484d' }} />Pay-in</b>
        <b><i style={{ background: '#334155' }} />Payout</b>
      </div>
    </Card>
  );
}

/* -------------------------------- Merchant Routing -------------------------------- */
function RoutingPanel({ routing, capped }) {
  const navigate = useNavigate();
  const activeCount = routing.filter((r) => r.currentState === 'Active now').length;

  return (
    <Card style={{ padding: '20px 22px', height: '100%' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: 0 }}>Current merchant routing</h2>
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0 0' }}>Merchants this trader currently serves</p>
        </div>
        <Badge color={activeCount > 0 ? 'green' : 'gray'}>{activeCount} active now</Badge>
      </div>

      <div className="mt-4 flex flex-col gap-2.5">
        {routing.length === 0 && (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>This trader has no order history with any merchant yet.</p>
        )}
        {routing.map((r) => (
          <button
            key={r.merchantId}
            type="button"
            onClick={() => navigate('/merchants')}
            className="tf-row-hover w-full rounded-lg text-left"
            style={{ border: '1px solid var(--cardborder)', padding: '10px 12px', background: 'var(--card)' }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate" style={{ color: 'var(--text)', fontWeight: 600, fontSize: 13.5, margin: 0 }}>{r.merchantName}</p>
                <p className="truncate font-mono" style={{ color: 'var(--muted)', fontSize: 11, margin: '2px 0 0' }}>{r.paymentAccount || '—'}</p>
              </div>
              <Badge color={r.currentState === 'Active now' ? 'green' : 'gray'}>{r.currentState}</Badge>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1" style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              <span>{compactInr(r.volumeToday)} today</span>
              <span>{r.ordersToday} order{r.ordersToday === 1 ? '' : 's'} today</span>
              <span>{r.successRate != null ? `${r.successRate}% success` : 'success rate n/a'}</span>
              <span>Last routed {relativeTime(r.lastRoutedAt)}</span>
            </div>
          </button>
        ))}
      </div>

      <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 14 }}>
        Volume, orders, success rate and last-routed are aggregated from this trader's real order ledger
        {capped ? ' (most recent 500 orders)' : ''}. "Active now" means the trader currently holds a live order
        (pending/checkout open/claimed paid/under review) for that merchant — MaxPay has no separate routing-allocation
        record beyond the order ledger itself.
      </p>
    </Card>
  );
}

/* ------------------------------------ Tabs ------------------------------------ */

function OverviewTab({ detail }) {
  const { trader, summary, accounts, devices, openDisputesCount } = detail;
  const offlineAccounts = accounts.length - summary.activeAccounts;
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 text-sm font-semibold" style={{ color: 'var(--text)' }}>Trader information</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Trader ID">#{trader.id}</Field>
          <Field label="Status"><Badge color={trader.status === 'active' ? 'green' : trader.status === 'suspended' ? 'red' : 'amber'}>{trader.status}</Badge></Field>
          <Field label="Email">{trader.email || '—'}</Field>
          <Field label="Joined">{fmtDate(trader.joined)}</Field>
          <Field label="Last active">{trader.lastActive ? relativeTime(trader.lastActive) : '—'}</Field>
          <Field label="Presence"><Badge color={trader.isOnline ? 'green' : 'gray'}>{trader.isOnline ? 'Online' : 'Offline'}</Badge></Field>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold" style={{ color: 'var(--text)' }}>Commercial</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Balance">{usdt(trader.balanceUsdt)}</Field>
          <Field label="Commission earned (lifetime)">{usdt(trader.commissionEarnedUsdt)}</Field>
          <Field label="Trader margin (My Rate)">{pct(trader.traderMargin)}</Field>
          <Field label="Payout commission">{pct(trader.payoutCommission)}</Field>
          <Field label="Today's volume">{inr(summary.todayVolumeInr)} of {inr(trader.dailyLimit)}</Field>
          <Field label="Rate label">{trader.rateLabel || '—'}</Field>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold" style={{ color: 'var(--text)' }}>Operational</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Active accounts">{summary.activeAccounts} of {accounts.length}</Field>
          <Field label="Offline / inactive accounts">{offlineAccounts}</Field>
          <Field label="Connected devices">{summary.devicesOnline} online of {devices.length}</Field>
          <Field label="Orders today">{summary.ordersToday}</Field>
          <Field label="Success rate">{summary.successRate != null ? `${summary.successRate}%` : 'N/A (no closed orders today)'}</Field>
          <Field label="Open disputes">{openDisputesCount}</Field>
        </div>
      </section>
    </div>
  );
}

function livenessColor(l) { return l === 'Live' ? 'green' : 'gray'; }

function AccountsTab({ accounts }) {
  if (accounts.length === 0) {
    return <p style={{ color: 'var(--muted)', fontSize: 14, padding: '24px 0', textAlign: 'center' }}>No payment accounts linked. Accounts appear here once the trader adds one.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide" style={{ borderBottom: '1px solid var(--cardborder)', color: 'var(--muted)' }}>
            <th className="px-3 py-2.5 font-medium">Account</th>
            <th className="px-3 py-2.5 font-medium">Method</th>
            <th className="px-3 py-2.5 font-medium">Intent</th>
            <th className="px-3 py-2.5 font-medium">Daily limit</th>
            <th className="px-3 py-2.5 font-medium">Used today</th>
            <th className="px-3 py-2.5 font-medium">Liveness</th>
            <th className="px-3 py-2.5 font-medium">Device</th>
            <th className="px-3 py-2.5 font-medium">Orders today</th>
            <th className="px-3 py-2.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id} style={{ borderTop: '1px solid var(--cardborder)' }}>
              <td className="px-3 py-2.5">
                <p className="font-mono" style={{ color: 'var(--text)', margin: 0, fontSize: 13 }}>{a.account}</p>
                {a.bankName && <p style={{ color: 'var(--muted)', fontSize: 11, margin: '2px 0 0' }}>{a.bankName}</p>}
              </td>
              <td className="px-3 py-2.5" style={{ color: 'var(--text)' }}>{a.accountType}</td>
              <td className="px-3 py-2.5" style={{ color: 'var(--muted)' }}>Collect</td>
              <td className="px-3 py-2.5" style={{ color: 'var(--text)' }}>{a.dailyLimit > 0 ? inr(a.dailyLimit) : '—'}</td>
              <td className="px-3 py-2.5">
                <div style={{ color: 'var(--text)' }}>{inr(a.usedToday)}</div>
                {a.dailyLimit > 0 && <div style={{ color: 'var(--muted)', fontSize: 11 }}>{Math.round((a.usedToday / a.dailyLimit) * 100)}% used</div>}
              </td>
              <td className="px-3 py-2.5"><Badge color={livenessColor(a.liveness)}>{a.liveness}</Badge></td>
              <td className="px-3 py-2.5 font-mono" style={{ color: 'var(--muted)', fontSize: 11 }}>{a.device ? a.device.slice(0, 10) + '…' : '—'}</td>
              <td className="px-3 py-2.5" style={{ color: 'var(--text)' }}>{a.ordersToday}</td>
              <td className="px-3 py-2.5"><Badge color={a.isActive ? 'green' : 'red'}>{a.isActive ? 'Active' : 'Blocked'}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DevicesTab({ devices }) {
  if (devices.length === 0) {
    return <p style={{ color: 'var(--muted)', fontSize: 14, padding: '24px 0', textAlign: 'center' }}>No devices connected. Devices appear here once the trader registers one.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide" style={{ borderBottom: '1px solid var(--cardborder)', color: 'var(--muted)' }}>
            <th className="px-3 py-2.5 font-medium">Device</th>
            <th className="px-3 py-2.5 font-medium">Connection</th>
            <th className="px-3 py-2.5 font-medium">Last heartbeat</th>
            <th className="px-3 py-2.5 font-medium">Registered</th>
            <th className="px-3 py-2.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => (
            <tr key={d.id} style={{ borderTop: '1px solid var(--cardborder)' }}>
              <td className="px-3 py-2.5">
                <p style={{ color: 'var(--text)', margin: 0 }}>{d.name}</p>
                <p className="font-mono" style={{ color: 'var(--muted)', fontSize: 11, margin: '2px 0 0' }}>{d.deviceId}</p>
              </td>
              <td className="px-3 py-2.5"><Badge color="sky">{d.connectionType}</Badge></td>
              <td className="px-3 py-2.5">
                <div style={{ color: 'var(--text)' }}>{fmtDateTime(d.lastPing)}</div>
                <div style={{ color: 'var(--muted)', fontSize: 11 }}>{relativeTime(d.lastPing)}</div>
              </td>
              <td className="px-3 py-2.5" style={{ color: 'var(--muted)', fontSize: 12 }}>{fmtDateTime(d.createdAt)}</td>
              <td className="px-3 py-2.5"><Badge color={d.online ? 'green' : 'gray'}>{d.online ? 'Online' : 'Offline'}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 12 }}>
        Model / APK version / linked-account count aren't tracked columns on this device record — omitted rather than invented.
      </p>
    </div>
  );
}

// Real captured payment events for this trader, from ngo-backend's Transaction
// store (proxied through /admin/traders/:id/notifications). Same data the
// trader's own Notifications page shows — the admin view was previously empty
// because it never crossed to ngo-backend at all.
function NotificationsTab({ traderId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const PER_PAGE = 15;

  useEffect(() => {
    let active = true;
    setLoading(true);
    adminApi.getTraderNotifications(traderId, { limit: 200 })
      .then((data) => { if (active) setRows(data.transactions || []); })
      .catch((e) => { if (active) setError(e.response?.data?.message || 'Could not load notifications.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [traderId]);

  const pageRows = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  if (loading) return <InlineLoader label="Loading notifications…" />;
  if (error) return <p style={{ color: '#ef4444', fontSize: 14 }}>{error}</p>;
  if (rows.length === 0) return <p style={{ color: 'var(--muted)', fontSize: 14, padding: '24px 0', textAlign: 'center' }}>No captured payment notifications for this trader yet.</p>;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide" style={{ borderBottom: '1px solid var(--cardborder)', color: 'var(--muted)' }}>
              <th className="px-3 py-2.5 font-medium">Amount</th>
              <th className="px-3 py-2.5 font-medium">Captured</th>
              <th className="px-3 py-2.5 font-medium">Payer</th>
              <th className="px-3 py-2.5 font-medium">UTR / Ref</th>
              <th className="px-3 py-2.5 font-medium">Detected</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((t) => {
              const amount = t.amount ?? t.amountInr ?? t.amount_inr;
              const captured = t.capturedText || t.rawEventId?.body || t.sender || t.rawEventId?.sender || '—';
              const payer = t.payerName || t.payerUpiId || '—';
              const utr = t.utr || t.utrNumber || t.upiRefId || t.rrn || '—';
              const when = t.scrapedAt || t.createdAt || t.capturedAt;
              return (
                <tr key={t._id || t.id || `${utr}-${when}`} style={{ borderTop: '1px solid var(--cardborder)' }}>
                  <td className="px-3 py-2.5" style={{ color: 'var(--text)' }}>{amount != null ? inr(amount) : '—'}</td>
                  <td className="px-3 py-2.5" style={{ color: 'var(--muted)', maxWidth: 320 }}><span className="line-clamp-2">{captured}</span></td>
                  <td className="px-3 py-2.5 font-mono" style={{ color: 'var(--muted)', fontSize: 11.5 }}>{payer}</td>
                  <td className="px-3 py-2.5 font-mono" style={{ color: 'var(--muted)', fontSize: 11.5 }}>{utr}</td>
                  <td className="px-3 py-2.5" style={{ color: 'var(--muted)', fontSize: 12 }}>{when ? fmtDateTime(when) : '—'}</td>
                  <td className="px-3 py-2.5">{t.status ? <Badge color="sky">{t.status}</Badge> : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination page={page} perPage={PER_PAGE} total={rows.length} onPage={setPage} />
    </div>
  );
}

function OrdersTab({ traderId }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const PER_PAGE = 10;

  useEffect(() => {
    let active = true;
    setLoading(true);
    adminApi.listOrders({ trader_id: traderId, limit: 200 })
      .then((data) => { if (active) setOrders(data.orders || []); })
      .catch((e) => { if (active) setError(e.response?.data?.message || 'Could not load orders.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [traderId]);

  const pageRows = orders.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  if (loading) return <InlineLoader label="Loading orders…" />;
  if (error) return <p style={{ color: '#ef4444', fontSize: 14 }}>{error}</p>;
  if (orders.length === 0) return <p style={{ color: 'var(--muted)', fontSize: 14, padding: '24px 0', textAlign: 'center' }}>No orders yet. Orders routed to this trader will appear here.</p>;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide" style={{ borderBottom: '1px solid var(--cardborder)', color: 'var(--muted)' }}>
              <th className="w-10 px-3 py-2.5" />
              <th className="px-3 py-2.5 font-medium">Merchant</th>
              <th className="px-3 py-2.5 font-medium">Amount</th>
              <th className="px-3 py-2.5 font-medium">Customer</th>
              <th className="px-3 py-2.5 font-medium">Type</th>
              <th className="px-3 py-2.5 font-medium">Created</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((o) => (
              <tr key={o.id} style={{ borderTop: '1px solid var(--cardborder)' }}>
                <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <AdminIdPopover rows={[{ label: 'Transaction ID', value: o.id }, { label: 'UUID', value: o.uuid }, { label: 'Merchant Order ID', value: o.merchant_order_id }, { label: 'Customer Reference', value: o.customer_ref }]} />
                </td>
                <td className="px-3 py-2.5" style={{ color: 'var(--text)' }}>{o.merchant?.business_name || '—'}</td>
                <td className="px-3 py-2.5" style={{ color: 'var(--text)' }}>{inr(o.amount_inr)}</td>
                <td className="px-3 py-2.5 font-mono" style={{ color: 'var(--muted)', fontSize: 11.5 }}>{o.customer_ref}</td>
                <td className="px-3 py-2.5"><Badge color={o.deposit_type === 'FTD' ? 'green' : 'sky'}>{o.deposit_type}</Badge></td>
                <td className="px-3 py-2.5" style={{ color: 'var(--muted)', fontSize: 12 }}>{fmtDateTime(o.created_at)}</td>
                <td className="px-3 py-2.5"><Badge color={orderStatusMeta(o.status).color}>{orderStatusMeta(o.status).label}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} perPage={PER_PAGE} total={orders.length} onPage={setPage} />
    </div>
  );
}

function BalanceHistoryTab({ traderId }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const PER_PAGE = 15;

  useEffect(() => {
    let active = true;
    setLoading(true);
    adminApi.getTraderBalanceLogs(traderId, { page, limit: PER_PAGE })
      .then((data) => { if (active) setLogs(data.logs || []); })
      .catch((e) => { if (active) setError(e.response?.data?.message || 'Could not load balance history.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [traderId, page]);

  if (loading && page === 1) return <InlineLoader label="Loading balance history…" />;
  if (error) return <p style={{ color: '#ef4444', fontSize: 14 }}>{error}</p>;
  if (logs.length === 0 && page === 1) return <p style={{ color: 'var(--muted)', fontSize: 14, padding: '24px 0', textAlign: 'center' }}>No balance movements. Commission, payouts and adjustments will be listed here.</p>;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide" style={{ borderBottom: '1px solid var(--cardborder)', color: 'var(--muted)' }}>
              <th className="px-3 py-2.5 font-medium">Time</th>
              <th className="px-3 py-2.5 font-medium">Type</th>
              <th className="px-3 py-2.5 font-medium">Amount</th>
              <th className="px-3 py-2.5 font-medium">After</th>
              <th className="px-3 py-2.5 font-medium">Reference</th>
              <th className="px-3 py-2.5 font-medium">Actor</th>
              <th className="px-3 py-2.5 font-medium">Note</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => {
              const debit = l.type === 'deduction';
              // order_id is only ever set by the real settlement path
              // (balanceService.settleOrder) — every admin-initiated
              // adjustment leaves it null. A deterministic real signal, not
              // a guess (see adminController.js's Trader Detail section).
              const actor = l.order_id != null ? 'System' : 'Admin';
              return (
                <tr key={l.id} style={{ borderTop: '1px solid var(--cardborder)' }}>
                  <td className="px-3 py-2.5">
                    <div style={{ color: 'var(--text)' }}>{fmtDateTime(l.created_at)}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 11 }}>{relativeTime(l.created_at)}</div>
                  </td>
                  <td className="px-3 py-2.5" style={{ color: 'var(--text)', textTransform: 'capitalize' }}>{l.type}</td>
                  <td className="px-3 py-2.5" style={{ color: debit ? '#b42318' : '#067647', fontWeight: 600 }}>
                    {debit ? '−' : '+'}{usdt(l.amount_usdt)}
                  </td>
                  <td className="px-3 py-2.5" style={{ color: 'var(--text)' }}>{l.balance_after != null ? usdt(l.balance_after) : '—'}</td>
                  <td className="px-3 py-2.5 font-mono" style={{ color: 'var(--muted)', fontSize: 11.5 }}>{l.order?.uuid ? l.order.uuid.slice(0, 8) + '…' : (l.order_id ? `#${l.order_id}` : '—')}</td>
                  <td className="px-3 py-2.5"><Badge color={actor === 'Admin' ? 'violet' : 'gray'}>{actor}</Badge></td>
                  <td className="px-3 py-2.5" style={{ color: 'var(--muted)' }}>{l.note || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between px-1 py-3 text-sm" style={{ color: 'var(--muted)' }}>
        <span>{loading ? 'Loading…' : `Page ${page}`}</span>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-lg px-3 py-1.5 disabled:opacity-40" style={{ background: 'var(--hover)', border: '1px solid var(--cardborder)', color: 'var(--text)' }}>Prev</button>
          <button onClick={() => setPage((p) => p + 1)} disabled={logs.length < PER_PAGE} className="rounded-lg px-3 py-1.5 disabled:opacity-40" style={{ background: 'var(--hover)', border: '1px solid var(--cardborder)', color: 'var(--text)' }}>Next</button>
        </div>
      </div>
    </div>
  );
}

const DISPUTE_STATUS_META = { open: { label: 'Open', color: 'red' }, reviewing: { label: 'Reviewing', color: 'amber' }, resolved: { label: 'Resolved', color: 'green' } };

function DisputesTab({ traderId }) {
  const navigate = useNavigate();
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    adminApi.listDisputes({ trader_id: traderId })
      .then((data) => { if (active) setDisputes(data.disputes || []); })
      .catch((e) => { if (active) setError(e.response?.data?.message || 'Could not load disputes.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [traderId]);

  if (loading) return <InlineLoader label="Loading disputes…" />;
  if (error) return <p style={{ color: '#ef4444', fontSize: 14 }}>{error}</p>;
  if (disputes.length === 0) return <p style={{ color: 'var(--muted)', fontSize: 14, padding: '24px 0', textAlign: 'center' }}>No disputes. Every transaction for this trader settled cleanly.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide" style={{ borderBottom: '1px solid var(--cardborder)', color: 'var(--muted)' }}>
            <th className="px-3 py-2.5 font-medium">Dispute</th>
            <th className="px-3 py-2.5 font-medium">Amount</th>
            <th className="px-3 py-2.5 font-medium">Reason</th>
            <th className="px-3 py-2.5 font-medium">Opened</th>
            <th className="px-3 py-2.5 font-medium">Status</th>
            <th className="px-3 py-2.5 font-medium text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {disputes.map((d) => {
            const meta = DISPUTE_STATUS_META[d.status] || { label: d.status, color: 'gray' };
            return (
              <tr key={d.id} style={{ borderTop: '1px solid var(--cardborder)' }}>
                <td className="px-3 py-2.5">
                  <p style={{ color: 'var(--text)', margin: 0 }}>#{d.id}</p>
                  <p className="font-mono" style={{ color: 'var(--muted)', fontSize: 11, margin: '2px 0 0' }}>{d.order?.uuid ? d.order.uuid.slice(0, 8) + '…' : `Order #${d.order_id}`}</p>
                </td>
                <td className="px-3 py-2.5" style={{ color: 'var(--text)' }}>{d.order?.amount_inr != null ? inr(d.order.amount_inr) : '—'}</td>
                <td className="px-3 py-2.5 truncate" style={{ color: 'var(--muted)', maxWidth: 240 }}>{d.reason || '—'}</td>
                <td className="px-3 py-2.5" style={{ color: 'var(--muted)', fontSize: 12 }}>{fmtDateTime(d.created_at)}</td>
                <td className="px-3 py-2.5"><Badge color={meta.color}>{meta.label}</Badge></td>
                <td className="px-3 py-2.5 text-right">
                  <Button size="sm" variant="ghost" onClick={() => navigate('/disputes')}>Open in Disputes →</Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------- Mutation modals -------------------------------- */

function BalanceModal({ trader, onClose, onSaved }) {
  const [action, setAction] = useState('add');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setAction('add'); setAmount(''); setNote(''); }, [trader?.id]);
  if (!trader) return null;

  const submit = async () => {
    const amt = Number(amount);
    if (!(amt > 0)) { toast('Enter a positive amount', 'error'); return; }
    setSaving(true);
    try {
      await adminApi.updateTraderBalance(trader.id, { action, amount_usdt: amt, note: note.trim() || undefined });
      toast(`Balance ${action === 'add' ? 'added' : 'deducted'} successfully`, 'success');
      onSaved();
      onClose();
    } catch (err) {
      toast(err.response?.data?.error?.message || err.response?.data?.message || 'Failed to update balance', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={!!trader} onClose={onClose} size="md" title="Edit Balance" subtitle={`Trader #${trader.id} · current ${usdt(trader.balanceUsdt)}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Apply'}</Button></>}>
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm" style={{ color: 'var(--muted)' }}>Action</label>
          <div className="flex gap-4">
            {[['add', 'Add'], ['deduct', 'Deduct']].map(([v, l]) => (
              <label key={v} className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
                <input type="radio" name="balance-action" value={v} checked={action === v} onChange={() => setAction(v)} />
                {l}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm" style={{ color: 'var(--muted)' }}>Amount (USDT)</label>
          <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 500" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm" style={{ color: 'var(--muted)' }}>Note (optional)</label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for adjustment" />
        </div>
      </div>
    </Modal>
  );
}

function CommissionModal({ trader, onClose, onSaved }) {
  const [traderMargin, setTraderMargin] = useState('');
  const [payout, setPayout] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (trader) {
      setTraderMargin(String(trader.traderMargin ?? '4.00'));
      setPayout(String(trader.payoutCommission ?? '2.00'));
    }
  }, [trader?.id]);
  if (!trader) return null;

  const tm = Number(traderMargin) || 0;
  const isValid = tm > 0;

  const submit = async () => {
    if (!isValid) return;
    setSaving(true);
    try {
      await adminApi.updateTraderCommission(trader.id, { trader_margin: tm, commission_rate: tm, payout_commission: Number(payout) || 0 });
      toast('Commercial settings updated', 'success');
      onSaved();
      onClose();
    } catch (err) {
      toast(err.response?.data?.message || err.response?.data?.error?.message || 'Failed to update', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={!!trader} onClose={onClose} size="md" title="Edit Commission" subtitle={`Trader #${trader.id} · balance ${usdt(trader.balanceUsdt)}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={saving || !isValid}>{saving ? 'Saving…' : 'Save changes'}</Button></>}>
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm" style={{ color: 'var(--muted)' }}>Trader Margin (My Rate) %</label>
          <Input type="number" step="0.01" min="0" value={traderMargin} onChange={(e) => setTraderMargin(e.target.value)} placeholder="4.00" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm" style={{ color: 'var(--muted)' }}>Payout Commission %</label>
          <Input type="number" step="0.01" min="0" value={payout} onChange={(e) => setPayout(e.target.value)} placeholder="2.00" />
        </div>
      </div>
    </Modal>
  );
}

// Feature 2 — allocate a trader to the payout pool and set their daily cap.
function PayoutAccessModal({ trader, onClose, onSaved }) {
  const [access, setAccess] = useState(false);
  const [limit, setLimit] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (trader) {
      setAccess(!!trader.payoutPoolAccess);
      setLimit(String(trader.payoutDailyLimit ?? 0));
    }
  }, [trader?.id]);
  if (!trader) return null;

  const submit = async () => {
    setSaving(true);
    try {
      await adminApi.updateTrader(trader.id, { payout_pool_access: access, payout_daily_limit: Number(limit) || 0 });
      toast('Payout access updated', 'success');
      onSaved();
      onClose();
    } catch (err) {
      toast(err.response?.data?.message || err.response?.data?.error?.message || 'Failed to update', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={!!trader} onClose={onClose} size="md" title="Payout pool access" subtitle={`Trader #${trader.id}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button></>}>
      <div className="space-y-4">
        <label className="flex items-center justify-between gap-3" style={{ cursor: 'pointer' }}>
          <span className="text-sm" style={{ color: 'var(--text)' }}>Allocated to the payout pool</span>
          <input type="checkbox" checked={access} onChange={(e) => setAccess(e.target.checked)} />
        </label>
        <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>
          Only allocated traders can see or pick up payouts from the global pool.
        </p>
        <div>
          <label className="mb-1.5 block text-sm" style={{ color: 'var(--muted)' }}>Daily payout limit (₹, 0 = no limit)</label>
          <Input type="number" step="1" min="0" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="0" />
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------ Page ------------------------------------ */

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'accounts', label: 'Payment Accounts' },
  { key: 'devices', label: 'Devices' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'orders', label: 'Orders' },
  { key: 'balance', label: 'Balance History' },
  { key: 'disputes', label: 'Disputes' },
];

export default function TraderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState('overview');
  const [balanceModal, setBalanceModal] = useState(false);
  const [commissionModal, setCommissionModal] = useState(false);
  const [payoutModal, setPayoutModal] = useState(false);
  const [confirming, setConfirming] = useState(null); // { next: boolean }
  const [suspending, setSuspending] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    adminApi.getTraderDetail(id)
      .then(setDetail)
      .catch((e) => {
        if (e.response?.status === 404) setNotFound(true);
        else setError(e.response?.data?.message || e.message || 'Could not load this trader.');
      })
      .finally(() => setLoading(false));
  };
  useEffect(load, [id]);

  const applySuspend = async () => {
    if (!confirming) return;
    setSuspending(true);
    try {
      await adminApi.suspendTrader(id, confirming.next);
      toast(`Trader ${confirming.next ? 'suspended' : 'reactivated'}`, confirming.next ? 'info' : 'success');
      load();
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to update trader status', 'error');
    } finally {
      setSuspending(false);
      setConfirming(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <InlineLoader label="Loading trader…" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: 18 }}>Trader not found</p>
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>This trader may have been removed.</p>
        <Button variant="ghost" onClick={() => navigate('/traders')}><ArrowLeft size={14} className="mr-1" /> Back to Traders</Button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <p style={{ color: '#ef4444', fontWeight: 600 }}>{error}</p>
        <Button variant="ghost" onClick={load}>Retry</Button>
      </div>
    );
  }

  const { trader, summary, accounts, devices, routing, routingScopeCapped } = detail;
  const displayName = trader.email ? trader.email.split('@')[0] : `trader-${trader.id}`;
  const statusColor = trader.status === 'active' ? 'green' : trader.status === 'suspended' ? 'red' : 'amber';

  return (
    <div>
      <button onClick={() => navigate('/traders')} className="mb-3 inline-flex items-center gap-1.5 text-sm" style={{ color: 'var(--muted)' }}>
        <ArrowLeft size={14} /> Traders
      </button>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 style={{ color: 'var(--text)', fontWeight: 800, fontSize: 22, margin: 0, letterSpacing: '-.5px' }}>{displayName}</h1>
            <Badge color={statusColor}>{trader.status}</Badge>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0' }}>Trader #{trader.id} · {trader.email} · joined {fmtDate(trader.joined)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setBalanceModal(true)}>Edit Balance</Button>
          <Button variant="ghost" size="sm" onClick={() => setCommissionModal(true)}>Edit Commission</Button>
          <Button variant="ghost" size="sm" onClick={() => setPayoutModal(true)}>Payout access</Button>
          {trader.status === 'suspended'
            ? <Button variant="success" size="sm" onClick={() => setConfirming({ next: false })}>Reactivate</Button>
            : <Button variant="danger" size="sm" onClick={() => setConfirming({ next: true })}>Suspend</Button>}
        </div>
      </div>

      {/* Top summary */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { icon: Wallet, label: 'Balance', value: usdt(trader.balanceUsdt) },
          { icon: Activity, label: "Today's volume", value: compactInr(summary.todayVolumeInr) },
          { icon: Users, label: 'Active accounts', value: `${summary.activeAccounts}/${accounts.length}` },
          { icon: SmartphoneIcon, label: 'Devices online', value: `${summary.devicesOnline}/${devices.length}` },
          { icon: Activity, label: 'Orders today', value: summary.ordersToday },
          { icon: Gauge, label: 'Success rate', value: summary.successRate != null ? `${summary.successRate}%` : 'N/A' },
        ].map((m) => (
          <Card key={m.label} style={{ padding: '14px 16px' }}>
            <div className="flex items-center gap-2" style={{ color: 'var(--muted)', fontSize: 11.5 }}><m.icon size={13} />{m.label}</div>
            <p style={{ color: 'var(--text)', fontWeight: 800, fontSize: 19, margin: '8px 0 0' }}>{m.value}</p>
          </Card>
        ))}
      </div>

      {/* Chart + routing */}
      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3"><TraderActivityChart traderId={trader.id} /></div>
        <div className="lg:col-span-2"><RoutingPanel routing={routing} capped={routingScopeCapped} /></div>
      </div>

      {/* Tabs */}
      <Card className="mb-4 p-2">
        <div className="flex flex-wrap gap-1" style={{ borderBottom: '1px solid var(--cardborder)' }}>
          {TABS.map((t) => {
            const count = t.key === 'accounts' ? accounts.length : t.key === 'devices' ? devices.length : null;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className="relative -mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition"
                style={{ borderColor: active ? 'var(--accent)' : 'transparent', color: active ? 'var(--accent)' : 'var(--muted)' }}
              >
                {t.label}
                {count != null && (
                  <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={active ? { background: 'var(--accent-soft)', color: 'var(--accent)' } : { background: 'var(--hover)', color: 'var(--text)' }}>{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="p-5">
        {tab === 'overview' && <OverviewTab detail={detail} />}
        {tab === 'accounts' && <AccountsTab accounts={accounts} />}
        {tab === 'devices' && <DevicesTab devices={devices} />}
        {tab === 'notifications' && <NotificationsTab traderId={trader.id} />}
        {tab === 'orders' && <OrdersTab traderId={trader.id} />}
        {tab === 'balance' && <BalanceHistoryTab traderId={trader.id} />}
        {tab === 'disputes' && <DisputesTab traderId={trader.id} />}
      </Card>

      {balanceModal && <BalanceModal trader={trader} onClose={() => setBalanceModal(false)} onSaved={load} />}
      {commissionModal && <CommissionModal trader={trader} onClose={() => setCommissionModal(false)} onSaved={load} />}
      {payoutModal && <PayoutAccessModal trader={trader} onClose={() => setPayoutModal(false)} onSaved={load} />}

      <ConfirmModal
        open={!!confirming}
        title={confirming?.next ? `Suspend ${displayName}?` : `Reactivate ${displayName}?`}
        description={
          confirming?.next
            ? `${displayName} will be removed from routing eligibility immediately and forced offline — their ${accounts.length} payment account${accounts.length === 1 ? '' : 's'} will stop receiving new orders. Orders already assigned are unaffected. Reversible from this same screen.`
            : `${displayName} will become eligible for routing and able to log in again.`
        }
        tone={confirming?.next ? 'danger' : 'primary'}
        confirmLabel={confirming?.next ? 'Suspend' : 'Reactivate'}
        busy={suspending}
        onConfirm={applySuspend}
        onClose={() => setConfirming(null)}
      />
    </div>
  );
}
