import { useMemo, useState } from 'react';
import { Card, Badge, Button, SearchInput, Select, Pagination, PageHeader, DataTable, Th, EmptyState, LoadingState } from '../components/ui';
import { IconRefresh, IconBell } from '../components/icons';
import { useApi } from '../hooks/useApi';
import { getTransactions } from '../lib/ngoApi';
import { notifications, maskUpi, ACCOUNT_TYPES } from '../utils/mock';

const PER_PAGE = 8;

// Map an ngo-backend Transaction doc (see ngo-backend/src/models/Transaction.js)
// onto the row shape this table renders. `bank` stays null — nothing populates
// a receiving-account identity on these rows today (same as the old API this
// replaced); `utr` (the bank/UPI reference, e.g. an RRN) is the most useful
// "Transaction ID" available, so txnId (the platform's own order id) is shown
// as the Notification ID instead.
function apiToRow(n) {
  return {
    id: n._id,
    notificationId: n.txnId || n._id,
    time: n.scrapedAt || n.createdAt || '—',
    amount: n.amount,
    currency: 'INR',
    bank: null,
    method: n.platform,
    transactionId: n.utr || '—',
    description: n.payerName
      ? `Payment from ${n.payerName}${n.payerUpiId ? ` (${n.payerUpiId})` : ''}`
      : 'Payment received',
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
    () => getTransactions().then((list) => (list || []).map(apiToRow)),
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
            {loading && <span style={{ color: 'var(--muted)', fontSize: 12 }}>Loading…</span>}
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

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <DataTable minWidth={960}>
          <thead>
            <tr>
              <Th>Notification ID</Th>
              <Th>Time</Th>
              <Th>Amount</Th>
              <Th>Currency</Th>
              <Th>My Bank</Th>
              <Th>Method</Th>
              <Th>Transaction ID</Th>
              <Th>Description</Th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((n) => {
              const method = ACCOUNT_TYPES[n.method];
              return (
                <tr key={n.id} className="tf-row-hover" style={{ borderBottom: '1px solid var(--cardborder)', color: 'var(--text)' }}>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--muted)' }}>{n.notificationId}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>{n.time}</td>
                  <td className="px-4 py-3 font-medium">₹{Number(n.amount).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--muted)' }}>{n.currency}</td>
                  <td className="px-4 py-3">
                    {n.bank ? (
                      <>
                        <div className="text-xs font-medium" style={{ color: 'var(--text)' }}>{n.bank.accountName}</div>
                        <div className="text-xs" style={{ color: 'var(--muted)' }}>{maskUpi(n.bank.upiId)}</div>
                      </>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--muted)' }}>—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {method ? (
                      <Badge color={method.color}>{method.label}</Badge>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--muted)' }}>{n.method || '—'}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--muted)' }}>{n.transactionId}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text)' }}>{n.description}</td>
                </tr>
              );
            })}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={8}>
                  {loading && rows.length === 0 ? (
                    <LoadingState label="Loading notifications…" />
                  ) : (
                    <EmptyState
                      icon={IconBell}
                      title={rows.length === 0 ? 'No notifications yet' : 'No notifications match your filters'}
                      message={rows.length === 0 ? 'Detected payments will show up here automatically.' : undefined}
                    />
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </DataTable>
        <div style={{ borderTop: '1px solid var(--cardborder)' }}>
          <Pagination page={page} perPage={PER_PAGE} total={filtered.length} onPage={setPage} />
        </div>
      </Card>
    </div>
  );
}
