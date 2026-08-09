import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Wallet, ArrowDownLeft, ArrowUpRight, Activity, Gauge } from 'lucide-react';
import { Card, Badge, Button, Segments, Modal, Field, Input, InlineLoader, Pagination } from '../components/ui';
import AdminIdPopover from '../components/AdminIdPopover';
import ConfirmModal from '../components/ConfirmModal';
import { adminApi } from '../services/api';
import { inr, usdt, compactInr, pct } from '../utils/mock';
import { toast } from '../components/toast';

/*
  Admin Merchant Detail — Phase 6 of the MaxPay UI/UX migration.

  Real backend integration against the endpoints in
  backend/src/controllers/adminController.js:
    GET  /admin/merchants/:id              header + top summary + Overview
                                            + deposit mix (STD/FTD) + Active
                                            Traders
    GET  /admin/merchants/:id/activity     Transaction Activity chart
    GET  /admin/orders?merchant_id=        Orders tab (reused, extended with
                                            deposit_type + merchant_id filters)
    GET  /admin/payout-requests?merchant_id=  Payouts tab (reused, extended)
  Mutations reuse pre-existing endpoints Merchants.jsx already used:
    PUT  /admin/merchants/:id              suspend/reactivate
    PUT  /admin/merchants/:id/fees         edit fees

  STD/FTD is a REAL, stored per-order column (order.deposit_type, set by
  services/depositTypeChecker.js) — connected honestly below. Webhook
  delivery has no persisted log anywhere (BullMQ-only), so unlike the
  MaxPayDesign reference this page shows configuration state only, never a
  fabricated delivery log or health score. See adminController.js's
  "MERCHANT DETAIL" section for the full mapping + gaps.
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

const PAYOUT_STATUS_META = {
  awaiting_processing: { label: 'Awaiting Processing', color: 'amber' },
  in_processing: { label: 'In Processing', color: 'sky' },
  awaiting_settlement: { label: 'Awaiting Settlement', color: 'violet' },
  settlement_completed: { label: 'Settlement Completed', color: 'green' },
  canceled: { label: 'Canceled', color: 'gray' },
  dispute: { label: 'Dispute', color: 'red' },
};
const payoutStatusMeta = (s) => PAYOUT_STATUS_META[s] || { label: s || '—', color: 'gray' };

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

// Same chart architecture as Trader Detail's TraderActivityChart (Phase 5) —
// only the fetch call differs (merchant-scoped endpoint).
function MerchantActivityChart({ merchantId }) {
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
      .getMerchantActivity(merchantId, { range, metric })
      .then((data) => { if (active) setSeries(data.series || []); })
      .catch((e) => { if (active) setError(e.response?.data?.message || 'Could not load activity.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [merchantId, range, metric]);

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
            {isVolume ? 'Pay-in (settled orders) vs payout (settled payout requests) — INR' : 'Pay-in vs payout count'}
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

/* -------------------------------- Deposit mix (STD/FTD) -------------------------------- */
const MIX_COLOR = { FTD: '#e5484d', STD: '#334155' };

function DepositMixCard({ depositMix, mixTotalOrders }) {
  return (
    <Card style={{ padding: '20px 22px' }}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: 0 }}>Customer mix</h2>
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0 0' }}>First-time vs returning depositors</p>
        </div>
        {mixTotalOrders > 0 && <Badge color="gray">{mixTotalOrders} orders</Badge>}
      </div>

      {mixTotalOrders === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 16 }}>No classified orders yet.</p>
      ) : (
        <>
          <div className="mt-4 flex overflow-hidden rounded-full" style={{ height: 8, background: 'var(--hover)' }}>
            {depositMix.map((seg) => (
              <div key={seg.type} style={{ width: `${seg.sharePercent}%`, background: MIX_COLOR[seg.type] }} title={`${seg.type} ${seg.sharePercent}%`} />
            ))}
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {depositMix.map((seg) => (
              <div key={seg.type} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: MIX_COLOR[seg.type] }} />
                  <span style={{ color: 'var(--text)', fontWeight: 600 }}>{seg.type}</span>
                  <span style={{ color: 'var(--muted)' }}>{seg.sharePercent}%</span>
                </span>
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>{seg.distinctCustomers} customer{seg.distinctCustomers === 1 ? '' : 's'} · {seg.orders} orders</span>
              </div>
            ))}
          </div>
        </>
      )}
      <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 14 }}>
        Measured from <code>deposit_type</code> on this merchant's orders — a real ledger field set at order creation
        (services/depositTypeChecker.js). Customer counts are distinct payer references within each class.
      </p>
    </Card>
  );
}

/* -------------------------------- Active Traders -------------------------------- */
function ActiveTradersPanel({ routing, capped }) {
  const navigate = useNavigate();
  const activeCount = routing.filter((r) => r.currentState === 'Active now').length;

  return (
    <Card style={{ padding: '20px 22px', height: '100%' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: 0 }}>Active traders</h2>
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0 0' }}>Traders currently serving this merchant</p>
        </div>
        <Badge color={activeCount > 0 ? 'green' : 'gray'}>{activeCount} active</Badge>
      </div>

      <div className="mt-4 flex flex-col gap-2.5">
        {routing.length === 0 && (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>No trader has been routed to this merchant yet. Traders appear here once orders are assigned.</p>
        )}
        {routing.map((r) => (
          <button
            key={r.traderId}
            type="button"
            onClick={() => navigate(`/traders/${r.traderId}`)}
            className="tf-row-hover w-full rounded-lg text-left"
            style={{ border: '1px solid var(--cardborder)', padding: '10px 12px', background: 'var(--card)' }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate" style={{ color: 'var(--text)', fontWeight: 600, fontSize: 13.5, margin: 0 }}>{r.traderName}</p>
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
        Volume, orders, success rate and last-routed are aggregated from this merchant's real order ledger
        {capped ? ' (most recent 500 orders)' : ''}. "Active now" means the trader currently holds a live order
        for this merchant — MaxPay has no separate routing-allocation record beyond the order ledger itself.
      </p>
    </Card>
  );
}

/* ------------------------------------ Tabs ------------------------------------ */

function OverviewTab({ detail }) {
  const { merchant, summary, overview } = detail;
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 text-sm font-semibold" style={{ color: 'var(--text)' }}>Business details</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Merchant ID">#{merchant.id}</Field>
          <Field label="Business name">{merchant.businessName}</Field>
          <Field label="Status"><Badge color={merchant.status === 'active' ? 'green' : 'red'}>{merchant.status}</Badge></Field>
          <Field label="Email">{merchant.email || '—'}</Field>
          <Field label="Created">{fmtDate(merchant.createdAt)}</Field>
          <Field label="Last activity">{overview.lastActivityAt ? relativeTime(overview.lastActivityAt) : '—'}</Field>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold" style={{ color: 'var(--text)' }}>Financial</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Settlement balance">{usdt(merchant.balanceUsdt)}</Field>
          <Field label="Pending settlement">{inr(overview.pendingSettlementInr)}</Field>
          <Field label="Pay-in fee">{pct(merchant.payinFeePercent)}</Field>
          <Field label="Payout fee">{pct(merchant.payoutFeePercent)}</Field>
          <Field label="Today's pay-in">{inr(summary.payinTodayInr)}</Field>
          <Field label="Today's payout">{inr(summary.payoutTodayInr)}</Field>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold" style={{ color: 'var(--text)' }}>Operational</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Today's orders">{summary.ordersToday}</Field>
          <Field label="Successful orders">{overview.successfulOrdersToday}</Field>
          <Field label="Failed orders">{overview.failedOrdersToday}</Field>
          <Field label="Success rate">{summary.successRate != null ? `${summary.successRate}%` : 'N/A (no closed orders today)'}</Field>
          <Field label="Open disputes">{overview.openDisputesCount}</Field>
          <Field label="Active traders">{overview.activeTradersCount}</Field>
        </div>
      </section>
    </div>
  );
}

const DEPOSIT_FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'FTD', label: 'FTD' },
  { value: 'STD', label: 'STD' },
];

function OrdersTab({ merchantId }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [depositFilter, setDepositFilter] = useState('all');
  const PER_PAGE = 10;

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = { merchant_id: merchantId, limit: 200 };
    if (depositFilter !== 'all') params.deposit_type = depositFilter;
    adminApi.listOrders(params)
      .then((data) => { if (active) setOrders(data.orders || []); })
      .catch((e) => { if (active) setError(e.response?.data?.message || 'Could not load orders.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [merchantId, depositFilter]);

  const pageRows = orders.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <Segments options={DEPOSIT_FILTER_OPTIONS} value={depositFilter} onChange={(v) => { setDepositFilter(v); setPage(1); }} />
      </div>
      {loading ? <InlineLoader label="Loading orders…" /> : error ? (
        <p style={{ color: '#ef4444', fontSize: 14 }}>{error}</p>
      ) : orders.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 14, padding: '24px 0', textAlign: 'center' }}>No orders match this filter.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide" style={{ borderBottom: '1px solid var(--cardborder)', color: 'var(--muted)' }}>
                  <th className="w-10 px-3 py-2.5" />
                  <th className="px-3 py-2.5 font-medium">Customer</th>
                  <th className="px-3 py-2.5 font-medium">Amount</th>
                  <th className="px-3 py-2.5 font-medium">Trader</th>
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
                    <td className="px-3 py-2.5 font-mono" style={{ color: 'var(--text)', fontSize: 12 }}>{o.customer_ref}</td>
                    <td className="px-3 py-2.5" style={{ color: 'var(--text)' }}>{inr(o.amount_inr)}</td>
                    <td className="px-3 py-2.5" style={{ color: 'var(--muted)' }}>{o.trader_id ? `#${o.trader_id}` : 'Unassigned'}</td>
                    <td className="px-3 py-2.5"><Badge color={o.deposit_type === 'FTD' ? 'green' : 'sky'}>{o.deposit_type}</Badge></td>
                    <td className="px-3 py-2.5" style={{ color: 'var(--muted)', fontSize: 12 }}>{fmtDateTime(o.created_at)}</td>
                    <td className="px-3 py-2.5"><Badge color={orderStatusMeta(o.status).color}>{orderStatusMeta(o.status).label}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} perPage={PER_PAGE} total={orders.length} onPage={setPage} />
        </>
      )}
    </div>
  );
}

function PayoutsTab({ merchantId }) {
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const PER_PAGE = 10;

  useEffect(() => {
    let active = true;
    setLoading(true);
    adminApi.listPayoutRequests({ merchant_id: merchantId })
      .then((data) => { if (active) setPayouts(data.payout_requests || []); })
      .catch((e) => { if (active) setError(e.response?.data?.message || 'Could not load payouts.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [merchantId]);

  const pageRows = payouts.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  if (loading) return <InlineLoader label="Loading payouts…" />;
  if (error) return <p style={{ color: '#ef4444', fontSize: 14 }}>{error}</p>;
  if (payouts.length === 0) return <p style={{ color: 'var(--muted)', fontSize: 14, padding: '24px 0', textAlign: 'center' }}>No payouts yet.</p>;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide" style={{ borderBottom: '1px solid var(--cardborder)', color: 'var(--muted)' }}>
              <th className="px-3 py-2.5 font-medium">Payout</th>
              <th className="px-3 py-2.5 font-medium">Beneficiary</th>
              <th className="px-3 py-2.5 font-medium">Amount</th>
              <th className="px-3 py-2.5 font-medium">Method</th>
              <th className="px-3 py-2.5 font-medium">Trader</th>
              <th className="px-3 py-2.5 font-medium">Requested</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((p) => (
              <tr key={p.id} style={{ borderTop: '1px solid var(--cardborder)' }}>
                <td className="px-3 py-2.5 font-mono" style={{ color: 'var(--text)', fontSize: 12 }}>#{p.id}</td>
                <td className="px-3 py-2.5" style={{ color: 'var(--text)' }}>{p.recipient_name || '—'}</td>
                <td className="px-3 py-2.5" style={{ color: 'var(--text)' }}>{inr(p.amount_inr)}</td>
                <td className="px-3 py-2.5" style={{ color: 'var(--muted)' }}>{p.payment_method}</td>
                <td className="px-3 py-2.5" style={{ color: 'var(--muted)' }}>{p.assigned_trader_id ? `#${p.assigned_trader_id}` : 'Unassigned'}</td>
                <td className="px-3 py-2.5" style={{ color: 'var(--muted)', fontSize: 12 }}>{fmtDateTime(p.created_at)}</td>
                <td className="px-3 py-2.5"><Badge color={payoutStatusMeta(p.status).color}>{payoutStatusMeta(p.status).label}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} perPage={PER_PAGE} total={payouts.length} onPage={setPage} />
    </div>
  );
}

function FeesTab({ merchant, onEditFees }) {
  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Pay-in</h3>
          <Button variant="ghost" size="sm" onClick={onEditFees}>Edit Fees</Button>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="UPI">{pct(merchant.payinFeePercent)}</Field>
          <Field label="IMPS">N/A</Field>
        </div>
      </section>
      <section>
        <h3 className="mb-3 text-sm font-semibold" style={{ color: 'var(--text)' }}>Payout</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="UPI">{pct(merchant.payoutFeePercent)}</Field>
          <Field label="IMPS">N/A</Field>
        </div>
      </section>
      <p style={{ color: 'var(--muted)', fontSize: 11 }}>
        MaxPay stores one pay-in and one payout rate per merchant. Per-rail pricing (IMPS, NEFT) has no backing field,
        so those rows read N/A rather than repeating the UPI rate.
      </p>
    </div>
  );
}

function ApiStatusTab({ merchant }) {
  const copy = (v, label) => { navigator.clipboard?.writeText(v).then(() => toast(`${label} copied`, 'success')).catch(() => {}); };
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 text-sm font-semibold" style={{ color: 'var(--text)' }}>Integration</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="API key status"><Badge color={merchant.isActive ? 'green' : 'red'}>{merchant.isActive ? 'Active' : 'Disabled'}</Badge></Field>
          <Field label="API key" mono>
            <span className="inline-flex items-center gap-2">
              {merchant.apiKeyMasked}
              <button onClick={() => copy(merchant.apiKeyMasked, 'API key')} className="text-xs underline" style={{ color: 'var(--accent)' }}>Copy</button>
            </span>
          </Field>
          <Field label="Key issued">{fmtDate(merchant.createdAt)}</Field>
          <Field label="Last API activity">Not tracked (no request-level log exists)</Field>
          <Field label="Webhook endpoint">
            {merchant.webhookUrl ? (
              <span className="inline-flex items-center gap-2">
                <span className="truncate font-mono" style={{ maxWidth: 220, display: 'inline-block' }}>{merchant.webhookUrl}</span>
                <button onClick={() => copy(merchant.webhookUrl, 'Webhook URL')} className="text-xs underline" style={{ color: 'var(--accent)' }}>Copy</button>
              </span>
            ) : 'Not configured'}
          </Field>
          <Field label="Webhook state"><Badge color={merchant.webhookConfigured ? 'green' : 'gray'}>{merchant.webhookConfigured ? 'Configured' : 'Not configured'}</Badge></Field>
        </div>
      </section>
      <p style={{ color: 'var(--muted)', fontSize: 11 }}>
        Only the masked key is ever rendered — this console does not display or request the API secret.
        Webhook deliveries are queued (BullMQ) with no persisted delivery history table, so no delivery log or
        health score is shown here — showing one would be fabricated.
      </p>
    </div>
  );
}

/* -------------------------------- Mutation modals -------------------------------- */

function EditFeesModal({ merchant, onClose, onSaved }) {
  const [payin, setPayin] = useState('');
  const [payout, setPayout] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (merchant) {
      setPayin(String(merchant.payinFeePercent ?? '5.00'));
      setPayout(String(merchant.payoutFeePercent ?? '2.00'));
    }
  }, [merchant?.id]);
  if (!merchant) return null;

  const submit = async () => {
    setSaving(true);
    try {
      await adminApi.updateMerchantFees(merchant.id, { payin_fee_percent: Number(payin) || 0, payout_fee_percent: Number(payout) || 0 });
      toast('Fees updated', 'success');
      onSaved();
      onClose();
    } catch (err) {
      toast(err.response?.data?.message || err.response?.data?.error?.message || 'Failed to update fees', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={!!merchant} onClose={onClose} size="md" title="Edit Fees" subtitle={merchant.businessName}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save fees'}</Button></>}>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1.5 block text-sm" style={{ color: 'var(--muted)' }}>Pay-in Fee (%)</label>
          <Input type="number" step="0.01" min="0" value={payin} onChange={(e) => setPayin(e.target.value)} placeholder="5.00" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm" style={{ color: 'var(--muted)' }}>Payout Fee (%)</label>
          <Input type="number" step="0.01" min="0" value={payout} onChange={(e) => setPayout(e.target.value)} placeholder="2.00" />
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------ Page ------------------------------------ */

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'orders', label: 'Orders' },
  { key: 'payouts', label: 'Payouts' },
  { key: 'fees', label: 'Fees' },
  { key: 'api', label: 'API Status' },
];

export default function MerchantDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState('overview');
  const [feesModal, setFeesModal] = useState(false);
  const [confirming, setConfirming] = useState(null); // { deactivate: boolean }
  const [suspending, setSuspending] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    adminApi.getMerchantDetail(id)
      .then(setDetail)
      .catch((e) => {
        if (e.response?.status === 404) setNotFound(true);
        else setError(e.response?.data?.message || e.message || 'Could not load this merchant.');
      })
      .finally(() => setLoading(false));
  };
  useEffect(load, [id]);

  const applySuspend = async () => {
    if (!confirming) return;
    const nextActive = !confirming.deactivate;
    setSuspending(true);
    try {
      await adminApi.updateMerchant(id, { is_active: nextActive, status: nextActive ? 'active' : 'suspended' });
      toast(`Merchant ${nextActive ? 'activated' : 'deactivated'}`, nextActive ? 'success' : 'info');
      load();
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to update merchant status', 'error');
    } finally {
      setSuspending(false);
      setConfirming(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <InlineLoader label="Loading merchant…" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: 18 }}>Merchant not found</p>
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>This merchant may have been removed.</p>
        <Button variant="ghost" onClick={() => navigate('/merchants')}><ArrowLeft size={14} className="mr-1" /> Back to Merchants</Button>
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

  const { merchant, summary, depositMix, mixTotalOrders, routing, routingScopeCapped } = detail;
  const statusColor = merchant.status === 'active' ? 'green' : 'red';

  return (
    <div>
      <button onClick={() => navigate('/merchants')} className="mb-3 inline-flex items-center gap-1.5 text-sm" style={{ color: 'var(--muted)' }}>
        <ArrowLeft size={14} /> Merchants
      </button>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 style={{ color: 'var(--text)', fontWeight: 800, fontSize: 22, margin: 0, letterSpacing: '-.5px' }}>{merchant.businessName}</h1>
            <Badge color={statusColor}>{merchant.status}</Badge>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0' }}>Merchant #{merchant.id} · {merchant.email} · onboarded {fmtDate(merchant.createdAt)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setFeesModal(true)}>Edit Fees</Button>
          {merchant.status === 'suspended'
            ? <Button variant="success" size="sm" onClick={() => setConfirming({ deactivate: false })}>Reactivate</Button>
            : <Button variant="danger" size="sm" onClick={() => setConfirming({ deactivate: true })}>Suspend</Button>}
        </div>
      </div>

      {/* Top summary */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { icon: Wallet, label: 'Settlement balance', value: usdt(merchant.balanceUsdt) },
          { icon: ArrowDownLeft, label: "Today's pay-in", value: compactInr(summary.payinTodayInr) },
          { icon: ArrowUpRight, label: "Today's payout", value: compactInr(summary.payoutTodayInr) },
          { icon: Activity, label: 'Orders today', value: summary.ordersToday },
          { icon: Gauge, label: 'Success rate', value: summary.successRate != null ? `${summary.successRate}%` : 'N/A' },
        ].map((m) => (
          <Card key={m.label} style={{ padding: '14px 16px' }}>
            <div className="flex items-center gap-2" style={{ color: 'var(--muted)', fontSize: 11.5 }}><m.icon size={13} />{m.label}</div>
            <p style={{ color: 'var(--text)', fontWeight: 800, fontSize: 19, margin: '8px 0 0' }}>{m.value}</p>
          </Card>
        ))}
      </div>

      {/* Chart + mix (left) / Active traders (right) */}
      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3 flex flex-col gap-4">
          <MerchantActivityChart merchantId={merchant.id} />
          <DepositMixCard depositMix={depositMix} mixTotalOrders={mixTotalOrders} />
        </div>
        <div className="lg:col-span-2"><ActiveTradersPanel routing={routing} capped={routingScopeCapped} /></div>
      </div>

      {/* Tabs */}
      <Card className="mb-4 p-2">
        <div className="flex flex-wrap gap-1" style={{ borderBottom: '1px solid var(--cardborder)' }}>
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className="relative -mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition"
                style={{ borderColor: active ? 'var(--accent)' : 'transparent', color: active ? 'var(--accent)' : 'var(--muted)' }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="p-5">
        {tab === 'overview' && <OverviewTab detail={detail} />}
        {tab === 'orders' && <OrdersTab merchantId={merchant.id} />}
        {tab === 'payouts' && <PayoutsTab merchantId={merchant.id} />}
        {tab === 'fees' && <FeesTab merchant={merchant} onEditFees={() => setFeesModal(true)} />}
        {tab === 'api' && <ApiStatusTab merchant={merchant} />}
      </Card>

      {feesModal && <EditFeesModal merchant={merchant} onClose={() => setFeesModal(false)} onSaved={load} />}

      <ConfirmModal
        open={!!confirming}
        title={confirming?.deactivate ? `Suspend ${merchant.businessName}?` : `Reactivate ${merchant.businessName}?`}
        description={
          confirming?.deactivate
            ? `${merchant.businessName} will immediately stop accepting new pay-in and payout orders, and their checkout will reject new sessions. Orders already in flight are unaffected. Reversible from this same screen.`
            : `${merchant.businessName} will resume accepting orders under their existing product configuration and limits.`
        }
        tone={confirming?.deactivate ? 'danger' : 'primary'}
        confirmLabel={confirming?.deactivate ? 'Suspend' : 'Reactivate'}
        busy={suspending}
        onConfirm={applySuspend}
        onClose={() => setConfirming(null)}
      />
    </div>
  );
}
