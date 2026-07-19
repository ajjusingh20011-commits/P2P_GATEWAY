import { useEffect, useMemo, useState } from 'react';
import { Card, Badge, Button, Tabs, Pagination, PageHeader, Modal, Input } from '../components/ui';
import { IconPlus, IconCopy, IconCheck } from '../components/icons';
import { orders as seedOrders, inr, usdt, checkoutUrl } from '../utils/mock';
import { merchantApi } from '../services/api';

const PER_PAGE = 10;

// Order System v2 lifecycle.
const ORDER_STATUSES = ['pending', 'checkout_open', 'claimed_paid', 'under_review', 'success', 'failed', 'rejected', 'disputed'];
const STATUS_META = {
  pending: { label: 'Pending', color: 'gray' },
  checkout_open: { label: 'Checkout Open', color: 'sky' },
  claimed_paid: { label: 'Claimed Paid', color: 'amber' },
  under_review: { label: 'Under Review', color: 'amber' },
  success: { label: 'Success', color: 'green' },
  failed: { label: 'Failed', color: 'gray' },
  rejected: { label: 'Rejected', color: 'red' },
  disputed: { label: 'Disputed', color: 'amber' },
};

// FTD green / STD blue.
function DepositBadge({ type }) {
  if (!type) return <span className="text-xs text-gray-500">—</span>;
  return <Badge color={type === 'FTD' ? 'green' : 'sky'}>{type}</Badge>;
}

// Normalize an API order into the shape the table renders.
function mapOrder(o) {
  return {
    id: o.uuid || o.id,
    gatewayOrderId: o.gateway_order_id || null,
    merchantOrderId: o.merchant_order_id || null,
    depositType: o.deposit_type || null,
    amountInr: o.amount_inr,
    customerRef: o.customer_ref,
    status: o.status,
    createdAt: o.created_at,
    checkoutUrl: o.checkout_url || checkoutUrl(o.uuid || o.id),
  };
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
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10">
            <svg viewBox="0 0 24 24" className="h-8 w-8 text-red-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-white">P2P is unavailable right now</h3>
          <p className="max-w-xs text-sm text-gray-400">{errorMsg}</p>
        </div>
      ) : !created ? (
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">Amount (INR)</label>
            <Input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 5000" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">Customer Reference <span className="text-red-400">*</span></label>
            <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. USER_123" />
            <p className="mt-1 text-xs text-gray-500">Identifies the customer. FTD/STD is auto-detected from this.</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">Deposit Type</label>
            <div className="flex gap-4">
              {[['FTD', 'FTD — First Time Deposit'], ['STD', 'STD — Standard Deposit']].map(([v, l]) => (
                <label key={v} className="flex items-center gap-2 text-sm text-gray-200">
                  <input type="radio" name="deposit-type" value={v} checked={depositType === v} onChange={() => setDepositType(v)} className="accent-indigo-500" />
                  {l}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-gray-500">The server auto-detects and corrects this from the customer's history.</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">Merchant Order ID <span className="text-gray-600">(optional)</span></label>
            <Input value={merchantOrderId} onChange={(e) => setMerchantOrderId(e.target.value)} placeholder="e.g. ORD_001" />
          </div>
          {fieldError && <p className="text-sm text-red-400">{fieldError}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            <IconCheck className="h-5 w-5 flex-shrink-0" />
            <span>Order <strong>{created.gatewayOrderId || created.id}</strong> for {inr(created.amountInr)} is ready.</span>
          </div>
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-gray-800 bg-gray-950 px-4 py-3 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Gateway Order ID</p>
              <p className="mt-0.5 font-mono text-xs font-medium text-emerald-400">{created.gatewayOrderId || '—'}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Deposit Type</p>
              <p className="mt-0.5"><DepositBadge type={created.depositType} /></p>
            </div>
            {created.merchantOrderId && (
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Merchant Order ID</p>
                <p className="mt-0.5 font-mono text-xs text-gray-300">{created.merchantOrderId}</p>
              </div>
            )}
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Amount (INR)</p>
              <p className="mt-0.5 font-medium text-gray-100">{inr(created.amountInr)}</p>
            </div>
            {created.amountUsdt != null && (
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Amount (USDT)</p>
                <p className="mt-0.5 font-medium text-gray-100">{usdt(created.amountUsdt)}</p>
              </div>
            )}
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Order ID</p>
              <p className="mt-0.5 font-mono text-xs text-gray-300">{created.id}</p>
            </div>
            {created.expiresAt && (
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Expires</p>
                <p className="mt-0.5 text-xs text-gray-300">{new Date(created.expiresAt).toLocaleString()}</p>
              </div>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">Checkout URL</label>
            <code className="block truncate rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-xs text-gray-300">
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
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
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

export default function Orders() {
  const [list, setList] = useState(seedOrders);
  const [tab, setTab] = useState('all');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [loading, setLoading] = useState(true);

  // Load orders from the backend; keep the mock seed as fallback on error.
  const loadOrders = async () => {
    setLoading(true);
    try {
      const { orders } = (await merchantApi.orders()).data.data;
      setList((orders || []).map(mapOrder));
    } catch (_) {
      setList(seedOrders);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, []);

  // Live order updates: patch the matching order's status in local state.
  useEffect(() => {
    const onUpdate = (e) => {
      const { order_id, status } = e.detail || {};
      if (!order_id) return;
      setList((l) => {
        const found = l.some((o) => o.id === order_id);
        if (!found) { loadOrders(); return l; }
        return l.map((o) => (o.id === order_id ? { ...o, status } : o));
      });
    };
    window.addEventListener('order:update', onUpdate);
    return () => window.removeEventListener('order:update', onUpdate);
  }, []);

  const counts = useMemo(() => {
    const c = { all: list.length };
    ORDER_STATUSES.forEach((s) => (c[s] = list.filter((o) => o.status === s).length));
    return c;
  }, [list]);

  const tabs = [
    { key: 'all', label: 'All', count: counts.all },
    ...ORDER_STATUSES.map((s) => ({ key: s, label: STATUS_META[s].label, count: counts[s] })),
  ];

  const filtered = useMemo(() => (tab === 'all' ? list : list.filter((o) => o.status === tab)), [list, tab]);
  const pageRows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const changeTab = (k) => { setTab(k); setPage(1); };

  // Local/mock create — used as a fallback when the backend is unreachable.
  const createLocal = (body) => {
    const id = `ORD-${48211 + (list.length - 20)}`;
    const order = {
      id,
      gatewayOrderId: null,
      depositType: body.deposit_type,
      amountInr: body.amount_inr,
      customerRef: body.customer_ref,
      status: 'pending',
      createdAt: '(just now)',
      checkoutUrl: checkoutUrl(id),
    };
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
        amountUsdt: d.amount_usdt,
        customerRef: d.customer_ref ?? body.customer_ref,
        status: d.status || 'pending',
        createdAt: '(just now)',
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

  const copyRow = (o) => {
    navigator.clipboard?.writeText(o.checkoutUrl);
    setCopiedId(o.id);
    setTimeout(() => setCopiedId((c) => (c === o.id ? null : c)), 1500);
  };

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle={loading ? 'Loading orders…' : 'Payment orders and checkout links'}
        actions={<Button onClick={() => setShowCreate(true)}><IconPlus className="h-4 w-4" /> Create New Order</Button>}
      />

      <Card>
        <div className="px-4 pt-2">
          <Tabs tabs={tabs} active={tab} onChange={changeTab} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 font-medium">Gateway ID</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Customer Ref</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {pageRows.map((o) => (
                <tr key={o.id} className="text-gray-200 hover:bg-gray-800/40">
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{o.gatewayOrderId || String(o.id).slice(0, 8)}</td>
                  <td className="px-4 py-3 font-medium">{inr(o.amountInr)}</td>
                  <td className="px-4 py-3 text-gray-300">{o.customerRef}</td>
                  <td className="px-4 py-3"><DepositBadge type={o.depositType} /></td>
                  <td className="px-4 py-3"><Badge color={(STATUS_META[o.status] || { color: 'gray' }).color}>{(STATUS_META[o.status] || { label: o.status }).label}</Badge></td>
                  <td className="px-4 py-3 text-xs text-gray-400">{o.createdAt}</td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="ghost" onClick={() => copyRow(o)}>
                      {copiedId === o.id ? <IconCheck className="h-3.5 w-3.5" /> : <IconCopy className="h-3.5 w-3.5" />}
                      {copiedId === o.id ? 'Copied' : 'Copy link'}
                    </Button>
                  </td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr><td colSpan={7} className="py-10 text-center text-sm text-gray-500">No orders in this view</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-gray-800">
          <Pagination page={page} perPage={PER_PAGE} total={filtered.length} onPage={setPage} />
        </div>
      </Card>

      <CreateOrderModal open={showCreate} onClose={() => setShowCreate(false)} onCreate={createOrder} />
    </div>
  );
}
