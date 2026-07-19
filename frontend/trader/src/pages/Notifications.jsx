import { useMemo, useState } from 'react';
import { Card, Badge, Button, SearchInput, Select, Pagination, PageHeader } from '../components/ui';
import { IconRefresh } from '../components/icons';
import { useApi } from '../hooks/useApi';
import { traderApi } from '../services/api';
import { notifications, maskUpi, ACCOUNT_TYPES } from '../utils/mock';

const PER_PAGE = 8;

// Map a backend notification onto the row shape this table renders. The API has
// no bank object, so `bank` is left null and shown as `—`.
function apiToRow(n) {
  return {
    id: n.id,
    notificationId: n.notification_id,
    time: n.created_at || '—',
    amount: n.amount,
    currency: n.currency,
    bank: null,
    method: n.payment_method,
    transactionId: n.transaction_id,
    description: n.description,
  };
}

// Normalize a mock notification (instant value + fallback) to the same shape.
function mockToRow(n) {
  return {
    id: n.id,
    notificationId: n.notificationId,
    time: n.time,
    amount: n.amount,
    currency: n.currency,
    bank: n.bank,
    method: n.method,
    transactionId: n.transactionId,
    description: n.description,
  };
}

const METHOD_OPTIONS = [
  { value: 'all', label: 'All methods' },
  ...Object.entries(ACCOUNT_TYPES).map(([value, v]) => ({ value, label: v.label })),
];

export default function Notifications() {
  const [filters, setFilters] = useState({ notificationId: '', amount: '', currency: '', bank: '', method: 'all', transactionId: '' });
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);

  // Real notifications overlay the mock; mock stays as instant value + fallback.
  const { data: rows, loading } = useApi(
    () => traderApi.notifications().then((res) => (res.data.data.notifications || []).map(apiToRow)),
    { fallback: notifications.map(mockToRow) }
  );

  const set = (k) => (v) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };

  const filtered = useMemo(() => {
    return rows.filter((n) => {
      if (filters.notificationId && !String(n.notificationId).toLowerCase().includes(filters.notificationId.toLowerCase())) return false;
      if (filters.amount && !String(n.amount).includes(filters.amount.trim())) return false;
      if (filters.currency && !String(n.currency).toLowerCase().includes(filters.currency.toLowerCase())) return false;
      if (filters.bank && !(n.bank?.accountName || '').toLowerCase().includes(filters.bank.toLowerCase())) return false;
      if (filters.method !== 'all' && n.method !== filters.method) return false;
      if (filters.transactionId && !String(n.transactionId).toLowerCase().includes(filters.transactionId.toLowerCase())) return false;
      return true;
    });
  }, [rows, filters]);

  const pageRows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const refresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 600);
  };

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle="Logs of notifications for Automation"
        actions={
          <>
            {loading && <span className="text-xs text-gray-500">Loading…</span>}
            <Button variant="ghost" onClick={refresh}>
              <IconRefresh className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </>
        }
      />

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <SearchInput value={filters.notificationId} onChange={set('notificationId')} placeholder="Notification ID" />
          <SearchInput value={filters.amount} onChange={set('amount')} placeholder="Amount" />
          <SearchInput value={filters.currency} onChange={set('currency')} placeholder="Currency" />
          <SearchInput value={filters.bank} onChange={set('bank')} placeholder="Bank details" />
          <Select value={filters.method} onChange={set('method')} options={METHOD_OPTIONS} />
          <SearchInput value={filters.transactionId} onChange={set('transactionId')} placeholder="Transaction ID" />
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 font-medium">Notification ID</th>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Currency</th>
                <th className="px-4 py-3 font-medium">My Bank</th>
                <th className="px-4 py-3 font-medium">Method</th>
                <th className="px-4 py-3 font-medium">Transaction ID</th>
                <th className="px-4 py-3 font-medium">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {pageRows.map((n) => {
                const method = ACCOUNT_TYPES[n.method];
                return (
                  <tr key={n.id} className="text-gray-200 hover:bg-gray-800/40">
                    <td className="px-4 py-3 font-mono text-xs text-gray-400">{n.notificationId}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{n.time}</td>
                    <td className="px-4 py-3 font-medium">₹{Number(n.amount).toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 text-gray-400">{n.currency}</td>
                    <td className="px-4 py-3">
                      {n.bank ? (
                        <>
                          <div className="text-xs font-medium">{n.bank.accountName}</div>
                          <div className="text-xs text-gray-500">{maskUpi(n.bank.upiId)}</div>
                        </>
                      ) : (
                        <span className="text-xs text-gray-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {method ? (
                        <Badge color={method.color}>{method.label}</Badge>
                      ) : (
                        <span className="text-xs text-gray-400">{n.method || '—'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-400">{n.transactionId}</td>
                    <td className="px-4 py-3 text-xs text-gray-300">{n.description}</td>
                  </tr>
                );
              })}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-sm text-gray-500">
                    {rows.length === 0 ? 'No notifications yet' : 'No notifications match your filters'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-gray-800">
          <Pagination page={page} perPage={PER_PAGE} total={filtered.length} onPage={setPage} />
        </div>
      </Card>
    </div>
  );
}
