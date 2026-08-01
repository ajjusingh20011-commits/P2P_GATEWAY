import { Card, Badge, StatCard, PageHeader } from '../components/ui';
import { IconRupee, IconTransactions, IconActivity, IconClock } from '../components/icons';
import { previewReportSummary, previewDailyVolume, previewMethodBreakdown } from '../utils/previewData';
import { inr, pct } from '../utils/mock';

/**
 * Preview page — no merchant reporting endpoint exists in the backend yet
 * (see merchantRoutes.js). Fed entirely by src/utils/previewData.js, never
 * a real fetcher. See Sidebar.jsx's `preview: true` nav flag.
 */
export default function Reports() {
  const maxVolume = Math.max(...previewDailyVolume.map((d) => d.payinInr + d.payoutInr)) || 1;

  return (
    <div>
      <PageHeader title="Reports" subtitle="Pay-in and payout volume trends" />

      <div
        className="mb-5 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm"
        style={{ borderColor: 'var(--cardborder)', background: 'var(--hover)', color: 'var(--muted)' }}
      >
        <Badge color="gray">Preview</Badge>
        <span>This page is not connected to real reporting data yet. Figures below are illustrative sample data.</span>
      </div>

      <div className="tf-grid mb-6">
        <StatCard label="Total Pay-in (sample)" value={inr(previewReportSummary.totalPayinInr)} icon={IconRupee} accent="indigo" index={0} />
        <StatCard label="Total Payout (sample)" value={inr(previewReportSummary.totalPayoutInr)} icon={IconTransactions} accent="sky" index={1} />
        <StatCard label="Success Rate (sample)" value={pct(previewReportSummary.successRate)} icon={IconActivity} accent="emerald" index={2} />
        <StatCard label="Avg. Settlement Time (sample)" value={`${previewReportSummary.avgSettlementHours}h`} icon={IconClock} accent="amber" index={3} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: 0 }}>Daily Volume</h2>
            <Badge color="gray">Sample data</Badge>
          </div>
          <div className="flex h-44 items-end gap-2">
            {previewDailyVolume.map((d) => {
              const total = d.payinInr + d.payoutInr;
              const h = Math.round((total / maxVolume) * 100);
              const payinShare = Math.round((d.payinInr / total) * 100);
              return (
                <div key={d.day} className="flex flex-1 flex-col items-center justify-end" style={{ height: '100%' }}>
                  <div className="flex w-full flex-col justify-end overflow-hidden rounded-t" style={{ height: `${h}%` }}>
                    <div style={{ height: `${100 - payinShare}%`, background: '#3b82f6' }} />
                    <div style={{ height: `${payinShare}%`, background: 'var(--accent)' }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between text-[10px]" style={{ color: 'var(--muted)' }}>
            {previewDailyVolume.map((d) => <span key={d.day}>{d.day}</span>)}
          </div>
          <div className="mt-4 flex items-center gap-4 text-xs" style={{ color: 'var(--muted)' }}>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full" style={{ background: 'var(--accent)' }} /> Pay-in</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full" style={{ background: '#3b82f6' }} /> Payout</span>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-4" style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: '0 0 16px' }}>Method Breakdown</h2>
          <div className="space-y-3">
            {previewMethodBreakdown.map((m) => (
              <div key={m.method}>
                <div className="mb-1 flex items-center justify-between text-xs" style={{ color: 'var(--text)' }}>
                  <span>{m.method}</span>
                  <span style={{ color: 'var(--muted)' }}>{m.share}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--hover)' }}>
                  <div className="h-full rounded-full" style={{ width: `${m.share}%`, background: 'var(--accent)' }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
