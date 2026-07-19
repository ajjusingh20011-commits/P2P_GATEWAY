import { useEffect, useMemo, useState } from 'react';
import { Card, Badge, Button, Tabs, Pagination, PageHeader } from '../components/ui';
import { useApi } from '../hooks/useApi';
import { traderApi } from '../services/api';
import { payouts, inr, ACCOUNT_TYPES } from '../utils/mock';

const PER_PAGE = 25;

// Map a backend payout onto the row shape this table renders. The API has no
// waiting timer or priority, so those are defaulted.
function apiToRow(p) {
  return {
    id: p.id,
    receivedAt: p.created_at || '—',
    waitingSeconds: 0,
    method: p.payment_method,
    amountInr: p.amount_inr,
    priority: 'normal',
    status: p.status,
  };
}

const TABS = [
  { key: 'awaiting', label: 'Awaiting Processing' },
  { key: 'processing', label: 'In Processing' },
  { key: 'settlement', label: 'Awaiting Settlement' },
  { key: 'completed', label: 'Settlement Completed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'dispute', label: 'Dispute' },
];

function fmtDuration(sec) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** Live countdown; turns red under 2 minutes remaining. */
function WaitingTimer({ seconds }) {
  const [remaining, setRemaining] = useState(seconds);
  useEffect(() => {
    setRemaining(seconds);
    const id = setInterval(() => setRemaining((r) => (r > 0 ? r - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [seconds]);
  const urgent = remaining <= 120;
  return (
    <span className={`font-mono text-sm font-medium ${urgent ? 'text-red-400' : 'text-gray-300'}`}>
      {fmtDuration(remaining)}
    </span>
  );
}

export default function Payouts() {
  const [tab, setTab] = useState('awaiting');
  const [page, setPage] = useState(1);

  // Real payouts overlay the mock; mock stays as instant value + fallback.
  const { data: allPayouts, loading } = useApi(
    () => traderApi.payouts().then((res) => (res.data.data.payouts || []).map(apiToRow)),
    { fallback: payouts }
  );

  const counts = useMemo(() => {
    const c = {};
    TABS.forEach((t) => (c[t.key] = allPayouts.filter((p) => p.status === t.key).length));
    return c;
  }, [allPayouts]);

  const rows = useMemo(() => allPayouts.filter((p) => p.status === tab), [allPayouts, tab]);
  const pageRows = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const tabsWithCounts = TABS.map((t) => ({
    ...t,
    count: t.key === 'awaiting' && counts[t.key] > 99 ? '99+' : counts[t.key],
  }));

  const changeTab = (k) => {
    setTab(k);
    setPage(1);
  };

  return (
    <div>
      <PageHeader
        title="Buy USDT"
        subtitle="Incoming payout applications"
        actions={loading && <span className="text-xs text-gray-500">Loading…</span>}
      />

      <Card>
        <div className="px-4 pt-2">
          <Tabs tabs={tabsWithCounts} active={tab} onChange={changeTab} />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Received</th>
                <th className="px-4 py-3 font-medium">Waiting</th>
                <th className="px-4 py-3 font-medium">Payment Method</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {pageRows.map((p) => (
                <tr key={p.id} className="text-gray-200 hover:bg-gray-800/40">
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-gray-400">#{p.id}</span>
                    {p.priority === 'high' && (
                      <Badge color="red" className="ml-2">High Priority</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">{p.receivedAt}</td>
                  <td className="px-4 py-3"><WaitingTimer seconds={p.waitingSeconds} /></td>
                  <td className="px-4 py-3">
                    {ACCOUNT_TYPES[p.method] ? (
                      <Badge color={ACCOUNT_TYPES[p.method].color}>{ACCOUNT_TYPES[p.method].label}</Badge>
                    ) : (
                      <span className="text-xs text-gray-400">{p.method || '—'}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium">{inr(p.amountInr)}</td>
                  <td className="px-4 py-3 text-right">
                    {tab === 'awaiting' ? (
                      <Button>Accept for processing</Button>
                    ) : (
                      <span className="text-xs text-gray-500">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-sm text-gray-500">
                    No applications in this tab
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-gray-800">
          <Pagination page={page} perPage={PER_PAGE} total={rows.length} onPage={setPage} />
        </div>
      </Card>
    </div>
  );
}
