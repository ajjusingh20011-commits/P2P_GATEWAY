import { useEffect, useMemo, useState } from 'react';
import { Card, Badge, Button, Tabs, PageHeader, StatCard, InlineLoader } from '../components/ui';
import AdminIdPopover from '../components/AdminIdPopover';
import ConfirmModal from '../components/ConfirmModal';
import { IconSettlement, IconRupee, IconWallet } from '../components/icons';
import { adminApi } from '../services/api';
import { inr, usdt } from '../utils/mock';
import { toast } from '../components/toast';

const TABS = [
  { key: 'traders', label: 'Per Trader' },
  { key: 'merchants', label: 'Per Merchant' },
  { key: 'history', label: 'History' },
];

const fmtDate = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

// All three tabs derive from ONE real endpoint (GET /admin/settlements —
// a flat list of real Settlement rows). Per-trader/per-merchant are real
// client-side aggregations of that same real data, not fabricated summaries
// — there's no separate aggregation endpoint, so this reuses what's real
// rather than inventing new numbers.
function aggregate(rows, key, labelFrom) {
  const map = new Map();
  for (const r of rows) {
    const id = key === 'trader' ? r.trader_id : r.merchant_id;
    if (id == null) continue;
    const cur = map.get(id) || { id, name: labelFrom(r), received: 0, platformFee: 0, commission: 0, net: 0, pending: 0 };
    cur.received += Number(r.total_amount) || 0;
    cur.platformFee += Number(r.platform_fee) || 0;
    cur.commission += Number(r.trader_commission) || 0;
    cur.net += Number(r.net_amount) || 0;
    if (r.status === 'pending' || r.status === 'processing') cur.pending += 1;
    map.set(id, cur);
  }
  return [...map.values()];
}

export default function Settlement() {
  const [tab, setTab] = useState('traders');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState(null);

  const load = () => {
    setLoading(true);
    setError('');
    adminApi
      .listSettlements()
      .then((data) => setRows(data.settlements || []))
      .catch(() => setError('Could not load settlements.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const byTrader = useMemo(() => aggregate(rows, 'trader', (r) => `Trader #${r.trader_id}`), [rows]);
  const byMerchant = useMemo(() => aggregate(rows, 'merchant', (r) => r.merchant?.business_name || `Merchant #${r.merchant_id}`), [rows]);

  const totals = useMemo(() => {
    const received = rows.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
    const platformFee = rows.reduce((s, r) => s + (Number(r.platform_fee) || 0), 0);
    const commission = rows.reduce((s, r) => s + (Number(r.trader_commission) || 0), 0);
    const pending = rows.filter((r) => r.status === 'pending' || r.status === 'processing').length;
    return { received, platformFee, commission, pending };
  }, [rows]);

  const confirmTrigger = async () => {
    setRunning(true);
    try {
      await adminApi.triggerSettlement();
      toast('Settlement run triggered', 'success');
      setLastRun(new Date().toLocaleTimeString('en-GB'));
      setConfirmOpen(false);
      load();
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to trigger settlement', 'error');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Settlement"
        subtitle="Daily settlement overview"
        actions={
          <div className="flex items-center gap-3">
            {loading && <InlineLoader />}
            {lastRun && <span className="text-xs text-emerald-400">Last run {lastRun}</span>}
            <Button onClick={() => setConfirmOpen(true)} disabled={running}>
              <IconSettlement className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} />
              {running ? 'Settling…' : 'Trigger manual settlement'}
            </Button>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border px-4 py-2.5 text-sm" style={{ borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
          {error}
        </div>
      )}

      {/* Summary */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Received" value={inr(totals.received)} icon={IconRupee} accent="red" />
        <StatCard label="Platform Fees" value={inr(totals.platformFee)} icon={IconWallet} accent="emerald" />
        <StatCard label="Trader Commissions" value={inr(totals.commission)} icon={IconWallet} accent="sky" />
        <StatCard label="Pending Settlements" value={totals.pending} icon={IconSettlement} accent="amber" />
      </div>

      <Card>
        <div className="px-4 pt-2">
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
        </div>

        <div className="overflow-x-auto">
          {tab === 'traders' && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--cardborder)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="px-4 py-3 font-medium">Trader</th>
                  <th className="px-4 py-3 font-medium">Received</th>
                  <th className="px-4 py-3 font-medium">Platform Fee</th>
                  <th className="px-4 py-3 font-medium">Commission</th>
                  <th className="px-4 py-3 font-medium">Net</th>
                  <th className="px-4 py-3 font-medium">Pending</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--cardborder)]">
                {byTrader.map((t) => (
                  <tr key={t.id} className="text-[var(--text)] hover:bg-[var(--hover)]">
                    <td className="px-4 py-3 font-medium">{t.name}</td>
                    <td className="px-4 py-3">{inr(t.received)}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">{inr(t.platformFee)}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">{inr(t.commission)}</td>
                    <td className="px-4 py-3 font-medium text-emerald-400">{inr(t.net)}</td>
                    <td className="px-4 py-3">{t.pending > 0 ? <Badge color="amber">{t.pending}</Badge> : <Badge color="green">0</Badge>}</td>
                  </tr>
                ))}
                {!loading && byTrader.length === 0 && (
                  <tr><td colSpan={6} className="py-10 text-center text-sm text-[var(--muted)]">No settlement records yet</td></tr>
                )}
              </tbody>
            </table>
          )}

          {tab === 'merchants' && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--cardborder)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="px-4 py-3 font-medium">Merchant</th>
                  <th className="px-4 py-3 font-medium">Volume</th>
                  <th className="px-4 py-3 font-medium">Fees Charged</th>
                  <th className="px-4 py-3 font-medium">Net Payable</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--cardborder)]">
                {byMerchant.map((m) => (
                  <tr key={m.id} className="text-[var(--text)] hover:bg-[var(--hover)]">
                    <td className="px-4 py-3 font-medium">{m.name}</td>
                    <td className="px-4 py-3">{inr(m.received)}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">{inr(m.platformFee)}</td>
                    <td className="px-4 py-3 font-medium text-emerald-400">{inr(m.net)}</td>
                  </tr>
                ))}
                {!loading && byMerchant.length === 0 && (
                  <tr><td colSpan={4} className="py-10 text-center text-sm text-[var(--muted)]">No settlement records yet</td></tr>
                )}
              </tbody>
            </table>
          )}

          {tab === 'history' && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--cardborder)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="w-10 px-4 py-3" />
                  <th className="px-4 py-3 font-medium">Settled At</th>
                  <th className="px-4 py-3 font-medium">Trader</th>
                  <th className="px-4 py-3 font-medium">Merchant</th>
                  <th className="px-4 py-3 font-medium">Gross</th>
                  <th className="px-4 py-3 font-medium">Net</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--cardborder)]">
                {rows.map((h) => (
                  <tr key={h.id} className="text-[var(--text)] hover:bg-[var(--hover)]">
                    <td className="px-4 py-3">
                      <AdminIdPopover rows={[{ label: 'Settlement ID', value: h.id }, { label: 'Trader ID', value: h.trader_id }, { label: 'Merchant ID', value: h.merchant_id }]} />
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--muted)]">{fmtDate(h.settled_at)}</td>
                    <td className="px-4 py-3">#{h.trader_id}</td>
                    <td className="px-4 py-3">{h.merchant?.business_name || `#${h.merchant_id}`}</td>
                    <td className="px-4 py-3">{inr(h.total_amount)}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">{usdt(h.net_amount)}</td>
                    <td className="px-4 py-3"><Badge color={h.status === 'completed' ? 'green' : h.status === 'failed' ? 'red' : 'amber'}>{h.status}</Badge></td>
                  </tr>
                ))}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={7} className="py-10 text-center text-sm text-[var(--muted)]">No settlement records yet</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <ConfirmModal
        open={confirmOpen}
        title="Trigger manual settlement?"
        description="This runs the real settlement job now, outside its normal schedule: it groups today's confirmed pay-in orders by trader/merchant, credits the resulting commission and net amounts, and resets every trader's daily-usage counter for the new day. It cannot be undone once it starts."
        tone="danger"
        confirmLabel={running ? 'Settling…' : 'Trigger settlement'}
        busy={running}
        onConfirm={confirmTrigger}
        onClose={() => setConfirmOpen(false)}
      />
    </div>
  );
}
