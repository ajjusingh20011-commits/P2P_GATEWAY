import { useMemo, useState } from 'react';
import { Card, Badge, Tabs, PageHeader } from '../components/ui';
import { previewRiskSignals } from '../utils/previewData';

const SEVERITY_COLOR = { high: 'red', medium: 'amber', low: 'sky' };

/** Preview page — no /admin/risk endpoint exists in the backend yet. */
export default function Risk() {
  const [level, setLevel] = useState('all');
  const counts = useMemo(() => ({
    all: previewRiskSignals.length,
    high: previewRiskSignals.filter((s) => s.severity === 'high').length,
    medium: previewRiskSignals.filter((s) => s.severity === 'medium').length,
    low: previewRiskSignals.filter((s) => s.severity === 'low').length,
  }), []);
  const filtered = level === 'all' ? previewRiskSignals : previewRiskSignals.filter((s) => s.severity === level);

  return (
    <div>
      <PageHeader title="Risk" subtitle="Fraud and anomaly signals" />

      <div
        className="mb-5 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm"
        style={{ borderColor: 'var(--cardborder)', background: 'var(--hover)', color: 'var(--muted)' }}
      >
        <Badge color="gray">Preview</Badge>
        <span>This page is not connected to a live risk-scoring system yet. The signals below are illustrative sample data.</span>
      </div>

      <Card className="mb-4 p-2">
        <Tabs
          tabs={[
            { key: 'all', label: 'All', count: counts.all },
            { key: 'high', label: 'High', count: counts.high },
            { key: 'medium', label: 'Medium', count: counts.medium },
            { key: 'low', label: 'Low', count: counts.low },
          ]}
          active={level}
          onChange={setLevel}
        />
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--cardborder)' }}>
          <h2 className="font-semibold" style={{ color: 'var(--text)' }}>Recent Signals</h2>
          <Badge color="gray">Sample data</Badge>
        </div>
        {filtered.map((s) => (
          <div key={s.id} className="flex items-start gap-3 px-4 py-3" style={{ borderTop: '1px solid var(--cardborder)' }}>
            <Badge color={SEVERITY_COLOR[s.severity]}>{s.severity}</Badge>
            <div className="flex-1">
              <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{s.type}</p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>{s.detail}</p>
            </div>
            <span className="font-mono text-xs" style={{ color: 'var(--muted)' }}>{s.at}</span>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="px-4 py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>No signals at this level</div>
        )}
      </Card>
    </div>
  );
}
