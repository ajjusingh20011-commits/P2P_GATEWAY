import { useEffect, useMemo, useState } from 'react';
import { Card, Badge, Button, SearchInput, Tabs, PageHeader, Modal, Field, InlineLoader } from '../components/ui';
import AdminIdPopover from '../components/AdminIdPopover';
import ConfirmModal from '../components/ConfirmModal';
import { adminApi } from '../services/api';
import { inr } from '../utils/mock';
import { toast } from '../components/toast';

/*
  Admin Disputes — the real 3-value enum (dispute.model.js: open/reviewing/
  resolved), not the design's 5-state Open/Reviewing/Evidence requested/
  Resolved/Rejected. Only `resolveDispute` is a real endpoint (PUT
  /admin/disputes/:id/resolve, open|reviewing -> resolved). There is no
  "reviewing" endpoint, no "reject claim", and no "request evidence" action
  anywhere in the backend, so those are dropped rather than faked — even
  the design's own "Mark reviewing" equivalent would silently reset on
  reload since nothing persists it. Resolution notes ARE real: `resolution`
  is a genuine persisted column, unlike the design's textarea which is
  explicitly commented "demo preview only, not persisted".
*/

const STATUS_META = {
  open: { label: 'Open', color: 'red' },
  reviewing: { label: 'Reviewing', color: 'amber' },
  resolved: { label: 'Resolved', color: 'green' },
};
const meta = (s) => STATUS_META[s] || { label: s, color: 'gray' };

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export default function Disputes() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [viewing, setViewing] = useState(null);
  const [notes, setNotes] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await adminApi.listDisputes();
      setList(data.disputes || []);
    } catch (e) {
      toast(e.response?.data?.message || 'Could not load disputes.', 'error');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => ({
    all: list.length,
    open: list.filter((d) => d.status === 'open').length,
    resolved: list.filter((d) => d.status === 'resolved').length,
  }), [list]);

  const tabs = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'open', label: 'Open', count: counts.open },
    { key: 'resolved', label: 'Resolved', count: counts.resolved },
  ];

  const filtered = useMemo(() => {
    let rows = tab === 'all' ? list : list.filter((d) => d.status === tab);
    const query = q.trim().toLowerCase();
    if (query) rows = rows.filter((d) => `${d.id} ${d.order_id} ${d.reason || ''}`.toLowerCase().includes(query));
    return rows;
  }, [list, tab, q]);

  const viewingLive = viewing ? list.find((d) => d.id === viewing.id) : null;

  const openDetail = (d) => { setViewing(d); setNotes(''); };

  const resolve = async () => {
    if (!viewingLive) return;
    setBusy(true);
    try {
      const res = await adminApi.resolveDispute(viewingLive.id, { resolution: notes || 'Resolved by admin' });
      const updated = res.dispute;
      setList((l) => l.map((d) => (d.id === updated.id ? updated : d)));
      toast(`Dispute #${updated.id} resolved`, 'success');
    } catch (e) {
      toast(e.response?.data?.message || 'Failed to resolve dispute.', 'error');
    } finally {
      setBusy(false);
      setConfirming(false);
      setViewing(null);
    }
  };

  return (
    <div>
      <PageHeader title="Disputes" subtitle="Pay-in order disputes requiring review" actions={loading ? <InlineLoader /> : null} />

      <Card className="mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <SearchInput value={q} onChange={setQ} placeholder="Search by dispute ID, order, reason…" className="sm:max-w-xs" />
      </Card>

      <Card className="mb-4 p-2">
        <Tabs tabs={tabs} active={tab} onChange={setTab} />
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ borderBottom: '1px solid var(--cardborder)', color: 'var(--muted)' }}>
                <th className="w-10 px-4 py-3" />
                <th className="px-4 py-3 font-medium">Order</th>
                <th className="px-4 py-3 font-medium">Merchant</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Reason</th>
                <th className="px-4 py-3 font-medium">Opened</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="py-14 text-center text-sm" style={{ color: 'var(--muted)' }}>{loading ? 'Loading…' : 'No disputes in this view.'}</td></tr>
              ) : (
                filtered.map((d) => (
                  <tr key={d.id} className="tf-row-hover cursor-pointer" style={{ borderTop: '1px solid var(--cardborder)' }} onClick={() => openDetail(d)}>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <AdminIdPopover
                        rows={[
                          { label: 'Dispute ID', value: d.id },
                          { label: 'Order ID', value: d.order_id },
                          { label: 'Order UUID', value: d.order?.uuid },
                        ]}
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--muted)' }}>{d.order?.uuid ? `${d.order.uuid.slice(0, 8)}…` : `#${d.order_id}`}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text)' }}>{d.order?.merchant_id ? `Merchant #${d.order.merchant_id}` : '—'}</td>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--text)' }}>{d.order?.amount_inr != null ? inr(d.order.amount_inr) : '—'}</td>
                    <td className="px-4 py-3 truncate" style={{ color: 'var(--muted)', maxWidth: 220 }}>{d.reason || '—'}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>{fmtDateTime(d.created_at)}</td>
                    <td className="px-4 py-3"><Badge color={meta(d.status).color}>{meta(d.status).label}</Badge></td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      {d.status !== 'resolved'
                        ? <Button size="sm" variant="ghost" onClick={() => openDetail(d)}>Review</Button>
                        : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={!!viewingLive}
        onClose={() => setViewing(null)}
        title={viewingLive ? `Dispute #${viewingLive.id}` : ''}
        subtitle={viewingLive ? `Order ${viewingLive.order?.uuid ? viewingLive.order.uuid.slice(0, 8) + '…' : `#${viewingLive.order_id}`}` : ''}
        size="lg"
        footer={
          viewingLive ? (
            <>
              <Button variant="ghost" onClick={() => setViewing(null)}>Close</Button>
              {viewingLive.status !== 'resolved' && (
                <Button variant="success" disabled={busy} onClick={() => setConfirming(true)}>Resolve dispute</Button>
              )}
            </>
          ) : null
        }
      >
        {viewingLive && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="Status"><Badge color={meta(viewingLive.status).color}>{meta(viewingLive.status).label}</Badge></Field>
              <Field label="Raised by">{viewingLive.raised_by ? `User #${viewingLive.raised_by}` : 'System'}</Field>
              <Field label="Opened">{fmtDateTime(viewingLive.created_at)}</Field>
              <Field label="Amount">{viewingLive.order?.amount_inr != null ? inr(viewingLive.order.amount_inr) : '—'}</Field>
              <Field label="Order" mono>{viewingLive.order?.uuid || `#${viewingLive.order_id}`}</Field>
              {viewingLive.evidence_url && (
                <Field label="Evidence">
                  <a href={viewingLive.evidence_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>View attachment</a>
                </Field>
              )}
            </div>

            <div>
              <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', margin: '0 0 8px' }}>Reason</h3>
              <p style={{ color: 'var(--text)', fontSize: 14, margin: 0 }}>{viewingLive.reason || '—'}</p>
            </div>

            <div>
              <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', margin: '0 0 8px' }}>
                {viewingLive.status === 'resolved' ? 'Resolution notes' : 'Resolution notes (saved when resolved)'}
              </h3>
              {viewingLive.status === 'resolved' ? (
                <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0 }}>{viewingLive.resolution || 'No notes recorded.'}</p>
              ) : (
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  placeholder="Document the investigation outcome…"
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--text)' }}
                />
              )}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={confirming}
        title="Resolve this dispute?"
        description={viewingLive ? `Dispute #${viewingLive.id} will be marked Resolved with the notes above saved to the record. This does not change the underlying order's status — use Pay-in's Confirm/Reject there if the order's outcome also needs to change.` : ''}
        tone="primary"
        confirmLabel="Resolve"
        busy={busy}
        onConfirm={resolve}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}
