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
    { fallback: { balance: stats.balanceUsdt, pending_inr: 84200 } }
  );

  const submit = () => {
    if (!Number(amount)) return;
    setRequested(true);
    setTimeout(() => {
      setShowWithdraw(false);
      setRequested(false);
      setAmount('');
    }, 1200);
  };

  return (
    <div>
      <PageHeader
        title="Balance"
        subtitle={loading ? 'Loading balance…' : 'Available funds and settlements'}
        actions={<Button onClick={() => setShowWithdraw(true)}>Request withdrawal</Button>}
      />

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="bg-gradient-to-br from-indigo-600/20 to-gray-900 p-6 lg:col-span-1">
          <div className="flex items-center gap-2 text-indigo-300">
            <IconBalance className="h-5 w-5" />
            <span className="text-sm">Available Balance</span>
          </div>
          <p className="mt-3 text-3xl font-semibold text-white">{usdt(bal.balance ?? stats.balanceUsdt)}</p>
          <p className="mt-1 text-sm text-gray-400">≈ {inr((bal.balance ?? stats.balanceUsdt) * 89)}</p>
          <Button className="mt-4 w-full" onClick={() => setShowWithdraw(true)}>Withdraw funds</Button>
        </Card>

        <Card className="p-6">
          <p className="text-sm text-gray-400">This month settled</p>
          <p className="mt-2 text-2xl font-semibold text-white">{inr(stats.monthlyVolumeInr)}</p>
          <p className="mt-1 text-xs text-emerald-400">▲ 9.2% vs last month</p>
        </Card>

        <Card className="p-6">
          <p className="text-sm text-gray-400">Pending settlement</p>
          <p className="mt-2 text-2xl font-semibold text-white">{inr(bal.pending_inr ?? 84200)}</p>
          <p className="mt-1 text-xs text-gray-500">Next settlement in ~6h</p>
        </Card>
      </div>

      <Card>
        <div className="border-b border-gray-800 p-4">
          <h2 className="font-semibold text-white">Settlement History</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 font-medium">Settlement ID</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Gross</th>
                <th className="px-4 py-3 font-medium">Fee</th>
                <th className="px-4 py-3 font-medium">Net Payout</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {settlements.map((s) => (
                <tr key={s.id} className="text-gray-200 hover:bg-gray-800/40">
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{s.id}</td>
                  <td className="px-4 py-3">{s.date}</td>
                  <td className="px-4 py-3">{inr(s.grossInr)}</td>
                  <td className="px-4 py-3 text-gray-400">{inr(s.feeInr)}</td>
                  <td className="px-4 py-3 font-medium text-emerald-400">{usdt(s.netUsdt)}</td>
                  <td className="px-4 py-3"><Badge color={s.status === 'completed' ? 'green' : 'amber'}>{s.status}</Badge></td>
                </tr>
              ))}
              {settlements.length === 0 && (
                <tr><td colSpan={6} className="py-10 text-center text-sm text-gray-500">No data yet</td></tr>
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
        subtitle={`Available: ${usdt(bal.balance ?? stats.balanceUsdt)}`}
        footer={
          requested ? null : (
            <>
              <Button variant="ghost" onClick={() => setShowWithdraw(false)}>Cancel</Button>
              <Button onClick={submit}>Submit request</Button>
            </>
          )
        }
      >
        {requested ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            ✓ Withdrawal request submitted. It will be processed at the next settlement window.
          </div>
        ) : (
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">Amount (USDT)</label>
            <Input type="number" min="1" max={bal.balance ?? stats.balanceUsdt} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 1000" />
            <p className="mt-2 text-xs text-gray-500">Funds are sent to your registered USDT (TRC20) wallet.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
