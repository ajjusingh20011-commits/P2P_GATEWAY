import { useEffect, useMemo, useState } from 'react';
import { Card, Badge, Button, Tabs, PageHeader, Modal, Field, InlineLoader } from '../components/ui';
import { disputes as seedDisputes, DISPUTE_STATUSES, inr } from '../utils/mock';
import { useApi } from '../hooks/useApi';
import { adminApi } from '../services/api';

const STATUS_META = {
  open: { label: 'Open', color: 'red' },
  reviewing: { label: 'Reviewing', color: 'amber' },
  resolved: { label: 'Resolved', color: 'green' },
};

// Map a backend dispute record onto the shape the table/modal expect.
function mapDispute(d) {
  const status = DISPUTE_STATUSES.includes(d.status) ? d.status : 'open';
  return {
    id: d.id,
    orderId: d.order?.uuid || d.order_id,
    raisedBy: '—',
    raisedByRole: 'merchant',
    reason: d.reason || '—',
    amountInr: Number(d.order?.amount_inr) || 0,
    status,
    createdAt: d.created_at || '—',
    evidence: 0,
    notes: d.resolution || '',
  };
}

function DisputeModal({ dispute, onClose, onResolve, onReview }) {
  const [notes, setNotes] = useState(dispute?.notes || '');
  if (!dispute) return null;
  return (
    <Modal
      open={!!dispute}
      onClose={onClose}
      size="lg"
      title={`Dispute ${dispute.id}`}
      subtitle={`Order ${dispute.orderId} · ${inr(dispute.amountInr)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {dispute.status !== 'resolved' && (
            <>
              {dispute.status === 'open' && <Button variant="ghost" onClick={() => { onReview(dispute.id); onClose(); }}>Mark reviewing</Button>}
              <Button onClick={() => { onResolve(dispute.id, notes); onClose(); }}>Resolve dispute</Button>
            </>
          )}
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Status"><Badge color={STATUS_META[dispute.status].color}>{STATUS_META[dispute.status].label}</Badge></Field>
          <Field label="Raised by"><span className="capitalize">{dispute.raisedBy} ({dispute.raisedByRole})</span></Field>
          <Field label="Created">{dispute.createdAt}</Field>
          <Field label="Reason">{dispute.reason}</Field>
          <Field label="Amount">{inr(dispute.amountInr)}</Field>
          <Field label="Order">{dispute.orderId}</Field>
        </div>

        <section>
          <h3 className="mb-2 text-sm font-semibold text-white">Evidence / Screenshots</h3>
          <div className="flex flex-wrap gap-3">
            {Array.from({ length: dispute.evidence }, (_, i) => (
              <div key={i} className="flex h-24 w-32 items-center justify-center rounded-lg border border-dashed border-gray-700 bg-gray-950 text-xs text-gray-500">
                screenshot_{i + 1}.png
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold text-white">Resolution Notes</h3>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Document the investigation outcome and resolution…"
            readOnly={dispute.status === 'resolved'}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 read-only:cursor-not-allowed read-only:text-gray-400"
          />
        </section>
      </div>
    </Modal>
  );
}

export default function Disputes() {
  const [list, setList] = useState(seedDisputes);
  const [tab, setTab] = useState('all');
  const [selected, setSelected] = useState(null);

  // Load disputes from the backend; keep the mock seed as fallback on error.
  const { data: apiData, loading, refetch } = useApi(() => adminApi.listDisputes(), { fallback: null });
  useEffect(() => {
    if (apiData?.disputes) setList(apiData.disputes.map(mapDispute));
  }, [apiData]);

  const counts = useMemo(() => {
    const c = { all: list.length };
    DISPUTE_STATUSES.forEach((s) => (c[s] = list.filter((d) => d.status === s).length));
    return c;
  }, [list]);

  const tabs = [
    { key: 'all', label: 'All', count: counts.all },
    ...DISPUTE_STATUSES.map((s) => ({ key: s, label: STATUS_META[s].label, count: counts[s] })),
  ];

  const rows = useMemo(() => (tab === 'all' ? list : list.filter((d) => d.status === tab)), [list, tab]);
  const selectedLive = selected ? list.find((d) => d.id === selected.id) : null;

  const resolve = async (id, notes) => {
    // Optimistic local update.
    setList((l) => l.map((d) => (d.id === id ? { ...d, status: 'resolved', notes } : d)));
    try {
      await adminApi.resolveDispute(id, { resolution: notes });
      refetch();
    } catch (_) {
      // Local state already reflects the resolution; leave it as the fallback.
    }
  };
  const review = (id) => setList((l) => l.map((d) => (d.id === id ? { ...d, status: 'reviewing' } : d)));

  return (
    <div>
      <PageHeader title="Disputes" subtitle="Disputed transactions requiring review" actions={loading ? <InlineLoader /> : null} />

      <Card>
        <div className="px-4 pt-2">
          <Tabs tabs={tabs} active={tab} onChange={setTab} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 font-medium">Dispute ID</th>
                <th className="px-4 py-3 font-medium">Order ID</th>
                <th className="px-4 py-3 font-medium">Raised By</th>
                <th className="px-4 py-3 font-medium">Reason</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {rows.map((d) => (
                <tr key={d.id} className="cursor-pointer text-gray-200 hover:bg-gray-800/40" onClick={() => setSelected(d)}>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{d.id}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{d.orderId}</td>
                  <td className="px-4 py-3">
                    <div className="text-gray-100">{d.raisedBy}</div>
                    <div className="text-xs capitalize text-gray-500">{d.raisedByRole}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{d.reason}</td>
                  <td className="px-4 py-3 font-medium">{inr(d.amountInr)}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{d.createdAt}</td>
                  <td className="px-4 py-3"><Badge color={STATUS_META[d.status].color}>{STATUS_META[d.status].label}</Badge></td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" onClick={() => setSelected(d)}>Review</Button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="py-10 text-center text-sm text-gray-500">No disputes in this view</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <DisputeModal dispute={selectedLive} onClose={() => setSelected(null)} onResolve={resolve} onReview={review} />
    </div>
  );
}
