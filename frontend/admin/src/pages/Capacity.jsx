import { Card, Badge, StatCard, PageHeader } from '../components/ui';
import { IconWallet, IconUsers, IconAlertTriangle, IconGauge } from '../components/icons';
import { previewCapacity, previewCapacityByTrader } from '../utils/previewData';
import { inr, pct } from '../utils/mock';

/** Preview page — no /admin/capacity endpoint exists in the backend yet. */
export default function Capacity() {
  const usedPct = (previewCapacity.usedTodayInr / previewCapacity.totalDailyLimitInr) * 100;

  return (
    <div>
      <PageHeader title="Capacity" subtitle="Platform daily-limit utilization across traders" />

      <div
        className="mb-5 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm"
        style={{ borderColor: 'var(--cardborder)', background: 'var(--hover)', color: 'var(--muted)' }}
      >
        <Badge color="gray">Preview</Badge>
        <span>This page is not connected to real capacity data yet. Figures below are illustrative sample data.</span>
      </div>

      <div className="tf-grid mb-6">
        <StatCard label="Daily Limit (sample)" value={inr(previewCapacity.totalDailyLimitInr)} icon={IconWallet} accent="red" index={0} />
        <StatCard label="Used Today (sample)" value={inr(previewCapacity.usedTodayInr)} icon={IconGauge} accent="amber" sub={pct(usedPct)} index={1} />
        <StatCard label="Active Accounts (sample)" value={previewCapacity.activeAccounts} icon={IconUsers} accent="sky" index={2} />
        <StatCard label="Strained Accounts (sample)" value={previewCapacity.strainedAccounts} icon={IconAlertTriangle} accent="red" index={3} />
      </div>

      <Card>
        <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--cardborder)' }}>
          <h2 className="font-semibold" style={{ color: 'var(--text)' }}>Utilization by Trader</h2>
          <Badge color="gray">Sample data</Badge>
        </div>
        <div className="space-y-4 p-4">
          {previewCapacityByTrader.map((t) => (
            <div key={t.trader}>
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span style={{ color: 'var(--text)' }}>{t.trader}</span>
                <span style={{ color: 'var(--muted)' }}>{t.usedPct}% of {inr(t.limitInr)}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--hover)' }}>
                <div
                  className="h-full rounded-full"
                  style={{ width: `${t.usedPct}%`, background: t.usedPct >= 85 ? '#ef4444' : t.usedPct >= 65 ? '#f59e0b' : '#22c55e' }}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
