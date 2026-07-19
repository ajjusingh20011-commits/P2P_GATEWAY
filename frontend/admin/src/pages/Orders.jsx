import { useEffect, useMemo, useState } from 'react';
import { Card, Badge, Button, SearchInput, Tabs, Pagination, PageHeader, Modal, Field, Select, InlineLoader } from '../components/ui';
import { orders as seedOrders, ACCOUNT_TYPES, inr, usdt } from '../utils/mock';
import { useApi } from '../hooks/useApi';
import { adminApi, orderApi } from '../services/api';
import { toast } from '../components/toast';

// Order System v2 lifecycle.
const ORDER_STATUSES = ['pending', 'checkout_open', 'claimed_paid', 'under_review', 'success', 'failed', 'rejected', 'disputed'];

// Map a backend order record onto the shape the table/modal expect. Fields the
// backend doesn't provide (timeline, detection engines, raw SMS) default empty.
function mapOrder(o) {
  const method = ACCOUNT_TYPES[o.method] ? o.method : 'gpay';
  const status = ORDER_STATUSES.includes(o.status) ? o.status : 'pending';
  return {
    id: o.uuid || `ORD-${o.id}`,
    gatewayOrderId: o.gateway_order_id || null,
    merchantOrderId: o.merchant_order_id || null,
    customerRef: o.customer_ref || '—',
    depositType: o.deposit_type || null,
    merchant: o.merchant?.business_name || '—',
    merchantId: o.merchant?.id ?? null,
    amountInr: Number(o.amount_inr) || 0,
    amountUsdt: Number(o.amount_usdt) || 0,
    trader: o.trader?.id ? `#${o.trader.id}` : null,
    traderId: o.trader?.id ?? null,
    upiId: o.paymentDetail?.upi_id || null,
    method,
    status,
    createdAt: o.created_at || '—',
    claimedPaidAt: o.claimed_paid_at || null,
    confirmationType: o.confirmation_type || null,
    rejectionReason: o.rejection_reason || null,
    confidence: null,
    engines: [],
    rawSms: null,
    utr: o.utr_number || null,
    timeline: [{ at: o.created_at || '—', label: 'Order created', by: o.merchant?.business_name || '—', done: true }],
  };
}

// FTD green / STD blue.
function DepositBadge({ type }) {
  if (!type) return <span className="text-xs text-gray-600">—</span>;
  return <Badge color={type === 'FTD' ? 'green' : 'sky'}>{type}</Badge>;
}

const PER_PAGE = 15;

// Short order id (first 8 chars) with a copy-to-clipboard button.
function CopyId({ id }) {
  const [copied, setCopied] = useState(false);
  const full = String(id || '');
  const copy = (e) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(full);
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  };
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[11px] text-gray-400">{full.slice(0, 8) || '—'}…</span>
      <button onClick={copy} title="Copy full ID" className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-200">
        {copied ? '✓' : '⎘'}
      </button>
    </div>
  );
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
};
const meta = (s) => STATUS_META[s] || { color: 'gray', label: s || '—' };

const OVERRIDE_OPTIONS = [
  { value: 'success', label: 'Force success' },
  { value: 'failed', label: 'Force fail' },
  { value: 'rejected', label: 'Force reject' },
  { value: 'disputed', label: 'Flag dispute' },
];

// Which admin actions are available for a given status.
const canReview = (s) => s === 'claimed_paid';
const canSettle = (s) => s === 'claimed_paid' || s === 'under_review';

// Row/modal action buttons per status.
function OrderActions({ order, busy, onAction, size = 'sm' }) {
  if (!canSettle(order.status)) return <span className="text-xs text-gray-600">—</span>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {canReview(order.status) && (
        <Button variant="ghost" size={size} disabled={busy} onClick={() => onAction('review', order.id)}>🔍 Review</Button>
      )}
      <Button variant="success" size={size} disabled={busy} onClick={() => onAction('confirm', order.id)}>✅ Confirm</Button>
      <Button variant="ghost" size={size} disabled={busy} onClick={() => onAction('reject', order.id)}>❌ Reject</Button>
      <Button variant="danger" size={size} disabled={busy} onClick={() => onAction('dispute', order.id)}>⚠️ Dispute</Button>
    </div>
  );
}

function OrderModal({ order, onClose, onOverride, onAction, busy }) {
  const [override, setOverride] = useState('confirmed');
  if (!order) return null;
  return (
    <Modal
      open={!!order}
      onClose={onClose}
      size="xl"
      title={`Order ${order.gatewayOrderId || order.id}`}
      subtitle={`${order.merchant} · ${inr(order.amountInr)}`}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <OrderActions order={order} busy={busy} onAction={onAction} />
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Manual override:</span>
            <Select value={override} onChange={setOverride} options={OVERRIDE_OPTIONS} className="w-40" />
            <Button variant="danger" size="sm" disabled={busy} onClick={() => { onOverride(order.id, override); }}>Apply</Button>
            <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Gateway ID" mono>{order.gatewayOrderId || '—'}</Field>
          <Field label="Merchant Order ID" mono>{order.merchantOrderId || '—'}</Field>
          <Field label="Customer" mono>{order.customerRef}</Field>
          <Field label="Type"><DepositBadge type={order.depositType} /></Field>
          <Field label="Status"><Badge color={meta(order.status).color}>{meta(order.status).label}</Badge></Field>
          <Field label="Amount INR">{inr(order.amountInr)}</Field>
          <Field label="Amount USDT">{usdt(order.amountUsdt)}</Field>
          <Field label="Account" mono>{order.upiId || '—'}</Field>
          <Field label="Merchant">{order.merchant}</Field>
          <Field label="Trader">{order.trader || '—'}</Field>
          <Field label="Created">{order.createdAt}</Field>
          <Field label="Claimed paid at">{order.claimedPaidAt ? new Date(order.claimedPaidAt).toLocaleString() : '—'}</Field>
          <Field label="Confirmation type">{order.confirmationType ? order.confirmationType.toUpperCase() : '—'}</Field>
          <Field label="UTR" mono>{order.utr || '—'}</Field>
          {order.rejectionReason && <Field label="Reason">{order.rejectionReason}</Field>}
        </div>

        {/* Same-amount lock context — reassures the reviewer this is unambiguous. */}
        {order.upiId && (
          <p className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-xs text-sky-300">
            ℹ️ Only one active {inr(order.amountInr)} order is allowed on {order.upiId} at a time — this is that order.
          </p>
        )}

        {/* Timeline */}
        <section>
          <h3 className="mb-3 text-sm font-semibold text-white">Order Timeline</h3>
          <ol className="relative space-y-4 border-l border-gray-800 pl-6">
            {order.timeline.map((step, i) => (
              <li key={i} className="relative">
                <span className={`absolute -left-[27px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 ${step.done ? 'border-emerald-500 bg-emerald-500' : 'border-gray-700 bg-gray-900'}`} />
                <p className={`text-sm font-medium ${step.done ? 'text-gray-100' : 'text-gray-500'}`}>{step.label}</p>
                <p className="text-xs text-gray-500">{step.at} · {step.by}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Detection engines + confidence */}
        <section>
          <h3 className="mb-3 text-sm font-semibold text-white">Payment Detection</h3>
          {order.engines.length === 0 ? (
            <p className="rounded-lg border border-gray-800 bg-gray-950 p-4 text-sm text-gray-500">No payment detected for this order yet.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-950 p-4">
                <span className="text-xs text-gray-500">Confidence score</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-800">
                  <div className={`h-full rounded-full ${order.confidence >= 80 ? 'bg-emerald-500' : order.confidence >= 60 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${order.confidence}%` }} />
                </div>
                <span className="text-sm font-semibold text-gray-100">{order.confidence}%</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {order.engines.map((e) => (
                  <Badge key={e.name} color={e.score >= 60 ? 'green' : 'amber'}>{e.name} · {e.score}%</Badge>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Raw SMS */}
        {order.rawSms && (
          <section>
            <h3 className="mb-3 text-sm font-semibold text-white">Raw SMS / Notification Data</h3>
            <pre className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-950 p-4 font-mono text-xs text-gray-300">{order.rawSms}</pre>
          </section>
        )}
      </div>
    </Modal>
  );
}

export default function Orders() {
  const [list, setList] = useState(seedOrders);
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);

  const [busy, setBusy] = useState(false);

  // Load orders from the backend; keep the mock seed as fallback on error.
  const { data: apiData, loading, refetch } = useApi(() => adminApi.listOrders(), { fallback: null });
  useEffect(() => {
    if (apiData?.orders) setList(apiData.orders.map(mapOrder));
  }, [apiData]);

  // Real-time: refetch the list when a socket-driven order:update fires so new
  // paid orders (and status changes) appear without a manual reload.
  useEffect(() => {
    const onUpdate = () => { if (typeof refetch === 'function') refetch(); };
    window.addEventListener('order:update', onUpdate);
    return () => window.removeEventListener('order:update', onUpdate);
  }, [refetch]);

  // Order lifecycle actions backed by the real API. On success, patch the
  // order's status in local state and toast the outcome.
  // v2 review/settlement actions.
  const runAction = async (action, id) => {
    const nextStatus = { review: 'under_review', confirm: 'success', reject: 'rejected', dispute: 'disputed' }[action];
    setBusy(true);
    try {
      if (action === 'review') await adminApi.reviewOrder(id);
      else if (action === 'confirm') await adminApi.confirmOrderV2(id);
      else if (action === 'reject') await adminApi.rejectOrderV2(id, 'Payment not received');
      else if (action === 'dispute') await adminApi.disputeOrderV2(id, 'Flagged by admin');
      setList((l) => l.map((o) => (o.id === id ? { ...o, status: nextStatus } : o)));
      toast(`Order → ${nextStatus}`, action === 'confirm' ? 'success' : action === 'review' ? 'info' : 'error');
      if (typeof refetch === 'function') refetch();
    } catch (err) {
      const msg = err?.response?.data?.message || err?.response?.data?.error?.message || err?.message || 'Action failed';
      toast(`Failed to ${action} order: ${msg}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const counts = useMemo(() => {
    const c = { all: list.length };
    ORDER_STATUSES.forEach((s) => (c[s] = list.filter((o) => o.status === s).length));
    return c;
  }, [list]);

  const tabs = [
    { key: 'all', label: 'All', count: counts.all },
    ...ORDER_STATUSES.map((s) => ({ key: s, label: meta(s).label, count: counts[s] })),
  ];

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return list.filter((o) => {
      if (tab !== 'all' && o.status !== tab) return false;
      if (query
        && !o.id.toLowerCase().includes(query)
        && !(o.gatewayOrderId || '').toLowerCase().includes(query)
        && !(o.customerRef || '').toLowerCase().includes(query)
        && !o.merchant.toLowerCase().includes(query)
        && !String(o.amountInr).includes(query)) return false;
      return true;
    });
  }, [list, tab, q]);

  const pageRows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const selectedLive = selected ? list.find((o) => o.id === selected.id) : null;

  const override = async (id, status) => {
    setBusy(true);
    try {
      if (status === 'disputed') await orderApi.disputeOrder(id, 'Flagged by admin');
      else await orderApi.overrideOrder(id, status);
      setList((l) => l.map((o) => (o.id === id ? { ...o, status } : o)));
      toast(`Order ${id} → ${status}`, status === 'confirmed' ? 'success' : 'error');
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Override failed';
      toast(`Failed to override order: ${msg}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const changeTab = (k) => { setTab(k); setPage(1); };

  return (
    <div>
      <PageHeader title="Orders" subtitle="All payment orders across merchants" actions={loading ? <InlineLoader /> : null} />

      <Card className="mb-4 p-4">
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search by Order ID, merchant, or amount" />
      </Card>

      <Card>
        <div className="px-4 pt-2">
          <Tabs tabs={tabs} active={tab} onChange={changeTab} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 font-medium">Gateway ID</th>
                <th className="px-4 py-3 font-medium">Merchant</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Trader</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {pageRows.map((o) => (
                <tr key={o.id} className="cursor-pointer text-gray-200 hover:bg-gray-800/40" onClick={() => setSelected(o)}>
                  <td className="px-4 py-3">
                    {o.gatewayOrderId
                      ? <span className="font-mono text-[11px] text-gray-300">{o.gatewayOrderId}</span>
                      : <CopyId id={o.id} />}
                  </td>
                  <td className="px-4 py-3">{o.merchant}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-300">{o.customerRef}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{inr(o.amountInr)}</div>
                    <div className="text-xs text-gray-500">{usdt(o.amountUsdt)}</div>
                  </td>
                  <td className="px-4 py-3"><DepositBadge type={o.depositType} /></td>
                  <td className="px-4 py-3 text-gray-300">{o.trader || <span className="text-gray-600">Unassigned</span>}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{o.createdAt}</td>
                  <td className="px-4 py-3"><Badge color={meta(o.status).color}>{meta(o.status).label}</Badge></td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="space-y-1.5">
                      {o.utr && canSettle(o.status) && (
                        <div className="text-xs text-gray-400">UTR: <span className="font-mono text-gray-200">{o.utr}</span></div>
                      )}
                      <OrderActions order={o} busy={busy} onAction={runAction} />
                    </div>
                  </td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr><td colSpan={9} className="py-10 text-center text-sm text-gray-500">No data yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-gray-800">
          <Pagination page={page} perPage={PER_PAGE} total={filtered.length} onPage={setPage} />
        </div>
      </Card>

      <OrderModal order={selectedLive} onClose={() => setSelected(null)} onOverride={override} onAction={runAction} busy={busy} />
    </div>
  );
}
