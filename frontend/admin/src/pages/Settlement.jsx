import { useMemo, useState } from 'react';
import { Card, Badge, Button, Tabs, PageHeader, StatCard } from '../components/ui';
import { IconSettlement, IconRupee, IconWallet } from '../components/icons';
import { settlementTraders, settlementMerchants, settlementHistory, inr, usdt } from '../utils/mock';

const TABS = [
  { key: 'traders', label: 'Per Trader' },
  { key: 'merchants', label: 'Per Merchant' },
  { key: 'history', label: 'History' },
];

export default function Settlement() {
  const [tab, setTab] = useState('traders');
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState(null);

  const totals = useMemo(() => {
    const received = settlementTraders.reduce((s, t) => s + t.received, 0);
    const platformFee = settlementTraders.reduce((s, t) => s + t.platformFee, 0);
    const commission = settlementTraders.reduce((s, t) => s + t.commission, 0);
    const pending = settlementTraders.filter((t) => t.status === 'pending').length;
    return { received, platformFee, commission, pending };
  }, []);

  const runSettlement = () => {
    setRunning(true);
    setTimeout(() => {
      setRunning(false);
      setLastRun(new Date().toLocaleTimeString('en-GB'));
    }, 1200);
  };

  return (
    <div>
      <PageHeader
        title="Settlement"
        subtitle="Daily settlement overview"
        actions={
          <div className="flex items-center gap-3">
            {lastRun && <span className="text-xs text-emerald-400">Last run {lastRun}</span>}
            <Button onClick={runSettlement} disabled={running}>
              <IconSettlement className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} />
              {running ? 'Settling…' : 'Trigger manual settlement'}
            </Button>
          </div>
        }
      />

      {/* Summary */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Received (Today)" value={inr(totals.received)} icon={IconRupee} accent="red" />
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
                <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3 font-medium">Trader</th>
                  <th className="px-4 py-3 font-medium">Received</th>
                  <th className="px-4 py-3 font-medium">Platform Fee</th>
                  <th className="px-4 py-3 font-medium">Commission</th>
                  <th className="px-4 py-3 font-medium">Net</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {settlementTraders.map((t) => (
                  <tr key={t.id} className="text-gray-200 hover:bg-gray-800/40">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-100">{t.name}</div>
                      <div className="text-xs text-gray-500">#{t.id}</div>
                    </td>
                    <td className="px-4 py-3">{inr(t.received)}</td>
                    <td className="px-4 py-3 text-gray-400">{inr(t.platformFee)}</td>
                    <td className="px-4 py-3 text-gray-400">{inr(t.commission)}</td>
                    <td className="px-4 py-3 font-medium text-emerald-400">{inr(t.net)}</td>
                    <td className="px-4 py-3"><Badge color={t.status === 'settled' ? 'green' : 'amber'}>{t.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'merchants' && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3 font-medium">Merchant</th>
                  <th className="px-4 py-3 font-medium">Volume</th>
                  <th className="px-4 py-3 font-medium">Commission Rate</th>
                  <th className="px-4 py-3 font-medium">Fees Charged</th>
                  <th className="px-4 py-3 font-medium">Net Payable</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {settlementMerchants.map((m) => (
                  <tr key={m.id} className="text-gray-200 hover:bg-gray-800/40">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-100">{m.name}</div>
                      <div className="text-xs text-gray-500">#{m.id}</div>
                    </td>
                    <td className="px-4 py-3">{inr(m.volume)}</td>
                    <td className="px-4 py-3 text-gray-400">{m.commissionRate}%</td>
                    <td className="px-4 py-3 text-gray-400">{inr(m.fees)}</td>
                    <td className="px-4 py-3 font-medium text-emerald-400">{inr(m.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'history' && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3 font-medium">Settlement ID</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Gross</th>
                  <th className="px-4 py-3 font-medium">Platform Fee</th>
                  <th className="px-4 py-3 font-medium">Traders Paid</th>
                  <th className="px-4 py-3 font-medium">Parties</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {settlementHistory.map((h) => (
                  <tr key={h.id} className="text-gray-200 hover:bg-gray-800/40">
                    <td className="px-4 py-3 font-mono text-xs text-gray-400">{h.id}</td>
                    <td className="px-4 py-3">{h.date}</td>
                    <td className="px-4 py-3">{inr(h.grossInr)}</td>
                    <td className="px-4 py-3 text-gray-400">{inr(h.platformFeeInr)}</td>
                    <td className="px-4 py-3 text-gray-400">{usdt(h.tradersPaidUsdt)}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{h.tradersCount} traders · {h.merchantsCount} merchants</td>
                    <td className="px-4 py-3"><Badge color="green">{h.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
