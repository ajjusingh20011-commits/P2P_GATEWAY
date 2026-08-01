import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Card, Badge, Button, SearchInput, Select, Tabs, Pagination, PageHeader, Modal, Field, InlineLoader } from '../components/ui';
import AdminIdPopover from '../components/AdminIdPopover';
import ConfirmModal from '../components/ConfirmModal';
import { inr, usdt } from '../utils/mock';
import { useApi } from '../hooks/useApi';
import { adminApi, orderApi } from '../services/api';
import { toast } from '../components/toast';

// Order System v2 lifecycle — the real 8-value enum (order.model.js), not the
// design's fictional 9-state list (Created/Routing/Assigned/Awaiting payment...).
const ORDER_STATUSES = ['pending', 'checkout_open', 'claimed_paid', 'under_review', 'success', 'failed', 'rejected', 'disputed'];

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

// confirm_engine is a real column (see mapping review) showing HOW an order
// was settled — admin manual review, trader self-confirm, or one of the
// matching-engine tiers. Not fabricated: only rendered when the backend
// actually set it.
const ENGINE_LABEL = {
  manual: 'Admin (legacy manual)',
  admin_manual: 'Admin manual review',
  trader_manual: 'Trader self-confirm',
  auto_tier0: 'Matching engine · exact UTR',
  auto_tier1: 'Matching engine · UTR mismatch',
  auto_tier2: 'Matching engine · amount/time match',
};

// Map a backend order record onto the shape the table/modal expect. No
// `method` field exists on this list endpoint's response at all, so unlike
// an earlier version of this page, nothing here fabricates one.
function mapOrder(o) {
  const status = ORDER_STATUSES.includes(o.status) ? o.status : 'pending';
  return {
    id: o.uuid || `ORD-${o.id}`,
    numericId: o.id,
    gatewayOrderId: o.gateway_order_id || null,
    merchantOrderId: o.merchant_order_id || null,
    customerRef: o.customer_ref || '—',
    depositType: o.deposit_type || null,
    merchant: o.merchant?.business_name || '—',
    merchantId: o.merchant?.id ?? null,
    amountInr: Number(o.amount_inr) || 0,
    amountUsdt: Number(o.amount_usdt) || 0,
    trader: o.trader?.id ? `#${o.trader.id}` : null,
    createdAt: o.created_at || null,
    claimedPaidAt: o.claimed_paid_at || null,
    reviewedAt: o.reviewed_at || null,
    confirmedAt: o.confirmed_at || null,
    rejectedAt: o.rejected_at || null,
    confirmEngine: o.confirm_engine || null,
    confirmationType: o.confirmation_type || null,
    rejectionReason: o.rejection_reason || null,
    utr: o.utr_number || null,
    status,
  };
}

function DepositBadge({ type }) {
  if (!type) return <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>;
  return <Badge color={type === 'FTD' ? 'green' : 'sky'}>{type}</Badge>;
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });
}

const OVERRIDE_OPTIONS = [
  { value: 'success', label: 'Force success' },
  { value: 'failed', label: 'Force fail' },
  { value: 'rejected', label: 'Force reject' },
  { value: 'disputed', label: 'Flag dispute' },
];

const canReview = (s) => s === 'claimed_paid';
const canSettle = (s) => s === 'claimed_paid' || s === 'under_review';

function OrderActions({ order, busy, onReview, onConfirmAction, size = 'sm' }) {
  if (!canSettle(order.status)) return <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {canReview(order.status) && (
        <Button variant="ghost" size={size} disabled={busy} onClick={() => onReview(order)}>Review</Button>
      )}
      <Button variant="success" size={size} disabled={busy} onClick={() => onConfirmAction(order, 'confirm')}>Confirm</Button>
      <Button variant="ghost" size={size} disabled={busy} onClick={() => onConfirmAction(order, 'reject')}>Reject</Button>
      <Button variant="danger" size={size} disabled={busy} onClick={() => onConfirmAction(order, 'dispute')}>Dispute</Button>
    </div>
  );
}

const PER_PAGE = 10;

export default function Orders() {
  const [list, setList] = useState([]);
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [merchantFilter, setMerchantFilter] = useState('All');
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState(null);
  const [confirming, setConfirming] = useState(null); // { order, action: 'confirm'|'reject'|'dispute' }
  const [overrideValue, setOverrideValue] = useState('success');
  const [busy, setBusy] = useState(false);

  const { data: apiData, loading, refetch } = useApi(() => adminApi.listOrders({ page: 1, limit: 200 }), { fallback: null });
  useEffect(() => {
    if (apiData?.orders) setList(apiData.orders.map(mapOrder));
  }, [apiData]);

  // Real-time: refetch when a socket-driven order:update fires.
  useEffect(() => {
    const onUpdate = () => { if (typeof refetch === 'function') refetch(); };
    window.addEventListener('order:update', onUpdate);
    return () => window.removeEventListener('order:update', onUpdate);
  }, [refetch]);

  const review = async (order) => {
    setBusy(true);
    try {
      await adminApi.reviewOrder(order.numericId);
      setList((l) => l.map((o) => (o.id === order.id ? { ...o, status: 'under_review' } : o)));
      toast(`Order ${order.id.slice(0, 8)} → under review`, 'info');
      if (typeof refetch === 'function') refetch();
    } catch (err) {
      toast(`Failed to review order: ${err?.response?.data?.message || err.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const runConfirmedAction = async () => {
    if (!confirming) return;
    const { order, action } = confirming;
    const nextStatus = { confirm: 'success', reject: 'rejected', dispute: 'disputed' }[action];
    setBusy(true);
    try {
      if (action === 'confirm') await adminApi.confirmOrderV2(order.numericId);
      else if (action === 'reject') await adminApi.rejectOrderV2(order.numericId, 'Payment not received');
      else if (action === 'dispute') await adminApi.disputeOrderV2(order.numericId, 'Flagged by admin');
      setList((l) => l.map((o) => (o.id === order.id ? { ...o, status: nextStatus } : o)));
      toast(`Order ${order.id.slice(0, 8)} → ${nextStatus}`, action === 'confirm' ? 'success' : 'error');
      if (typeof refetch === 'function') refetch();
    } catch (err) {
      const msg = err?.response?.data?.message || err?.response?.data?.error?.message || err.message || 'Action failed';
      toast(`Failed to ${action} order: ${msg}`, 'error');
    } finally {
      setBusy(false);
      setConfirming(null);
      setViewing(null);
    }
  };

  const applyOverride = async (order, status) => {
    setBusy(true);
    try {
      if (status === 'disputed') await orderApi.disputeOrder(order.numericId, 'Flagged by admin');
      else await orderApi.overrideOrder(order.numericId, status);
      setList((l) => l.map((o) => (o.id === order.id ? { ...o, status } : o)));
      toast(`Order ${order.id.slice(0, 8)} → ${status}`, status === 'success' ? 'success' : 'error');
      if (typeof refetch === 'function') refetch();
    } catch (err) {
      toast(`Override failed: ${err?.response?.data?.message || err.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const merchantOptions = useMemo(() => {
    const names = Array.from(new Set(list.map((o) => o.merchant).filter((m) => m && m !== '—')));
    return ['All', ...names];
  }, [list]);

  const counts = useMemo(() => {
    const c = { all: list.length };
    ORDER_STATUSES.forEach((s) => { c[s] = list.filter((o) => o.status === s).length; });
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
      if (merchantFilter !== 'All' && o.merchant !== merchantFilter) return false;
      if (query
        && !o.id.toLowerCase().includes(query)
        && !(o.gatewayOrderId || '').toLowerCase().includes(query)
        && !(o.customerRef || '').toLowerCase().includes(query)
        && !o.merchant.toLowerCase().includes(query)
        && !String(o.amountInr).includes(query)) return false;
      return true;
    });
  }, [list, tab, merchantFilter, q]);

  const pageRows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const viewingLive = viewing ? list.find((o) => o.id === viewing.id) : null;

  const exportCsv = () => {
    const header = ['ID', 'Merchant', 'Customer', 'Amount INR', 'Type', 'Trader', 'Status', 'Created'];
    const rows = filtered.map((o) => [o.id, o.merchant, o.customerRef, o.amountInr, o.depositType || '', o.trader || '', o.status, o.createdAt || '']);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `admin-pay-in-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const changeTab = (k) => { setTab(k); setPage(1); };

  const confirmCopy = {
    confirm: { title: 'Confirm this payment?', tone: 'primary', label: 'Confirm payment', desc: (o) => `Order ${o.id.slice(0, 8)}… will be marked Success and settlement will proceed. This credits the merchant and pays the trader — it cannot be undone once issued.` },
    reject: { title: 'Reject this order?', tone: 'danger', label: 'Reject', desc: (o) => `Order ${o.id.slice(0, 8)}… will be marked Rejected and the trader released. The customer will need to retry.` },
    dispute: { title: 'Open a dispute?', tone: 'danger', label: 'Open dispute', desc: (o) => `Order ${o.id.slice(0, 8)}… will move to Disputed and route to the Disputes queue for investigation.` },
  };

  return (
    <div>
      <PageHeader
        title="Pay-in"
        subtitle="Review live payment states, proof and settlement outcomes"
        actions={
          <>
            {loading && <InlineLoader />}
            <Button variant="ghost" size="sm" onClick={exportCsv}><Download size={14} className="mr-1" />Export CSV</Button>
          </>
        }
      />

      <Card className="mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search by order ID, merchant, amount…" className="sm:max-w-xs" />
        <Select value={merchantFilter} onChange={(v) => { setMerchantFilter(v); setPage(1); }} options={merchantOptions.map((m) => ({ value: m, label: m }))} className="sm:w-56" />
      </Card>

      <Card className="mb-4 p-2">
        <Tabs tabs={tabs} active={tab} onChange={changeTab} />
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ borderBottom: '1px solid var(--cardborder)', color: 'var(--muted)' }}>
                <th className="w-10 px-4 py-3" />
                <th className="px-4 py-3 font-medium">Merchant / Customer</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Trader</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr><td colSpan={8} className="py-14 text-center text-sm" style={{ color: 'var(--muted)' }}>{loading ? 'Loading…' : 'No orders match these filters.'}</td></tr>
              ) : (
                pageRows.map((o) => (
                  <tr key={o.id} className="tf-row-hover cursor-pointer" style={{ borderTop: '1px solid var(--cardborder)' }} onClick={() => setViewing(o)}>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <AdminIdPopover
                        rows={[
                          { label: 'Transaction ID', value: o.numericId },
                          { label: 'UUID', value: o.id },
                          { label: 'Gateway Order ID', value: o.gatewayOrderId },
                          { label: 'Merchant Order ID', value: o.merchantOrderId },
                          { label: 'Customer Reference', value: o.customerRef },
                        ]}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium" style={{ color: 'var(--text)', margin: 0 }}>{o.merchant}</p>
                      <p className="font-mono" style={{ color: 'var(--muted)', fontSize: 11, margin: '2px 0 0' }}>{o.customerRef}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium" style={{ color: 'var(--text)' }}>{inr(o.amountInr)}</div>
                      {o.amountUsdt > 0 && <div style={{ color: 'var(--muted)', fontSize: 11 }}>{usdt(o.amountUsdt)}</div>}
                    </td>
                    <td className="px-4 py-3"><DepositBadge type={o.depositType} /></td>
                    <td className="px-4 py-3" style={{ color: 'var(--muted)' }}>{o.trader || 'Unassigned'}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--muted)', fontSize: 12 }}>{fmtDateTime(o.createdAt)}</td>
                    <td className="px-4 py-3"><Badge color={meta(o.status).color}>{meta(o.status).label}</Badge></td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <OrderActions order={o} busy={busy} onReview={review} onConfirmAction={(ord, action) => setConfirming({ order: ord, action })} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div style={{ borderTop: '1px solid var(--cardborder)' }}>
          <Pagination page={page} perPage={PER_PAGE} total={filtered.length} onPage={setPage} />
        </div>
      </Card>

      {/* Detail modal — real Lifecycle section built from real timestamp
          columns + confirm_engine provenance, no fabricated routing/matched
          fields. */}
      <Modal
        open={!!viewingLive}
        onClose={() => setViewing(null)}
        title={viewingLive ? `Order ${viewingLive.gatewayOrderId || viewingLive.id.slice(0, 8)}` : ''}
        subtitle={viewingLive ? `${viewingLive.merchant} · ${inr(viewingLive.amountInr)}` : ''}
        size="xl"
        footer={
          viewingLive && canSettle(viewingLive.status) ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>Manual override:</span>
                <Select value={overrideValue} onChange={setOverrideValue} options={OVERRIDE_OPTIONS} className="w-40" />
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => applyOverride(viewingLive, overrideValue)}>Apply</Button>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="danger" size="sm" disabled={busy} onClick={() => setConfirming({ order: viewingLive, action: 'reject' })}>Reject</Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming({ order: viewingLive, action: 'dispute' })}>Open dispute</Button>
                <Button variant="success" size="sm" disabled={busy} onClick={() => setConfirming({ order: viewingLive, action: 'confirm' })}>Confirm payment</Button>
              </div>
            </div>
          ) : null
        }
      >
        {viewingLive && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Amount INR">{inr(viewingLive.amountInr)}</Field>
              <Field label="Amount USDT">{viewingLive.amountUsdt > 0 ? usdt(viewingLive.amountUsdt) : '—'}</Field>
              <Field label="Customer" mono>{viewingLive.customerRef}</Field>
              <Field label="Type"><DepositBadge type={viewingLive.depositType} /></Field>
              <Field label="Merchant">{viewingLive.merchant}</Field>
              <Field label="Trader">{viewingLive.trader || 'Unassigned'}</Field>
              <Field label="Status"><Badge color={meta(viewingLive.status).color}>{meta(viewingLive.status).label}</Badge></Field>
              <Field label="UTR" mono>{viewingLive.utr || 'Not submitted'}</Field>
              {viewingLive.rejectionReason && <Field label="Reason">{viewingLive.rejectionReason}</Field>}
            </div>

            <div>
              <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', margin: '0 0 10px' }}>Lifecycle</h3>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field label="Order created">{fmtDateTime(viewingLive.createdAt)}</Field>
                <Field label="Claimed paid">{fmtDateTime(viewingLive.claimedPaidAt)}</Field>
                <Field label="Sent to review">{fmtDateTime(viewingLive.reviewedAt)}</Field>
                <Field label="Confirmed">{fmtDateTime(viewingLive.confirmedAt)}</Field>
                <Field label="Confirmed via">{viewingLive.confirmEngine ? (ENGINE_LABEL[viewingLive.confirmEngine] || viewingLive.confirmEngine) : '—'}</Field>
                <Field label="Rejected">{fmtDateTime(viewingLive.rejectedAt)}</Field>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={!!confirming}
        title={confirming ? confirmCopy[confirming.action].title : ''}
        description={confirming ? confirmCopy[confirming.action].desc(confirming.order) : ''}
        tone={confirming ? confirmCopy[confirming.action].tone : 'primary'}
        confirmLabel={confirming ? confirmCopy[confirming.action].label : 'Confirm'}
        busy={busy}
        onConfirm={runConfirmedAction}
        onClose={() => setConfirming(null)}
      />
    </div>
  );
}
