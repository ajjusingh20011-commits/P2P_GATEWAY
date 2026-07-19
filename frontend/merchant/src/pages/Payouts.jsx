import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Badge, Button, Input, Select, PageHeader } from '../components/ui';
import { merchantApi } from '../services/api';
import { inr } from '../utils/mock';

/*
  Merchant Payouts — create a payout request (send INR to a recipient) and track
  it as a trader processes it and the admin settles it. Isolated from the
  order/pay-in flow. Uses the shared merchant theme (tf-* / ui components).
*/

const METHODS = [
  { value: 'bank/imps', label: 'Bank transfer / IMPS' },
  { value: 'upi', label: 'UPI' },
];

const STATUS_LABEL = {
  awaiting_processing: 'Awaiting Processing',
  in_processing: 'In Processing',
  awaiting_settlement: 'Awaiting Settlement',
  settlement_completed: 'Settlement Completed',
  canceled: 'Canceled',
  dispute: 'Dispute',
};
const STATUS_BADGE = {
  awaiting_processing: 'amber',
  in_processing: 'sky',
  awaiting_settlement: 'violet',
  settlement_completed: 'green',
  canceled: 'gray',
  dispute: 'red',
};
const FILTERS = [{ value: '', label: 'All statuses' }, ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))];

const short = (uuid, id) => (uuid ? String(uuid).split('-')[0].toUpperCase() : `#${id}`);
const fmtDate = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())} · ${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
};

const EMPTY = { amount_inr: '', payment_method: 'bank/imps', recipient_name: '', account_number: '', ifsc_code: '', bank_name: '', upi_id: '' };

export default function Payouts() {
  const [form, setForm] = useState(EMPTY);
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState(null); // { type, text }

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const isUpi = form.payment_method === 'upi';

  const load = useCallback(async (status) => {
    setLoading(true);
    try {
      const res = await merchantApi.myPayouts(status);
      setRows(res.data.data.payout_requests || []);
    } catch (e) {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(filter); }, [filter, load]);

  // Live refresh when a payout event is broadcast (merchant useSocket re-emits it).
  useEffect(() => {
    const onUpdate = () => load(filter);
    window.addEventListener('order:update', onUpdate);
    return () => window.removeEventListener('order:update', onUpdate);
  }, [filter, load]);

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
      setFilter('');
      load('');
    } catch (err) {
      setMsg({ type: 'err', text: err.response?.data?.message || 'Could not create the request.' });
    } finally {
      setSubmitting(false);
    }
  };

  const label = useMemo(() => (v) => STATUS_LABEL[v] || v, []);

  return (
    <div>
      <PageHeader title="Payouts" subtitle="Request a payout to a recipient and track its settlement" />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Create form */}
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
        <Card className="flex flex-col xl:col-span-2">
          <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--cardborder)' }}>
            <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: 0 }}>My payout requests</h2>
            <div style={{ width: 190 }}><Select value={filter} onChange={setFilter} options={FILTERS} /></div>
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
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--cardborder)' }}>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--muted)' }}>{short(r.uuid, r.id)}</td>
                    <td className="px-4 py-3">{r.recipient_name}</td>
                    <td className="px-4 py-3" style={{ textTransform: 'capitalize' }}>{r.payment_method}</td>
                    <td className="px-4 py-3 font-medium">{inr(r.amount_inr)}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>{fmtDate(r.created_at)}</td>
                    <td className="px-4 py-3"><Badge color={STATUS_BADGE[r.status]}>{label(r.status)}</Badge></td>
                  </tr>
                ))}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={6} className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>No payout requests yet.</td></tr>
                )}
                {loading && rows.length === 0 && (
                  <tr><td colSpan={6} className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>Loading…</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 5 }}>{label}</span>
      {children}
    </label>
  );
}
