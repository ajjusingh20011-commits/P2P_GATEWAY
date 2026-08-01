import { useState } from 'react';
import { Card, Badge, Button, PageHeader, Modal, Input } from '../components/ui';
import { IconBalance } from '../components/icons';
import { stats, settlements, inr, usdt } from '../utils/mock';
import { useApi } from '../hooks/useApi';
import { merchantApi } from '../services/api';

export default function Balance() {
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [amount, setAmount] = useState('');
  const [requested, setRequested] = useState(false);

  const { data: bal, loading } = useApi(
    () => merchantApi.balance().then((res) => res.data.data),
    { fallback: { balance_usdt: stats.balanceUsdt, pending_inr: 0 } }
  );
  // Same real field the sidebar (MerchantLayout.jsx) and Dashboard already
  // read — `balance` is a separate, unused legacy column on the Merchant
  // model. Reading it here instead of balance_usdt was a real bug: this
  // page's headline balance could silently disagree with the sidebar's.
  const availableUsdt = bal.balance_usdt ?? bal.balance ?? stats.balanceUsdt;

  // No merchant withdrawal-request endpoint exists in the backend yet
  // (confirmed: not present in merchantRoutes.js). This used to fake a
  // setTimeout "success" with no backend call at all — replaced with an
  // honest, clearly-labeled preview state instead, per the rule against
  // showing fake server success for balance adjustments.
  const submit = () => {
    if (!Number(amount)) return;
    setRequested(true);
  };

  return (
    <div>
      <PageHeader
        title="Balance"
        subtitle={loading ? 'Loading balance…' : 'Available funds and settlements'}
        actions={<Button onClick={() => setShowWithdraw(true)}>Request withdrawal</Button>}
      />

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-6" style={{ background: 'linear-gradient(145deg, #22c55e, var(--accent))', border: 'none' }}>
          <div className="flex items-center gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.85)' }}>
            <IconBalance className="h-5 w-5" />
            <span>Available Settlement Balance</span>
          </div>
          <p className="mt-3 text-3xl font-semibold text-white">{usdt(availableUsdt)}</p>
          <Button className="mt-4 w-full" variant="ghost" onClick={() => setShowWithdraw(true)} style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }}>Withdraw funds</Button>
        </Card>

        <Card className="p-6">
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Pending settlement</p>
          <p className="mt-2 text-2xl font-semibold" style={{ color: 'var(--text)' }}>{inr(bal.pending_inr ?? 0)}</p>
          <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>From orders under review or claimed paid</p>
        </Card>

        <Card className="p-6">
          <p className="text-sm" style={{ color: 'var(--muted)' }}>This month settled <span style={{ fontSize: 10, textTransform: 'uppercase', opacity: 0.7 }}>(preview)</span></p>
          <p className="mt-2 text-2xl font-semibold" style={{ color: 'var(--text)' }}>{inr(stats.monthlyVolumeInr)}</p>
          <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>No real settlement-history endpoint yet</p>
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--cardborder)' }}>
          <h2 className="font-semibold" style={{ color: 'var(--text)' }}>Settlement History</h2>
          <Badge color="gray">Preview data</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ borderBottom: '1px solid var(--cardborder)', color: 'var(--muted)' }}>
                <th className="px-4 py-3 font-medium">Settlement ID</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Gross</th>
                <th className="px-4 py-3 font-medium">Fee</th>
                <th className="px-4 py-3 font-medium">Net Payout</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {settlements.map((s) => (
                <tr key={s.id} className="tf-row-hover" style={{ color: 'var(--text)', borderTop: '1px solid var(--cardborder)' }}>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--muted)' }}>{s.id}</td>
                  <td className="px-4 py-3">{s.date}</td>
                  <td className="px-4 py-3">{inr(s.grossInr)}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--muted)' }}>{inr(s.feeInr)}</td>
                  <td className="px-4 py-3 font-medium" style={{ color: '#22c55e' }}>{usdt(s.netUsdt)}</td>
                  <td className="px-4 py-3"><Badge color={s.status === 'completed' ? 'green' : 'amber'}>{s.status}</Badge></td>
                </tr>
              ))}
              {settlements.length === 0 && (
                <tr><td colSpan={6} className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>No data yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={showWithdraw}
        onClose={() => setShowWithdraw(false)}
        size="md"
        title="Request Withdrawal"
        subtitle={`Available: ${usdt(availableUsdt)} · Preview — not yet connected to a live payout system`}
        footer={
          requested ? (
            <Button variant="ghost" onClick={() => setShowWithdraw(false)}>Close</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setShowWithdraw(false)}>Cancel</Button>
              <Button onClick={submit}>Preview request</Button>
            </>
          )
        }
      >
        {requested ? (
          <div
            className="rounded-lg border px-4 py-3 text-sm"
            style={{ borderColor: 'var(--cardborder)', background: 'var(--hover)', color: 'var(--text)' }}
          >
            <strong>Preview only.</strong> Withdrawal requests aren't connected to a live payout system yet — nothing was submitted. Contact support for a manual withdrawal.
          </div>
        ) : (
          <div>
            <label className="mb-1.5 block text-sm" style={{ color: 'var(--muted)' }}>Amount (USDT)</label>
            <Input type="number" min="1" max={availableUsdt} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 1000" />
            <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>Funds are sent to your registered USDT (TRC20) wallet.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
