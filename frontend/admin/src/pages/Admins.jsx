import { useMemo, useState } from 'react';
import { Card, Badge, SearchInput, PageHeader } from '../components/ui';
import { previewAdmins } from '../utils/previewData';

/**
 * Preview page — no admin-user-management endpoint exists in the backend
 * yet. Read-only on purpose: no add/edit/remove actions are shown here,
 * since those would be exactly the kind of credential/permission change the
 * project rules forbid faking.
 */
export default function Admins() {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return query ? previewAdmins.filter((a) => `${a.email} ${a.role}`.toLowerCase().includes(query)) : previewAdmins;
  }, [q]);

  return (
    <div>
      <PageHeader title="Admins" subtitle="Platform administrator accounts" />

      <div
        className="mb-5 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm"
        style={{ borderColor: 'var(--cardborder)', background: 'var(--hover)', color: 'var(--muted)' }}
      >
        <Badge color="gray">Preview</Badge>
        <span>
          This page is not connected to a live admin-management system yet — it's read-only. Rows below are illustrative
          sample data, and no add/edit/remove actions are available here.
        </span>
      </div>

      <Card className="mb-4 p-4">
        <SearchInput value={q} onChange={setQ} placeholder="Search email, role…" className="sm:max-w-xs" />
      </Card>

      <Card>
        <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--cardborder)' }}>
          <h2 className="font-semibold" style={{ color: 'var(--text)' }}>Admin Accounts</h2>
          <Badge color="gray">Sample data</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ borderBottom: '1px solid var(--cardborder)', color: 'var(--muted)' }}>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Last Active</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id} className="tf-row-hover" style={{ color: 'var(--text)', borderTop: '1px solid var(--cardborder)' }}>
                  <td className="px-4 py-3">{a.email}</td>
                  <td className="px-4 py-3"><Badge color={a.role === 'super_admin' ? 'red' : 'gray'}>{a.role}</Badge></td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--muted)' }}>{a.lastActive}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={3} className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>No admins match your search</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
