import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Card, Badge, Button, SearchInput, Select, Tabs, PageHeader, Modal, Field, InlineLoader } from '../components/ui';
import AdminIdPopover from '../components/AdminIdPopover';
import ConfirmModal from '../components/ConfirmModal';
import { adminApi } from '../services/api';
import { inr } from '../utils/mock';

/*
  Admin Payouts — manage the merchant Payout-Request ("Buy USDT") system.
  Real 6-status enum (payoutRequest.model.js), not the design's fictional
  10-state list. Tabs stay the primary navigation (each tab is its own real
  server-side fetch, matching how the backend actually scopes this list)
  rather than a client-side "All" filter over unpaginated data.
*/

const TABS = [
  { key: 'awaiting_processing', label: 'Awaiting Processing', color: 'amber' },
  { key: 'in_processing', label: 'In Processing', color: 'sky' },
  { key: 'awaiting_settlement', label: 'Awaiting Settlement', color: 'violet' },
  { key: 'settlement_completed', label: 'Settlement Completed', color: 'green' },
  { key: 'canceled', label: 'Canceled', color: 'gray' },
  { key: 'dispute', label: 'Dispute', color: 'red' },
];

const short = (uuid, id) => (uuid ? String(uuid).split('-')[0].toUpperCase() : `#${id}`);
const fmtDate = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())} · ${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
};
const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');

// Real action -> confirm-dialog copy. Reject's outcome genuinely differs by
// current status (payoutService.reject): from awaiting_processing it
// cancels; from awaiting_settlement it routes to Dispute for review, since
// a payout that already reached settlement can't just be silently voided.
const ACTION_COPY = {
  approve: { title: 'Approve this payout?', tone: 'primary', label: 'Approve & settle', desc: (r) => `${short(r.uuid, r.id)} will be settled and ${inr(r.amount_inr)} debited from the assigned trader's balance. This cannot be undone.` },
  rejectProcessing: { title: 'Reject this payout?', tone: 'danger', label: 'Reject', desc: (r) => `${short(r.uuid, r.id)} will be marked Canceled and the merchant notified.` },
  rejectSettlement: { title: 'Reject this payout?', tone: 'danger', label: 'Reject', desc: (r) => `${short(r.uuid, r.id)} will move to Dispute for review — an already-processing payout can't be silently canceled.` },
  settle: { title: 'Settle this disputed payout?', tone: 'primary', label: 'Settle', desc: (r) => `${short(r.uuid, r.id)} will be settled and ${inr(r.amount_inr)} debited from the assigned trader's balance. This cannot be undone.` },
  returnToPool: { title: 'Return this payout to the pool?', tone: 'primary', label: 'Return to pool', desc: (r) => `${short(r.uuid, r.id)} goes back to the global pool for another trader to pick up — no funds moved. Use this when the trader didn't actually pay.` },
  void: { title: 'Void this disputed payout?', tone: 'danger', label: 'Void', desc: (r) => `${short(r.uuid, r.id)} will be marked Canceled with no funds moved.` },
};

// ---- Payout evidence review (Feature 2) ----------------------------------
const digitsOnly = (s) => String(s == null ? '' : s).replace(/\D/g, '');
const normName = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');

// Compare one captured field against the payout's expected value. Defensive: a
// field the capture didn't include is "missing" (NOT a mismatch) — a missing
// signal must never read as a failure. Returns { status, recorded, expected }.
function compareField(recorded, expected, kind) {
  const hasRecorded = recorded != null && String(recorded).trim() !== '';
  if (!hasRecorded) return { status: 'missing' };
  const hasExpected = expected != null && String(expected).trim() !== '';
  if (!hasExpected) return { status: 'unknown', recorded };
  let ok;
  if (kind === 'account') {
    const r = digitsOnly(recorded);
    const e = digitsOnly(expected);
    ok = !!r && !!e && (r === e || (r.length >= 4 && e.length >= 4 && r.slice(-4) === e.slice(-4)));
  } else if (kind === 'amount') {
    ok = Math.abs(Number(recorded) - Number(expected)) < 0.01 || digitsOnly(recorded) === digitsOnly(expected);
  } else if (kind === 'name') {
    const r = normName(recorded);
    const e = normName(expected);
    ok = !!r && !!e && (r === e || r.includes(e) || e.includes(r));
  } else {
    ok = String(recorded).trim().toUpperCase() === String(expected).trim().toUpperCase();
  }
  return { status: ok ? 'match' : 'mismatch', recorded, expected };
}

// recordedInput is device-authored and stored as Mixed — read defensively.
function firstOf(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    if (obj[k] != null && String(obj[k]).trim() !== '') return obj[k];
  }
  return null;
}

const MATCH_META = {
  match: { color: '#22c55e', label: '✓ match' },
  mismatch: { color: '#ef4444', label: '✕ mismatch' },
  missing: { color: 'var(--muted)', label: 'not captured' },
  unknown: { color: 'var(--muted)', label: 'no expected value' },
};

function MatchRow({ label, recorded, expected, status }) {
  const m = MATCH_META[status] || MATCH_META.missing;
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '5px 0', borderBottom: '1px solid var(--cardborder)' }}>
      <span style={{ color: 'var(--muted)', fontSize: 12, minWidth: 78 }}>{label}</span>
      <span className="font-mono" style={{ color: 'var(--text)', fontSize: 12.5, flex: 1, textAlign: 'right', wordBreak: 'break-all' }}>
        {recorded != null && String(recorded).trim() !== '' ? String(recorded) : '—'}
        {status === 'mismatch' && expected != null && (
          <span style={{ color: 'var(--muted)' }}> (expected {String(expected)})</span>
        )}
      </span>
      <span style={{ color: m.color, fontSize: 11.5, fontWeight: 600, minWidth: 84, textAlign: 'right' }}>{m.label}</span>
    </div>
  );
}

function PayoutEvidenceSection({ payout, evidence, loading }) {
  const H = ({ children }) => (
    <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', margin: '0 0 10px' }}>{children}</h3>
  );
  if (loading) return <div><H>Evidence</H><InlineLoader label="Loading evidence…" /></div>;
  if (!evidence || evidence.uploadCount === 0) {
    return (
      <div>
        <H>Evidence</H>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>
          No evidence captured for this payout yet{payout.assigned_trader_id ? '' : ' (not picked up by a trader)'}.
        </p>
      </div>
    );
  }

  const ri = evidence.recordedInput;
  const recorded = {
    account: firstOf(ri, ['accountNumber', 'account_number', 'account', 'acct']),
    name: firstOf(ri, ['holderName', 'holder_name', 'name', 'recipientName', 'recipient_name', 'payeeName']),
    amount: firstOf(ri, ['amount', 'amount_inr', 'amountInr']),
    ifsc: firstOf(ri, ['ifsc', 'ifsc_code', 'ifscCode']),
    upi: firstOf(ri, ['upiId', 'upi', 'upi_id']),
  };
  const checks = [
    { label: 'Account', ...compareField(recorded.account, payout.account_number, 'account') },
    { label: 'Recipient', ...compareField(recorded.name, payout.recipient_name, 'name') },
    { label: 'Amount', ...compareField(recorded.amount, payout.amount_inr, 'amount') },
    { label: 'IFSC', ...compareField(recorded.ifsc, payout.ifsc_code, 'ifsc') },
    { label: 'UPI ID', ...compareField(recorded.upi, payout.upi_id, 'exact') },
  ];
  const matched = checks.filter((c) => c.status === 'match').length;
  const mismatched = checks.filter((c) => c.status === 'mismatch').length;
  const comparable = matched + mismatched;

  // Timing: was the capture within the payout window (accept -> transfer/now)?
  const capMs = Date.parse(evidence.screenshotTimestamp || evidence.recordTimestamp || evidence.smsTimestamp || '');
  const acceptMs = Date.parse(payout.accepted_at || '');
  const endMs = Date.parse(payout.transferred_at || '') || Date.now();
  const timingOk = capMs && acceptMs ? (capMs >= acceptMs - 5 * 60000 && capMs <= endMs + 5 * 60000) : null;

  const verdict = mismatched > 0
    ? { color: '#ef4444', bg: 'rgba(239,68,68,.12)', text: `${mismatched} signal${mismatched === 1 ? '' : 's'} DO NOT match — review carefully before approving.` }
    : comparable > 0
      ? { color: '#22c55e', bg: 'rgba(34,197,94,.12)', text: `Looks like a match — ${matched} of ${comparable} captured signal${comparable === 1 ? '' : 's'} agree. Admin approval still required.` }
      : { color: 'var(--muted)', bg: 'var(--hover)', text: 'Evidence present but nothing comparable was captured — review the screenshot and SMS manually.' };

  const img = evidence.screenshotBase64
    ? (String(evidence.screenshotBase64).startsWith('data:') ? evidence.screenshotBase64 : `data:image/png;base64,${evidence.screenshotBase64}`)
    : null;

  return (
    <div>
      <H>Evidence &amp; match</H>

      {/* Suggestion only — the system never auto-approves; a mismatch is flagged, not rejected. */}
      <div style={{ padding: '10px 14px', borderRadius: 10, background: verdict.bg, color: verdict.color, fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
        {verdict.text}
      </div>

      <div style={{ marginBottom: 14 }}>
        {checks.map((c) => <MatchRow key={c.label} label={c.label} recorded={c.recorded} expected={c.expected} status={c.status} />)}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0' }}>
          <span style={{ color: 'var(--muted)', fontSize: 12, minWidth: 78 }}>Timing</span>
          <span style={{ color: timingOk == null ? 'var(--muted)' : timingOk ? '#22c55e' : '#ef4444', fontSize: 11.5, fontWeight: 600 }}>
            {timingOk == null ? 'unknown' : timingOk ? '✓ within window' : '✕ outside window'}
          </span>
        </div>
      </div>

      {/* Screenshot — real inline image, not a filename/link. */}
      <div style={{ marginBottom: 14 }}>
        <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 6px' }}>Payment screenshot{evidence.screenshotTimestamp ? ` · ${fmtDateTime(evidence.screenshotTimestamp)}` : ''}</p>
        {img
          ? (
            <a href={img} target="_blank" rel="noreferrer">
              <img src={img} alt="Payment screenshot" style={{ maxWidth: '100%', maxHeight: 380, borderRadius: 10, border: '1px solid var(--cardborder)', display: 'block' }} />
            </a>
          )
          : <p style={{ color: 'var(--muted)', fontSize: 13 }}>Not captured.</p>}
      </div>

      {/* Bank debit SMS — raw text so the admin can verify a genuine bank sender. */}
      <div>
        <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 6px' }}>Bank debit SMS{evidence.smsTimestamp ? ` · ${fmtDateTime(evidence.smsTimestamp)}` : ''}</p>
        {evidence.linkedSmsRaw
          ? <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'var(--hover)', border: '1px solid var(--cardborder)', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, color: 'var(--text)', margin: 0 }}>{evidence.linkedSmsRaw}</pre>
          : <p style={{ color: 'var(--muted)', fontSize: 13 }}>Not captured.</p>}
      </div>
    </div>
  );
}

export default function Payouts() {
  const [tab, setTab] = useState('awaiting_settlement');
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [merchantFilter, setMerchantFilter] = useState('All');
  const [viewing, setViewing] = useState(null);
  const [confirming, setConfirming] = useState(null); // { row, actionKey }
  const [evidence, setEvidence] = useState(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);

  // Load the captured evidence (full: screenshot + SMS + recorded input) when a
  // payout is opened for review.
  useEffect(() => {
    if (!viewing) { setEvidence(null); return undefined; }
    let active = true;
    setEvidenceLoading(true);
    setEvidence(null);
    adminApi.getPayoutEvidence(viewing.id)
      .then((data) => { if (active) setEvidence(data.evidence || null); })
      .catch(() => { if (active) setEvidence(null); })
      .finally(() => { if (active) setEvidenceLoading(false); });
    return () => { active = false; };
  }, [viewing?.id]);

  const load = useCallback(async (status) => {
    setLoading(true);
    setError('');
    try {
      const data = await adminApi.listPayoutRequests({ status });
      setRows(data.payout_requests || []);
      setCounts(data.counts || {});
    } catch (e) {
      setError(e.response?.data?.message || 'Could not load payout requests.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(tab); }, [tab, load]);

  useEffect(() => {
    const onUpdate = () => load(tab);
    window.addEventListener('order:update', onUpdate);
    return () => window.removeEventListener('order:update', onUpdate);
  }, [tab, load]);

  const act = async (fn, id) => {
    setBusyId(id);
    setError('');
    try {
      await fn();
      load(tab);
    } catch (e) {
      setError(e.response?.data?.message || 'Action failed.');
    } finally {
      setBusyId(null);
      setConfirming(null);
      setViewing(null);
    }
  };

  const runConfirmed = () => {
    if (!confirming) return;
    const { row, actionKey } = confirming;
    if (actionKey === 'approve') act(() => adminApi.approvePayoutRequest(row.id), row.id);
    else if (actionKey === 'rejectProcessing' || actionKey === 'rejectSettlement') act(() => adminApi.rejectPayoutRequest(row.id, 'Rejected by admin'), row.id);
    else if (actionKey === 'settle') act(() => adminApi.resolvePayoutDispute(row.id, { action: 'settle' }), row.id);
    else if (actionKey === 'returnToPool') act(() => adminApi.resolvePayoutDispute(row.id, { action: 'return_to_pool' }), row.id);
    else if (actionKey === 'void') act(() => adminApi.resolvePayoutDispute(row.id, { action: 'void' }), row.id);
  };

  const merchantOptions = useMemo(() => {
    const names = Array.from(new Set(rows.map((r) => r.merchant?.business_name).filter(Boolean)));
    return ['All', ...names];
  }, [rows]);

  const filteredRows = useMemo(() => {
    const query = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (merchantFilter !== 'All' && r.merchant?.business_name !== merchantFilter) return false;
      if (query) {
        const hay = `${r.uuid || r.id} ${r.merchant?.business_name || ''} ${r.recipient_name || ''}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }, [rows, merchantFilter, q]);

  const exportCsv = () => {
    const header = ['ID', 'Merchant', 'Recipient', 'Amount', 'Trader', 'Status', 'Updated'];
    const data = filteredRows.map((r) => [short(r.uuid, r.id), r.merchant?.business_name || '', r.recipient_name || '', r.amount_inr, r.assigned_trader_id || '', r.status, r.updated_at || '']);
    const csv = [header, ...data].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `admin-payouts-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const tabs = TABS.map((t) => ({ key: t.key, label: t.label, count: counts[t.key] || 0 }));
  const meta = useMemo(() => TABS.find((t) => t.key === tab), [tab]);
  const showRate = ['in_processing', 'awaiting_settlement', 'settlement_completed', 'dispute'].includes(tab);

  const rowActions = (r, size = 'sm') => {
    if (tab === 'awaiting_settlement') {
      return (
        <>
          <Button size={size} variant="success" disabled={busyId === r.id} onClick={() => setConfirming({ row: r, actionKey: 'approve' })}>Approve &amp; settle</Button>
          <Button size={size} variant="ghost" disabled={busyId === r.id} onClick={() => setConfirming({ row: r, actionKey: 'rejectSettlement' })}>Reject</Button>
        </>
      );
    }
    if (tab === 'awaiting_processing') {
      return <Button size={size} variant="ghost" disabled={busyId === r.id} onClick={() => setConfirming({ row: r, actionKey: 'rejectProcessing' })}>Reject</Button>;
    }
    if (tab === 'dispute') {
      return (
        <>
          <Button size={size} variant="success" disabled={busyId === r.id} onClick={() => setConfirming({ row: r, actionKey: 'settle' })}>Settle</Button>
          <Button size={size} variant="ghost" disabled={busyId === r.id} onClick={() => setConfirming({ row: r, actionKey: 'returnToPool' })}>Return to pool</Button>
          <Button size={size} variant="ghost" disabled={busyId === r.id} onClick={() => setConfirming({ row: r, actionKey: 'void' })}>Void</Button>
        </>
      );
    }
    return <Badge color={meta.color}>{meta.label}</Badge>;
  };

  return (
    <div>
      <PageHeader
        title="Payout"
        subtitle="Approve, settle, reject, and resolve merchant payout disputes"
        actions={
          <>
            {loading && <InlineLoader />}
            <Button variant="ghost" size="sm" onClick={exportCsv}><Download size={14} className="mr-1" />Export</Button>
          </>
        }
      />

      {error && (
        <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 12, background: 'rgba(239,68,68,.1)', color: '#ef4444', fontSize: 13 }}>{error}</div>
      )}

      <Card className="mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <SearchInput value={q} onChange={setQ} placeholder="Search by ID, merchant, recipient…" className="sm:max-w-xs" />
        <Select value={merchantFilter} onChange={setMerchantFilter} options={merchantOptions.map((m) => ({ value: m, label: m }))} className="sm:w-56" />
      </Card>

      <Card>
        <div className="px-4 pt-2">
          <Tabs tabs={tabs} active={tab} onChange={setTab} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--cardborder)' }}>
                <th className="w-10 px-4 py-3" />
                <th className="px-4 py-3 font-medium">Merchant</th>
                <th className="px-4 py-3 font-medium">Recipient</th>
                <th className="px-4 py-3 font-medium">Trader</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                {showRate && <th className="px-4 py-3 font-medium">Rate (base → payout)</th>}
                {showRate && <th className="px-4 py-3 font-medium">Trader credit</th>}
                {tab === 'dispute' && <th className="px-4 py-3 font-medium">Reason</th>}
                <th className="px-4 py-3 font-medium">Updated</th>
                <th className="px-4 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody style={{ color: 'var(--text)' }}>
              {filteredRows.map((r) => (
                <tr key={r.id} className="tf-row-hover cursor-pointer" style={{ borderTop: '1px solid var(--cardborder)' }} onClick={() => setViewing(r)}>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <AdminIdPopover
                      rows={[
                        { label: 'Payout ID', value: r.id },
                        { label: 'UUID', value: r.uuid },
                      ]}
                    />
                  </td>
                  <td className="px-4 py-3">{r.merchant?.business_name || `#${r.merchant_id}`}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--muted)' }}>{r.recipient_name || '—'}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--muted)' }}>{r.assigned_trader_id ? `#${r.assigned_trader_id}` : '—'}</td>
                  <td className="px-4 py-3 font-medium">{inr(r.amount_inr)}</td>
                  {showRate && (
                    <td className="px-4 py-3 text-xs">
                      {r.effective_payout_rate
                        ? <span>₹{r.base_exchange_rate} → <b style={{ color: 'var(--text)' }}>₹{r.effective_payout_rate}</b> <span style={{ color: 'var(--muted)' }}>({r.trader_payout_percent}%)</span></span>
                        : <span style={{ color: 'var(--muted)' }}>—</span>}
                    </td>
                  )}
                  {showRate && <td className="px-4 py-3 font-semibold" style={{ color: '#22c55e' }}>{r.trader_credit_usdt ? `${r.trader_credit_usdt} USDT` : '—'}</td>}
                  {tab === 'dispute' && <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)', maxWidth: 200 }}>{r.dispute_reason || '—'}</td>}
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>{fmtDate(r.updated_at || r.created_at)}</td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-2">{rowActions(r)}</div>
                  </td>
                </tr>
              ))}
              {!loading && filteredRows.length === 0 && (
                <tr><td colSpan={9} className="py-14 text-center text-sm" style={{ color: 'var(--muted)' }}>No requests in "{meta.label}".</td></tr>
              )}
              {loading && filteredRows.length === 0 && (
                <tr><td colSpan={9} className="py-14 text-center text-sm" style={{ color: 'var(--muted)' }}>Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Detail modal — real Lifecycle from actual timestamp columns. */}
      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? `Payout ${short(viewing.uuid, viewing.id)}` : ''}
        subtitle={viewing ? `${viewing.merchant?.business_name || '—'} · ${viewing.recipient_name || '—'}` : ''}
        size="lg"
        footer={
          viewing ? (
            <div className="flex w-full flex-wrap justify-end gap-2">{rowActions(viewing)}</div>
          ) : null
        }
      >
        {viewing && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="Amount">{inr(viewing.amount_inr)}</Field>
              <Field label="Method">{viewing.payment_method || '—'}</Field>
              <Field label="Recipient" mono>{viewing.recipient_name || '—'}</Field>
              <Field label="Account" mono>{viewing.account_number || viewing.upi_id || '—'}</Field>
              <Field label="IFSC" mono>{viewing.ifsc_code || '—'}</Field>
              <Field label="Trader">{viewing.assigned_trader_id ? `#${viewing.assigned_trader_id}` : 'Unassigned'}</Field>
              <Field label="Status"><Badge color={TABS.find((t) => t.key === viewing.status)?.color || 'gray'}>{TABS.find((t) => t.key === viewing.status)?.label || viewing.status}</Badge></Field>
              {viewing.trader_credit_usdt && <Field label="Trader credit">{viewing.trader_credit_usdt} USDT</Field>}
              {viewing.dispute_reason && <Field label="Dispute reason">{viewing.dispute_reason}</Field>}
            </div>

            <div>
              <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', margin: '0 0 10px' }}>Lifecycle</h3>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field label="Requested">{fmtDateTime(viewing.created_at)}</Field>
                <Field label="Accepted by trader">{fmtDateTime(viewing.accepted_at)}</Field>
                <Field label="Transferred">{fmtDateTime(viewing.transferred_at)}</Field>
                <Field label="Settled">{fmtDateTime(viewing.settled_at)}</Field>
                <Field label="Disputed">{fmtDateTime(viewing.disputed_at)}</Field>
                <Field label="Canceled">{fmtDateTime(viewing.canceled_at)}</Field>
              </div>
            </div>

            <PayoutEvidenceSection payout={viewing} evidence={evidence} loading={evidenceLoading} />
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={!!confirming}
        title={confirming ? ACTION_COPY[confirming.actionKey].title : ''}
        description={confirming ? ACTION_COPY[confirming.actionKey].desc(confirming.row) : ''}
        tone={confirming ? ACTION_COPY[confirming.actionKey].tone : 'primary'}
        confirmLabel={confirming ? ACTION_COPY[confirming.actionKey].label : 'Confirm'}
        busy={busyId != null}
        onConfirm={runConfirmed}
        onClose={() => setConfirming(null)}
      />
    </div>
  );
}
