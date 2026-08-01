import { useMemo, useState } from 'react';
import { Card, Badge, SearchInput, PageHeader } from '../components/ui';
import { previewRoutingRules } from '../utils/previewData';

/** Preview page — no /admin/routing endpoint exists in the backend yet. */
export default function Routing() {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return query ? previewRoutingRules.filter((r) => `${r.name} ${r.method}`.toLowerCase().includes(query)) : previewRoutingRules;
  }, [q]);

  return (
    <div>
      <PageHeader title="Routing" subtitle="Payment method routing rules and priority" />

      <div
        className="mb-5 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm"
        style={{ borderColor: 'var(--cardborder)', background: 'var(--hover)', color: 'var(--muted)' }}
      >
        <Badge color="gray">Preview</Badge>
        <span>This page is not connected to the live routing engine yet. The rules below are illustrative sample data.</span>
      </div>

      <Card className="mb-4 p-4">
        <SearchInput value={q} onChange={setQ} placeholder="Search rule, method…" className="sm:max-w-xs" />
      </Card>

      <Card>
        <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--cardborder)' }}>
          <h2 className="font-semibold" style={{ color: 'var(--text)' }}>Routing Rules</h2>
          <Badge color="gray">Sample data</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ borderBottom: '1px solid var(--cardborder)', color: 'var(--muted)' }}>
                <th className="px-4 py-3 font-medium">Rule</th>
                <th className="px-4 py-3 font-medium">Method</th>
                <th className="px-4 py-3 font-medium">Priority</th>
                <th className="px-4 py-3 font-medium">Matched Today</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="tf-row-hover" style={{ color: 'var(--text)', borderTop: '1px solid var(--cardborder)' }}>
                  <td className="px-4 py-3">{r.name}</td>
                  <td className="px-4 py-3 uppercase text-xs" style={{ color: 'var(--muted)' }}>{r.method}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--muted)' }}>#{r.priority}</td>
                  <td className="px-4 py-3">{r.matchedToday}</td>
                  <td className="px-4 py-3"><Badge color={r.status === 'active' ? 'green' : 'gray'}>{r.status}</Badge></td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>No rules match your search</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
