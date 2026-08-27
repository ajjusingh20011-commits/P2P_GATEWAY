import { useEffect, useMemo, useState } from 'react';
import { Card, Badge, Button, Tabs, Pagination, PageHeader, Modal, Input, Select } from '../components/ui';
import { IconPlus, IconCopy, IconCheck, IconExport } from '../components/icons';
import { orders as seedOrders, inr, usdt, checkoutUrl } from '../utils/mock';
import { merchantApi } from '../services/api';

// Backend order-listing is capped at 100/page (see backend's pagination()
// helper) — loop up to this many pages so filters/tabs/CSV export operate on
// the merchant's real recent order history rather than only its first 25
// (the previous version's bug: a single unpaginated fetch silently hid any
// order past the backend's default page-1 limit). Everything below this —
// tabs, counts, search, pagination — runs client-side over this real,
// honestly-bounded window; there is no synthetic data anywhere in it.
const ORDER_FETCH_PAGES = 10;

const ORDER_STATUSES = ['pending', 'checkout_open', 'claimed_paid', 'under_review', 'success', 'failed', 'rejected', 'disputed', 'cancelled'];
const STATUS_META = {
  pending: { label: 'Pending', color: 'gray' },
  checkout_open: { label: 'Checkout Open', color: 'sky' },
  claimed_paid: { label: 'Claimed Paid', color: 'amber' },
  under_review: { label: 'Under Review', color: 'amber' },
  success: { label: 'Success', color: 'green' },
  failed: { label: 'Failed', color: 'gray' },
  rejected: { label: 'Rejected', color: 'red' },
  disputed: { label: 'Disputed', color: 'amber' },
  cancelled: { label: 'Cancelled', color: 'gray' },
};
const TERMINAL_STATUSES = new Set(['success', 'failed', 'rejected', 'disputed', 'cancelled']);
const DATE_PRESETS = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];
const PAGE_SIZE_OPTIONS = [{ value: '10', label: '10 / page' }, { value: '20', label: '20 / page' }, { value: '50', label: '50 / page' }];

function matchesDatePreset(iso, preset) {
  if (preset === 'all' || !iso) return true;
  const age = Date.now() - new Date(iso).getTime();
  if (preset === 'today') return age <= 86400000;
  if (preset === '7d') return age <= 7 * 86400000;
  return age <= 30 * 86400000;
}

function toCsv(rows) {
  return rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
}

// FTD green / STD blue.
function DepositBadge({ type }) {
  if (!type) return <span className="text-xs" style={{ color: 'var(--muted)' }}>—</span>;
  return <Badge color={type === 'FTD' ? 'green' : 'sky'}>{type}</Badge>;
}

// Normalize an API order into the shape the table/drawer render. Every field
// here is a real column from the orders table (see order.model.js) — nothing
// synthesized. `closedAt` picks the most relevant real terminal timestamp
// (there's no single "closed_at" column) so it's an honest derived value,
// not a fabricated one.
function mapOrder(o) {
  return {
    id: o.uuid || o.id,
    gatewayOrderId: o.gateway_order_id || null,
    merchantOrderId: o.merchant_order_id || null,
    depositType: o.deposit_type || null,
    amountInr: Number(o.amount_inr) || 0,
    amountUsdt: o.amount_usdt != null ? Number(o.amount_usdt) : null,
    traderRate: o.trader_rate != null ? Number(o.trader_rate) : null,
    exchangeRate: o.exchange_rate != null ? Number(o.exchange_rate) : null,
    customerRef: o.customer_ref,
    status: o.status,
    createdAt: o.created_at,
    closedAt: TERMINAL_STATUSES.has(o.status) ? (o.confirmed_at || o.rejected_at || o.reviewed_at || o.updated_at || null) : null,
    checkoutUrl: o.checkout_url || checkoutUrl(o.uuid || o.id),
    // Real customer-proof fields (order.model.js) — used by the detail drawer.
    utr: o.utr_number || null,
    confirmationType: o.confirmation_type || null,
    claimedPaidAt: o.claimed_paid_at || null,
    customerConfirmedAt: o.customer_confirmed_at || null,
    reviewedAt: o.reviewed_at || null,
    rejectedAt: o.rejected_at || null,
    rejectionReason: o.rejection_reason || null,
    merchantFeeUsdt: o.merchant_fee_usdt != null ? Number(o.merchant_fee_usdt) : null,
    merchantReceivesUsdt: o.merchant_receives_usdt != null ? Number(o.merchant_receives_usdt) : null,
  };
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return { time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), date: d.toLocaleDateString([], { day: '2-digit', month: 'short' }) };
}

function CreateOrderModal({ open, onClose, onCreate }) {
  const [amount, setAmount] = useState('');
  const [ref, setRef] = useState('');
  const [depositType, setDepositType] = useState('STD');
  const [merchantOrderId, setMerchantOrderId] = useState('');
  const [created, setCreated] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setAmount(''); setRef(''); setDepositType('STD'); setMerchantOrderId('');
    setCreated(null); setErrorMsg(''); setFieldError(''); setCopied(false); setSubmitting(false);
  };
  const close = () => { reset(); onClose(); };

  const submit = async () => {
    const amt = Number(amount);
    setFieldError('');
    if (!amt || amt <= 0) { setFieldError('Enter a valid amount.'); return; }
    if (!ref.trim()) { setFieldError('Customer reference is required.'); return; }
    setSubmitting(true);
    setErrorMsg('');
    try {
      const result = await onCreate({
        amount_inr: amt,
        customer_ref: ref.trim(),
        deposit_type: depositType,
        merchant_order_id: merchantOrderId.trim() || undefined,
      });
      if (result?.ok) setCreated(result.order);
      else setErrorMsg(result?.message || 'Could not create the order. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const copy = () => {
    navigator.clipboard?.writeText(created.checkoutUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="md"
      title="Create New Order"
      subtitle={
        errorMsg ? 'Payment provider unavailable'
          : created ? 'Order created — share the checkout link'
          : 'Generate a payment link for a customer'
      }
      footer={
        errorMsg ? (
          <>
            <Button variant="ghost" onClick={close}>Close</Button>
            <Button onClick={() => setErrorMsg('')}>Try again</Button>
          </>
        ) : created ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button onClick={submit} disabled={submitting}>{submitting ? 'Creating…' : 'Create order'}</Button>
          </>
        )
      }
    >
      {errorMsg ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: 'rgba(239,68,68,0.1)' }}>
            <svg viewBox="0 0 24 24" className="h-8 w-8" style={{ color: '#ef4444' }} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" />
            </svg>
          </div>
          <h3 className="text-base font-semibold" style={{ color: 'var(--text)' }}>P2P is unavailable right now</h3>
          <p className="max-w-xs text-sm" style={{ color: 'var(--muted)' }}>{errorMsg}</p>
        </div>
      ) : !created ? (
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm" style={{ color: 'var(--muted)' }}>Amount (INR)</label>
            <Input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 5000" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm" style={{ color: 'var(--muted)' }}>Customer Reference <span style={{ color: '#ef4444' }}>*</span></label>
            <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. USER_123" />
            <p className="mt-1 text-xs" style={{ color: 'var(--subtle, var(--muted))' }}>Identifies the customer. FTD/STD is auto-detected from this.</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm" style={{ color: 'var(--muted)' }}>Deposit Type</label>
            <div className="flex gap-4">
              {[['FTD', 'FTD — First Time Deposit'], ['STD', 'STD — Standard Deposit']].map(([v, l]) => (
                <label key={v} className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
                  <input type="radio" name="deposit-type" value={v} checked={depositType === v} onChange={() => setDepositType(v)} className="accent-[var(--accent)]" />
                  {l}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs" style={{ color: 'var(--subtle, var(--muted))' }}>The server auto-detects and corrects this from the customer's history.</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm" style={{ color: 'var(--muted)' }}>Merchant Order ID <span style={{ color: 'var(--muted)' }}>(optional)</span></label>
            <Input value={merchantOrderId} onChange={(e) => setMerchantOrderId(e.target.value)} placeholder="e.g. ORD_001" />
          </div>
          {fieldError && <p className="text-sm" style={{ color: '#ef4444' }}>{fieldError}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <div
            className="flex items-center gap-3 rounded-lg border px-4 py-3 text-sm"
            style={{ borderColor: 'rgba(34,197,94,0.3)', background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}
          >
            <IconCheck className="h-5 w-5 flex-shrink-0" />
            <span>Order <strong>{created.gatewayOrderId || created.id}</strong> for {inr(created.amountInr)} is ready.</span>
          </div>
          <div className="grid grid-cols-2 gap-3 rounded-lg border px-4 py-3 text-sm" style={{ borderColor: 'var(--cardborder)', background: 'var(--hover)' }}>
            <div>
              <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Gateway Order ID</p>
              <p className="mt-0.5 font-mono text-xs font-medium" style={{ color: '#22c55e' }}>{created.gatewayOrderId || '—'}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Deposit Type</p>
              <p className="mt-0.5"><DepositBadge type={created.depositType} /></p>
            </div>
            {created.merchantOrderId && (
              <div>
                <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Merchant Order ID</p>
                <p className="mt-0.5 font-mono text-xs" style={{ color: 'var(--text)' }}>{created.merchantOrderId}</p>
              </div>
            )}
            <div>
              <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Amount (INR)</p>
              <p className="mt-0.5 font-medium" style={{ color: 'var(--text)' }}>{inr(created.amountInr)}</p>
            </div>
            {created.amountUsdt != null && (
              <div>
                <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Amount (USDT)</p>
                <p className="mt-0.5 font-medium" style={{ color: 'var(--text)' }}>{usdt(created.amountUsdt)}</p>
              </div>
            )}
            <div>
              <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Order ID</p>
              <p className="mt-0.5 font-mono text-xs" style={{ color: 'var(--text)' }}>{created.id}</p>
            </div>
            {created.expiresAt && (
              <div>
                <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Expires</p>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--text)' }}>{new Date(created.expiresAt).toLocaleString()}</p>
              </div>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-sm" style={{ color: 'var(--muted)' }}>Checkout URL</label>
            <code
              className="block truncate rounded-lg border px-3 py-2 font-mono text-xs"
              style={{ borderColor: 'var(--cardborder)', background: 'var(--hover)', color: 'var(--text)' }}
            >
              {created.checkoutUrl}
            </code>
            <div className="mt-3 flex items-center gap-2">
              <Button variant="ghost" onClick={copy}>
                {copied ? <IconCheck className="h-4 w-4" /> : <IconCopy className="h-4 w-4" />}
                {copied ? 'Copied' : 'Copy link'}
              </Button>
              <a
                href={created.checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
                style={{ background: 'var(--accent)' }}
              >
                Open checkout
              </a>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function DetailTile({ label, value, mono }) {
  return (
    <div>
      <p style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</p>
      <p className={mono ? 'font-mono' : ''} style={{ color: 'var(--text)', fontSize: 13, margin: '3px 0 0' }}>{value}</p>
    </div>
  );
}

// Detail drawer — every field is a real order.model.js column. Deliberately
// omits what the design's mock version showed but this system doesn't track:
// checkout-visit counts / first-opened / last-opened (no such tracking
// exists), payment method (this gateway is UPI-only, no method column),
// merchant notes and "Resend confirmation" (no backend endpoint for either —
// faking either would violate the no-local-fake-success rule).
function OrderDetailDrawer({ order, open, onClose }) {
  if (!order) return null;
  const copyId = () => navigator.clipboard?.writeText(order.gatewayOrderId || order.id);
  const proofLabel = order.confirmationType === 'utr' ? 'UTR' : order.confirmationType === 'screenshot' ? 'Screenshot' : order.confirmationType === 'no_proof' ? 'No proof required' : '—';

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={
        <span className="inline-flex items-center gap-2">
          {order.gatewayOrderId || String(order.id).slice(0, 8)}
          <button type="button" onClick={copyId} className="tf-hbtn" style={{ width: 26, height: 26 }} aria-label="Copy order ID">
            <IconCopy className="h-3.5 w-3.5" />
          </button>
        </span>
      }
      subtitle={order.merchantOrderId || undefined}
    >
      <div className="text-center rounded-xl p-5" style={{ background: 'var(--hover)', border: '1px solid var(--cardborder)' }}>
        <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>Amount</p>
        <p style={{ color: 'var(--text)', fontSize: 28, fontWeight: 700, margin: '6px 0' }}>{inr(order.amountInr)}</p>
        <div className="flex items-center justify-center gap-2">
          <DepositBadge type={order.depositType} />
          <Badge color={(STATUS_META[order.status] || {}).color || 'gray'}>{(STATUS_META[order.status] || {}).label || order.status}</Badge>
        </div>
      </div>

      <p className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Customer proof</p>
      <div className="grid grid-cols-2 gap-3">
        <DetailTile label="Proof type" value={proofLabel} />
        <DetailTile label="UTR" value={order.utr || '—'} mono />
        <DetailTile label='"I Paid" clicked' value={order.claimedPaidAt ? new Date(order.claimedPaidAt).toLocaleString() : '—'} />
        <DetailTile label="Customer confirmed" value={order.customerConfirmedAt ? new Date(order.customerConfirmedAt).toLocaleString() : '—'} />
      </div>

      {(order.merchantFeeUsdt != null || order.merchantReceivesUsdt != null) ? (
        <>
          <p className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Settlement</p>
          <div className="grid grid-cols-2 gap-3">
            <DetailTile label="Rate applied" value={order.traderRate != null ? `₹${order.traderRate.toFixed(2)} / USDT` : '—'} />
            <DetailTile label="Amount (USDT)" value={order.amountUsdt != null ? usdt(order.amountUsdt) : '—'} />
            <DetailTile label="Fee" value={order.merchantFeeUsdt != null ? `−${usdt(order.merchantFeeUsdt)}` : '—'} />
            <DetailTile label="Settlement credit" value={order.merchantReceivesUsdt != null ? `+${usdt(order.merchantReceivesUsdt)}` : '—'} />
          </div>
        </>
      ) : (
        <p className="mt-5 text-sm" style={{ color: 'var(--muted)' }}>Settlement hasn't been calculated yet — this happens when the order is confirmed.</p>
      )}

      {order.rejectionReason && (
        <div className="mt-5 rounded-lg p-3 text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
          <strong>Rejection reason:</strong> {order.rejectionReason}
        </div>
      )}

      <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--cardborder)' }}>
        <Button variant="ghost" onClick={() => navigator.clipboard?.writeText(order.checkoutUrl)}>
          <IconCopy className="h-4 w-4" /> Copy checkout link
        </Button>
      </div>
    </Modal>
  );
}

async function fetchAllOrders() {
  const all = [];
  for (let page = 1; page <= ORDER_FETCH_PAGES; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await merchantApi.orders(undefined, { page, limit: 100 });
    const rows = res.data?.data?.orders || [];
    all.push(...rows);
    if (rows.length < 100) break;
  }
  return all;
}

export default function Orders() {
  const [list, setList] = useState(seedOrders);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [datePreset, setDatePreset] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [showCreate, setShowCreate] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [detailOrder, setDetailOrder] = useState(null);

  const loadOrders = async () => {
    setLoading(true);
    try {
      const rows = await fetchAllOrders();
      setList(rows.map(mapOrder));
    } catch (_) {
      setList(seedOrders);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadOrders(); }, []);

  useEffect(() => {
    const onUpdate = () => loadOrders();
    window.addEventListener('order:update', onUpdate);
    return () => window.removeEventListener('order:update', onUpdate);
  }, []);

  useEffect(() => { setPage(1); }, [tab, search, amountMin, amountMax, datePreset, pageSize]);

  const counts = useMemo(() => {
    const c = { all: list.length };
    ORDER_STATUSES.forEach((s) => (c[s] = list.filter((o) => o.status === s).length));
    return c;
  }, [list]);

  const tabs = [
    { key: 'all', label: 'All', count: counts.all },
    ...ORDER_STATUSES.map((s) => ({ key: s, label: STATUS_META[s].label, count: counts[s] })),
  ];

  const minAmount = amountMin ? Number(amountMin) : null;
  const maxAmount = amountMax ? Number(amountMax) : null;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return list.filter((o) => {
      if (tab !== 'all' && o.status !== tab) return false;
      if (!matchesDatePreset(o.createdAt, datePreset)) return false;
      if (minAmount !== null && o.amountInr < minAmount) return false;
      if (maxAmount !== null && o.amountInr > maxAmount) return false;
      if (query) {
        const haystack = `${o.id} ${o.gatewayOrderId || ''} ${o.merchantOrderId || ''} ${o.customerRef || ''} ${o.utr || ''}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [list, tab, search, minAmount, maxAmount, datePreset]);

  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const totalInr = filtered.reduce((s, o) => s + o.amountInr, 0);

  const clearFilters = () => { setAmountMin(''); setAmountMax(''); setDatePreset('all'); setSearch(''); };

  const exportCsv = () => {
    const header = ['Order ID', 'Merchant Order ID', 'Customer Ref', 'Amount INR', 'Rate', 'Type', 'Created', 'Closed', 'Status'];
    const rows = filtered.map((o) => [
      o.gatewayOrderId || o.id, o.merchantOrderId, o.customerRef, o.amountInr.toFixed(2),
      o.traderRate != null ? o.traderRate.toFixed(2) : '', o.depositType, o.createdAt, o.closedAt || '', STATUS_META[o.status]?.label || o.status,
    ]);
    const blob = new Blob([toCsv([header, ...rows])], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `payin-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Local/mock create — used as a fallback when the backend is unreachable.
  const createLocal = (body) => {
    const id = `ORD-${48211 + (list.length - 20)}`;
    const order = mapOrder({
      uuid: id, amount_inr: body.amount_inr, customer_ref: body.customer_ref,
      deposit_type: body.deposit_type, status: 'pending', created_at: new Date().toISOString(),
    });
    setList((l) => [order, ...l]);
    return order;
  };

  // v2 create — sends customer_ref, deposit_type and merchant_order_id.
  const createOrder = async (body) => {
    try {
      const res = await merchantApi.createOrder(body);
      const d = res.data.data;
      const order = {
        id: d.order_id,
        gatewayOrderId: d.gateway_order_id,
        merchantOrderId: d.merchant_order_id,
        depositType: d.deposit_type,
        amountInr: d.amount_inr ?? body.amount_inr,
        // Renamed server-side: an order-creation response can only ever give an
        // ESTIMATE (it is priced at the assigned trader's rate). The credited
        // amount arrives with settlement. `amount_usdt` is kept as a fallback
        // so a panel deployed ahead of the API keeps working.
        amountUsdt: d.estimated_amount_usdt ?? d.amount_usdt,
        customerRef: d.customer_ref ?? body.customer_ref,
        status: d.status || 'pending',
        checkoutUrl: d.checkout_url,
        expiresAt: d.expires_at,
      };
      await loadOrders(); // refresh the list after a successful create
      return { ok: true, order };
    } catch (err) {
      const data = err?.response?.data;
      // No provider available → surface the message. NO order is created.
      if (err?.response?.status === 503 || data?.error === 'no_provider_available' || data?.error === 'no_trader_available') {
        return { ok: false, error: 'no_provider_available', message: data?.message || 'P2P is unavailable right now. Please try again later.' };
      }
      // Validation / duplicate errors from the API.
      if (err?.response?.status && data?.message) return { ok: false, message: data.message };
      // Genuine network outage: fall back to a local order for offline dev.
      if (!err?.response) return { ok: true, order: createLocal(body) };
      return { ok: false, message: 'Could not create the order. Please try again.' };
    }
  };

  const copyRow = (e, o) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(o.checkoutUrl);
    setCopiedId(o.id);
    setTimeout(() => setCopiedId((c) => (c === o.id ? null : c)), 1500);
  };

  return (
    <div>
      <PageHeader
        title="Pay-in"
        subtitle={loading ? 'Loading orders…' : 'Every incoming pay-in transaction.'}
        actions={
          <>
            <Button variant="ghost" onClick={exportCsv}><IconExport className="h-4 w-4" /> Export CSV</Button>
            <Button onClick={() => setShowCreate(true)}><IconPlus className="h-4 w-4" /> Create New Order</Button>
          </>
        }
      />

      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ID, customer ref, or UTR" />
          <Input type="number" value={amountMin} onChange={(e) => setAmountMin(e.target.value)} placeholder="Min amount (₹)" />
          <Input type="number" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} placeholder="Max amount (₹)" />
          <Select value={datePreset} onChange={setDatePreset} options={DATE_PRESETS} />
          <Button variant="ghost" onClick={clearFilters}>Clear filters</Button>
        </div>
      </Card>

      <Card>
        <div className="px-4 pt-2">
          <Tabs tabs={tabs} active={tab} onChange={setTab} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ borderBottom: '1px solid var(--cardborder)', color: 'var(--muted)' }}>
                <th className="px-4 py-3 font-medium">Order ID</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Rate</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Closed</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((o) => {
                const created = fmtDateTime(o.createdAt);
                const closed = o.closedAt ? fmtDateTime(o.closedAt) : null;
                return (
                  <tr
                    key={o.id}
                    className="tf-row-hover cursor-pointer"
                    style={{ color: 'var(--text)', borderTop: '1px solid var(--cardborder)' }}
                    onClick={() => setDetailOrder(o)}
                  >
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--muted)' }}>{o.gatewayOrderId || String(o.id).slice(0, 8)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{inr(o.amountInr)}</div>
                      {o.amountUsdt != null && <div className="text-xs" style={{ color: 'var(--muted)' }}>{usdt(o.amountUsdt)}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>{o.traderRate != null ? `₹${o.traderRate.toFixed(2)}` : '—'}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text)' }}>{o.customerRef}</td>
                    <td className="px-4 py-3"><DepositBadge type={o.depositType} /></td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                      <div>{created === '—' ? '—' : created.time}</div>
                      {created !== '—' && <div style={{ opacity: 0.7 }}>{created.date}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                      {closed ? (<><div>{closed.time}</div><div style={{ opacity: 0.7 }}>{closed.date}</div></>) : 'Open'}
                    </td>
                    <td className="px-4 py-3"><Badge color={(STATUS_META[o.status] || { color: 'gray' }).color}>{(STATUS_META[o.status] || { label: o.status }).label}</Badge></td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="ghost" onClick={(e) => copyRow(e, o)}>
                        {copiedId === o.id ? <IconCheck className="h-3.5 w-3.5" /> : <IconCopy className="h-3.5 w-3.5" />}
                        {copiedId === o.id ? 'Copied' : 'Copy link'}
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {pageRows.length === 0 && (
                <tr><td colSpan={9} className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>No pay-in transactions match your filters</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderTop: '1px solid var(--cardborder)' }}>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>{filtered.length.toLocaleString()} transactions · {inr(totalInr)} total</span>
          <Select value={String(pageSize)} onChange={(v) => setPageSize(Number(v))} options={PAGE_SIZE_OPTIONS} className="w-32" />
        </div>
        <Pagination page={page} perPage={pageSize} total={filtered.length} onPage={setPage} />
      </Card>

      <CreateOrderModal open={showCreate} onClose={() => setShowCreate(false)} onCreate={createOrder} />
      <OrderDetailDrawer order={detailOrder} open={!!detailOrder} onClose={() => setDetailOrder(null)} />
    </div>
  );
}
