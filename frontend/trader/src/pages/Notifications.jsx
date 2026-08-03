import { useEffect, useMemo, useState } from 'react';
import { BadgeCheck } from 'lucide-react';
import { Card, Badge, Button, SearchInput, Select, Pagination, PageHeader, EmptyState, LoadingState } from '../components/ui';
import { IconRefresh, IconBell, IconWarning } from '../components/icons';
import { useApi } from '../hooks/useApi';
import { getTransactions } from '../lib/ngoApi';
import { notifications, ACCOUNT_TYPES } from '../utils/mock';

const PER_PAGE = 8;

// Map an ngo-backend Transaction doc (see ngo-backend/src/models/Transaction.js)
// onto the row shape this page renders. `bank` stays unused — nothing populates
// a receiving-account identity on these rows today; `utr` (the bank/UPI
// reference, e.g. an RRN) is the most useful "Transaction ID" available.
function apiToRow(n) {
  return {
    id: n._id,
    notificationId: n.txnId || n._id,
    time: n.scrapedAt || n.createdAt || null,
    amount: n.amount,
    currency: 'INR',
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
    method: n.method,
    transactionId: n.transactionId,
    description: n.description,
  };
}

function fmtTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return d.toLocaleString();
}

const METHOD_OPTIONS = [
  { value: 'all', label: 'All methods' },
  ...Object.entries(ACCOUNT_TYPES).map(([value, v]) => ({ value, label: v.label })),
];

export default function Notifications() {
  const [filters, setFilters] = useState({ notificationId: '', amount: '', currency: '', method: 'all', transactionId: '' });
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);

  // Real notifications overlay the mock; mock stays as instant value + fallback.
  const { data: rows, loading, error, refetch } = useApi(
    () => getTransactions().then((list) => (list || []).map(apiToRow)),
    { fallback: notifications.map(mockToRow) }
  );

  const set = (k) => (v) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };

  // The reference's Notifications page is a plain activity feed with no
  // search — this trader panel's real notification volume can grow large
  // enough that finding a specific past payment matters operationally, so
  // filtering/pagination (already real, already fixed) stay as genuine
  // extra capability layered on top of the reference's simpler layout,
  // same call made for Dashboard's extra sections.
  const filtered = useMemo(() => {
    return rows.filter((n) => {
      if (filters.notificationId && !String(n.notificationId).toLowerCase().includes(filters.notificationId.toLowerCase())) return false;
      if (filters.amount && !String(n.amount).includes(filters.amount.trim())) return false;
      if (filters.currency && !String(n.currency).toLowerCase().includes(filters.currency.toLowerCase())) return false;
      if (filters.method !== 'all' && n.method !== filters.method) return false;
      if (filters.transactionId && !String(n.transactionId).toLowerCase().includes(filters.transactionId.toLowerCase())) return false;
      return true;
    });
  }, [rows, filters]);

  const pageRows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const refresh = () => {
    setRefreshing(true);
    refetch();
  };

  // Stop the spin once the real refetch settles (success or error), not on a fixed timer.
  useEffect(() => {
    if (!loading) setRefreshing(false);
  }, [loading]);

  return (
    <div>
      <PageHeader
        eyebrow="ACTIVITY CENTER"
        title="Notifications"
        info="Payment detection, payout and account-health events."
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <SearchInput value={filters.notificationId} onChange={set('notificationId')} placeholder="Notification ID" />
          <SearchInput value={filters.amount} onChange={set('amount')} placeholder="Amount" />
          <SearchInput value={filters.currency} onChange={set('currency')} placeholder="Currency" />
          <Select value={filters.method} onChange={set('method')} options={METHOD_OPTIONS} />
          <SearchInput value={filters.transactionId} onChange={set('transactionId')} placeholder="Transaction ID" />
        </div>
      </Card>

      {/* Flush card of activity-feed rows (reference's exact "note" pattern) —
          each row carries every real field the old table showed (amount,
          method, currency, transaction id, notification id), just laid out
          as icon + title + description + timestamp instead of table columns. */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {pageRows.length === 0 ? (
          loading && rows.length === 0 ? (
            <LoadingState label="Loading notifications…" />
          ) : error ? (
            <EmptyState
              icon={IconWarning}
              title="Couldn't load notifications"
              message="The notification service is unreachable right now. What's shown below (if anything) may be out of date."
              action={<Button variant="ghost" onClick={refresh}>Retry</Button>}
            />
          ) : (
            <EmptyState
              icon={IconBell}
              title={rows.length === 0 ? "You're all caught up" : 'No notifications match your filters'}
              message={rows.length === 0 ? 'Detected payments will show up here automatically.' : undefined}
            />
          )
        ) : (
          pageRows.map((n) => {
            const method = ACCOUNT_TYPES[n.method];
            return (
              <div
                key={n.id}
                className="tf-row-hover flex items-start gap-3"
                style={{ padding: '17px 19px', borderBottom: '1px solid var(--cardborder)' }}
              >
                <span
                  style={{ width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: 'rgba(34,197,94,.14)', color: '#22c55e' }}
                >
                  <BadgeCheck size={18} />
                </span>
                <div className="min-w-0" style={{ flex: 1 }}>
                  <p style={{ color: 'var(--text)', fontSize: 13, fontWeight: 700, margin: 0 }}>{n.description}</p>
                  <p style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0' }}>
                    ₹{Number(n.amount || 0).toLocaleString('en-IN')} {n.currency}
                    {method && <> · <Badge color={method.color}>{method.label}</Badge></>}
                    {n.transactionId !== '—' && <> · UTR <span className="font-mono">{n.transactionId}</span></>}
                  </p>
                  <small style={{ color: 'var(--subtle)', fontSize: 11 }}>{fmtTime(n.time)}</small>
                </div>
                <span className="font-mono" style={{ color: 'var(--subtle)', fontSize: 10, flexShrink: 0 }}>{n.notificationId}</span>
              </div>
            );
          })
        )}
        <div style={{ borderTop: '1px solid var(--cardborder)' }}>
          <Pagination page={page} perPage={PER_PAGE} total={filtered.length} onPage={setPage} />
        </div>
      </Card>
    </div>
  );
}
