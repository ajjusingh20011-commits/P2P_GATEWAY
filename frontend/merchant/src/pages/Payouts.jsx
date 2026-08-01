import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Badge, Button, Input, Select, Tabs, Pagination, PageHeader, Modal } from '../components/ui';
import { IconExport, IconCopy } from '../components/icons';
import { merchantApi } from '../services/api';
import { inr, usdt } from '../utils/mock';

/*
  Merchant Payout — create a payout request (send INR to a recipient) and
  track it as a trader processes it and the admin settles it. Isolated from
  the pay-in/order flow. Uses the shared merchant theme (tf-* / ui components).

  NOTE on the design reference (MaxPayDesign's Payout.tsx): its data model is
  "merchant approves a customer withdrawal request" (an `awaiting_approval`
  status, Approve/Cancel actions in the detail modal). That status and those
  actions have no equivalent here — the real PayoutRequest enum (see
  payoutRequest.model.js) is awaiting_processing/in_processing/
  awaiting_settlement/settlement_completed/canceled/dispute, and this page's
  real flow is the merchant CREATING a payout request that a trader then
  processes. This file adapts the design's list/filter/table chrome onto that
  real flow rather than fabricating an approval step that doesn't exist —
  agreed with the project owner as the resolution for this semantic mismatch.
*/

const METHODS = [
  { value: 'bank/imps', label: 'Bank transfer / IMPS' },
  { value: 'upi', label: 'UPI' },
];

// Real PayoutRequest.STATUSES, 1:1 — no fabricated statuses.
const PAYOUT_STATUSES = ['awaiting_processing', 'in_processing', 'awaiting_settlement', 'settlement_completed', 'canceled', 'dispute'];
const STATUS_META = {
  awaiting_processing: { label: 'Awaiting Processing', color: 'amber' },
  in_processing: { label: 'In Processing', color: 'sky' },
  awaiting_settlement: { label: 'Awaiting Settlement', color: 'violet' },
  settlement_completed: { label: 'Settlement Completed', color: 'green' },
  canceled: { label: 'Canceled', color: 'gray' },
  dispute: { label: 'Dispute', color: 'red' },
};
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

const short = (uuid, id) => (uuid ? String(uuid).split('-')[0].toUpperCase() : `#${id}`);
const fmtDateTime = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return { time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), date: d.toLocaleDateString([], { day: '2-digit', month: 'short' }) };
};
const fmtFull = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

const EMPTY = { amount_inr: '', payment_method: 'bank/imps', recipient_name: '', account_number: '', ifsc_code: '', bank_name: '', upi_id: '' };

function Field({ label, children }) {
  return (
    <label className="block">
      <span style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 5 }}>{label}</span>
      {children}
    </label>
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

// Detail drawer — every field is a real payout_requests column. No Approve/
// Cancel actions (that's the design's "merchant approves a withdrawal"
// concept, which doesn't exist here) and no fabricated "awaiting_approval"
// stage — the timeline below only lists real lifecycle timestamps.
function PayoutDetailDrawer({ payout: p, open, onClose }) {
  if (!p) return null;
  const meta = STATUS_META[p.status] || { label: p.status, color: 'gray' };
  const steps = [
    { label: 'Requested', at: p.created_at },
    { label: 'Accepted by trader', at: p.accepted_at },
    { label: 'Transferred', at: p.transferred_at },
    { label: 'Settled', at: p.settled_at },
  ].filter((s) => s.at || s.label === 'Requested');

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={
        <span className="inline-flex items-center gap-2">
          {short(p.uuid, p.id)}
          <button type="button" onClick={() => navigator.clipboard?.writeText(p.uuid || String(p.id))} className="tf-hbtn" style={{ width: 26, height: 26 }} aria-label="Copy payout ID">
            <IconCopy className="h-3.5 w-3.5" />
          </button>
        </span>
      }
      subtitle={p.recipient_name}
    >
      <div className="text-center rounded-xl p-5" style={{ background: 'var(--hover)', border: '1px solid var(--cardborder)' }}>
        <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>Amount</p>
        <p style={{ color: 'var(--text)', fontSize: 28, fontWeight: 700, margin: '6px 0' }}>{inr(p.amount_inr)}</p>
        <div className="flex items-center justify-center gap-2">
          <Badge color="sky">{p.payment_method}</Badge>
          <Badge color={meta.color}>{meta.label}</Badge>
        </div>
      </div>

      <p className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Recipient</p>
      <div className="grid grid-cols-2 gap-3">
        <DetailTile label="Name" value={p.recipient_name || '—'} />
        {p.payment_method === 'upi' ? (
          <DetailTile label="UPI ID" value={p.upi_id || '—'} mono />
        ) : (
          <>
            <DetailTile label="Account number" value={p.account_number || '—'} mono />
            <DetailTile label="IFSC" value={p.ifsc_code || '—'} mono />
            <DetailTile label="Bank" value={p.bank_name || '—'} />
          </>
        )}
      </div>

      <p className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Timeline</p>
      <div className="flex flex-col gap-2">
        {steps.map((s) => (
          <div key={s.label} className="flex items-center gap-3 text-sm">
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.at ? '#22c55e' : 'var(--cardborder)', flexShrink: 0 }} />
            <span style={{ color: 'var(--text)', flex: 1 }}>{s.label}</span>
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>{s.at ? fmtFull(s.at) : 'Pending'}</span>
          </div>
        ))}
        {p.status === 'canceled' && p.canceled_at && (
          <div className="flex items-center gap-3 text-sm">
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#94a3b8', flexShrink: 0 }} />
            <span style={{ color: 'var(--text)', flex: 1 }}>Canceled</span>
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>{fmtFull(p.canceled_at)}</span>
          </div>
        )}
        {p.status === 'dispute' && p.disputed_at && (
          <div className="flex items-center gap-3 text-sm">
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
            <span style={{ color: 'var(--text)', flex: 1 }}>Disputed</span>
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>{fmtFull(p.disputed_at)}</span>
          </div>
        )}
      </div>
      {p.dispute_reason && (
        <div className="mt-3 rounded-lg p-3 text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
          <strong>Dispute reason:</strong> {p.dispute_reason}
        </div>
      )}

      {p.merchant_liability_usdt != null ? (
        <>
          <p className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Settlement</p>
          <div className="grid grid-cols-2 gap-3">
            <DetailTile label="Rate applied" value={p.effective_payout_rate != null ? `₹${Number(p.effective_payout_rate).toFixed(2)} / USDT` : '—'} />
            <DetailTile label="Settlement debit" value={usdt(p.merchant_liability_usdt)} />
          </div>
          <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>This is a debit against your settlement wallet — a payout never adds merchant credit.</p>
        </>
      ) : (
        <p className="mt-5 text-sm" style={{ color: 'var(--muted)' }}>Settlement hasn't been calculated yet — this happens once a trader accepts the request.</p>
      )}
    </Modal>
  );
}

export default function Payouts() {
  const [form, setForm] = useState(EMPTY);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState(null); // { type, text }

  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [datePreset, setDatePreset] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [detail, setDetail] = useState(null);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const isUpi = form.payment_method === 'upi';

  // Fetch the merchant's full payout history once (listForMerchant is a real,
  // unpaginated findAll — see payoutService.js) and filter/paginate client-side,
  // same pattern as the Pay-in page.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await merchantApi.myPayouts();
      setRows(res.data?.data?.payout_requests || []);
    } catch (e) {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onUpdate = () => load();
    window.addEventListener('order:update', onUpdate);
    return () => window.removeEventListener('order:update', onUpdate);
  }, [load]);

  useEffect(() => { setPage(1); }, [tab, search, amountMin, amountMax, datePreset, pageSize]);

  // ---- Real create-payout submission — UNCHANGED from the pre-restyle
  // version (this is the highest-risk logic on the page: same required
  // fields, same body shape, same validation order as the backend's
  // createSchema in payoutController.js). Only the surrounding JSX changed. ----
  const submit = async (e) => {
    e.preventDefault();
    setMsg(null);
    if (!form.amount_inr || Number(form.amount_inr) <= 0) return setMsg({ type: 'err', text: 'Enter a valid amount.' });
    if (!form.recipient_name.trim()) return setMsg({ type: 'err', text: 'Recipient name is required.' });
    if (isUpi && !form.upi_id.trim()) return setMsg({ type: 'err', text: 'UPI ID is required.' });
    if (!isUpi && !form.account_number.trim()) return setMsg({ type: 'err', text: 'Account number is required.' });

    const body = {
      amount_inr: Number(form.amount_inr),
      payment_method: form.payment_method,
      recipient_name: form.recipient_name.trim(),
      ...(isUpi
        ? { upi_id: form.upi_id.trim() }
        : { account_number: form.account_number.trim(), ifsc_code: form.ifsc_code.trim(), bank_name: form.bank_name.trim() }),
    };
    setSubmitting(true);
    try {
      await merchantApi.createPayout(body);
      setMsg({ type: 'ok', text: 'Payout request created — it is now in the trader pool.' });
      setForm(EMPTY);
      setTab('all');
      load();
    } catch (err) {
      setMsg({ type: 'err', text: err.response?.data?.message || 'Could not create the request.' });
    } finally {
      setSubmitting(false);
    }
  };

  const counts = useMemo(() => {
    const c = { all: rows.length };
    PAYOUT_STATUSES.forEach((s) => (c[s] = rows.filter((r) => r.status === s).length));
    return c;
  }, [rows]);

  const tabs = [
    { key: 'all', label: 'All', count: counts.all },
    ...PAYOUT_STATUSES.map((s) => ({ key: s, label: STATUS_META[s].label, count: counts[s] })),
  ];

  const minAmount = amountMin ? Number(amountMin) : null;
  const maxAmount = amountMax ? Number(amountMax) : null;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab !== 'all' && r.status !== tab) return false;
      if (!matchesDatePreset(r.created_at, datePreset)) return false;
      if (minAmount !== null && Number(r.amount_inr) < minAmount) return false;
      if (maxAmount !== null && Number(r.amount_inr) > maxAmount) return false;
      if (query) {
        const haystack = `${r.uuid || ''} ${r.id} ${r.recipient_name || ''}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [rows, tab, search, minAmount, maxAmount, datePreset]);

  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const totalInr = filtered.reduce((s, r) => s + (Number(r.amount_inr) || 0), 0);
  const clearFilters = () => { setAmountMin(''); setAmountMax(''); setDatePreset('all'); setSearch(''); };

  const exportCsv = () => {
    const header = ['Payout ID', 'Recipient', 'Method', 'Amount INR', 'Created', 'Status'];
    const csvRows = filtered.map((r) => [short(r.uuid, r.id), r.recipient_name, r.payment_method, Number(r.amount_inr).toFixed(2), r.created_at, STATUS_META[r.status]?.label || r.status]);
    const blob = new Blob([toCsv([header, ...csvRows])], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `payout-requests-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        title="Payout"
        subtitle={loading ? 'Loading payout requests…' : 'Every outgoing payout request.'}
        actions={<Button variant="ghost" onClick={exportCsv}><IconExport className="h-4 w-4" /> Export CSV</Button>}
      />

      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-[.85fr_2fr]" style={{ alignItems: 'start' }}>
        {/* Create form — real submission logic, unchanged */}
        <Card className="p-5">
          <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: '0 0 14px' }}>New payout request</h2>
          <form onSubmit={submit} className="space-y-3">
            <Field label="Amount (INR)"><Input type="number" min="1" value={form.amount_inr} onChange={(e) => set('amount_inr')(e.target.value)} placeholder="10000" /></Field>
            <Field label="Payment method"><Select value={form.payment_method} onChange={set('payment_method')} options={METHODS} /></Field>
            <Field label="Recipient name"><Input value={form.recipient_name} onChange={(e) => set('recipient_name')(e.target.value)} placeholder="Full name" /></Field>
            {isUpi ? (
              <Field label="UPI ID"><Input value={form.upi_id} onChange={(e) => set('upi_id')(e.target.value)} placeholder="name@bank" /></Field>
            ) : (
              <>
                <Field label="Account number"><Input value={form.account_number} onChange={(e) => set('account_number')(e.target.value)} placeholder="1234567890" /></Field>
                <Field label="IFSC code"><Input value={form.ifsc_code} onChange={(e) => set('ifsc_code')(e.target.value)} placeholder="HDFC0001234" /></Field>
                <Field label="Bank name"><Input value={form.bank_name} onChange={(e) => set('bank_name')(e.target.value)} placeholder="HDFC Bank" /></Field>
              </>
            )}
            {msg && (
              <div style={{ padding: '9px 12px', borderRadius: 10, fontSize: 13, background: msg.type === 'ok' ? 'rgba(34,197,94,.12)' : 'rgba(239,68,68,.1)', color: msg.type === 'ok' ? '#16a34a' : '#ef4444' }}>{msg.text}</div>
            )}
            <Button type="submit" variant="primary" disabled={submitting} className="w-full">{submitting ? 'Creating…' : 'Create payout request'}</Button>
          </form>
        </Card>

        {/* List */}
        <Card>
          <div className="p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ID or recipient" />
              <Input type="number" value={amountMin} onChange={(e) => setAmountMin(e.target.value)} placeholder="Min amount (₹)" />
              <Input type="number" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} placeholder="Max amount (₹)" />
              <div className="flex gap-2">
                <Select value={datePreset} onChange={setDatePreset} options={DATE_PRESETS} />
                <Button variant="ghost" onClick={clearFilters}>Clear</Button>
              </div>
            </div>
          </div>
          <div className="px-4">
            <Tabs tabs={tabs} active={tab} onChange={setTab} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--cardborder)' }}>
                  <th className="px-4 py-3 font-medium">ID</th>
                  <th className="px-4 py-3 font-medium">Recipient</th>
                  <th className="px-4 py-3 font-medium">Method</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--text)' }}>
                {pageRows.map((r) => {
                  const created = fmtDateTime(r.created_at);
                  return (
                    <tr key={r.id} className="tf-row-hover cursor-pointer" style={{ borderTop: '1px solid var(--cardborder)' }} onClick={() => setDetail(r)}>
                      <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--muted)' }}>{short(r.uuid, r.id)}</td>
                      <td className="px-4 py-3">{r.recipient_name}</td>
                      <td className="px-4 py-3" style={{ textTransform: 'capitalize' }}>{r.payment_method}</td>
                      <td className="px-4 py-3 font-medium">{inr(r.amount_inr)}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                        {created ? (<><div>{created.time}</div><div style={{ opacity: 0.7 }}>{created.date}</div></>) : '—'}
                      </td>
                      <td className="px-4 py-3"><Badge color={(STATUS_META[r.status] || { color: 'gray' }).color}>{(STATUS_META[r.status] || { label: r.status }).label}</Badge></td>
                    </tr>
                  );
                })}
                {!loading && pageRows.length === 0 && (
                  <tr><td colSpan={6} className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>No payout requests match your filters.</td></tr>
                )}
                {loading && rows.length === 0 && (
                  <tr><td colSpan={6} className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>Loading…</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderTop: '1px solid var(--cardborder)' }}>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>{filtered.length.toLocaleString()} requests · {inr(totalInr)} total</span>
            <Select value={String(pageSize)} onChange={(v) => setPageSize(Number(v))} options={PAGE_SIZE_OPTIONS} className="w-32" />
          </div>
          <Pagination page={page} perPage={pageSize} total={filtered.length} onPage={setPage} />
        </Card>
      </div>

      <PayoutDetailDrawer payout={detail} open={!!detail} onClose={() => setDetail(null)} />
    </div>
  );
}
