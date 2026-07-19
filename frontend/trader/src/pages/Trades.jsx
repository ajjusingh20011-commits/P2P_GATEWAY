import { useMemo, useState } from 'react';
import { Card, Badge, Button, SearchInput, Select, Pagination, PageHeader } from '../components/ui';
import { IconExport, IconRobot } from '../components/icons';
import { useApi } from '../hooks/useApi';
import { traderApi } from '../services/api';
import { trades, inr, usdt, ACCOUNT_TYPES } from '../utils/mock';

const PER_PAGE = 25;

// Short order id (first 8 chars) with a copy-to-clipboard button.
function CopyId({ id }) {
  const [copied, setCopied] = useState(false);
  const full = String(id || '');
  const copy = () => {
    navigator.clipboard?.writeText(full);
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  };
  return (
    <div className="flex items-center gap-2">
      <div>
        <div className="font-mono text-[11px] text-gray-400">{full.slice(0, 8) || '—'}…</div>
      </div>
      <button
        onClick={copy}
        title="Copy full ID"
        className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-200"
      >
        {copied ? '✓' : '⎘'}
      </button>
    </div>
  );
}

// Split a timestamp into two display lines: time (18:15) + date (04.07.2026),
// in the viewer's local timezone (no trader tz is exposed by the API). Returns
// null for missing/invalid values so the cell can render "—" instead of
// "Invalid Date".
function formatStamp(value) {
  if (value == null || value === '' || value === '—') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return {
    time: `${p(d.getHours())}:${p(d.getMinutes())}`,
    date: `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`,
  };
}

// Two-line timestamp cell: big time over small date, or a muted dash.
function Stamp({ value }) {
  const s = formatStamp(value);
  if (!s) return <span className="text-xs text-gray-500">—</span>;
  return (
    <div>
      <div className="text-sm font-medium text-gray-200">{s.time}</div>
      <div className="text-xs text-gray-500">{s.date}</div>
    </div>
  );
}

// Terminal statuses that count as "closed" for the Closed-timestamp column.
const CLOSED_STATUSES = new Set([
  'confirmed', 'completed', 'auto_close', 'cancelled', 'expired', 'disputed', 'dispute',
]);

// Map a backend order onto the shape this table renders. The API lacks some of
// the rich mock fields (myRate/binanceRate/bank/client/closedAt) — show `—`.
function orderToRow(o) {
  return {
    id: o.order_id || o.id,
    gatewayOrderId: o.gateway_order_id || null,
    depositType: o.deposit_type || null,
    amountInr: o.amount_inr,
    amountUsdt: o.amount_usdt,
    // USDT the trader actually gives up = amount_inr / trader_rate. Persisted on
    // confirmed orders; null on active ones (computed at render from trader_rate).
    traderDeductionUsdt: o.trader_deduction_usdt != null ? Number(o.trader_deduction_usdt) : null,
    // Persisted trader_rate on confirmed orders; else filled from current rate.
    traderRate: o.trader_rate != null ? Number(o.trader_rate) : null,
    myRate: '—',
    binanceRate: '—',
    client: '—',
    createdAt: o.created_at || '—',
    // Closed/confirmed orders get a real close stamp; open ones stay null → "—".
    // confirmed_at is the settlement time; cancelled/expired have no dedicated
    // column, so fall back to updated_at for those terminal states.
    closedAt: o.confirmed_at || (CLOSED_STATUSES.has(o.status) ? o.updated_at || null : null),
    status: o.status,
    upiId: o.paymentDetail?.upi_id || '',
    accountType: o.paymentDetail?.account_type || '',
  };
}

// Order System v2 statuses + colours.
const STATUS = {
  pending: { color: 'gray', label: 'Pending' },
  checkout_open: { color: 'sky', label: 'Checkout Open' },
  claimed_paid: { color: 'amber', label: 'Claimed Paid' },
  under_review: { color: 'amber', label: 'Under Review' },
  success: { color: 'green', label: 'Success' },
  failed: { color: 'gray', label: 'Failed' },
  rejected: { color: 'red', label: 'Rejected' },
  disputed: { color: 'amber', label: 'Disputed' },
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  ...Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label })),
];

// FTD green / STD blue.
function DepositBadge({ type }) {
  if (!type) return <span className="text-xs text-gray-500">—</span>;
  return <Badge color={type === 'FTD' ? 'green' : 'sky'}>{type}</Badge>;
}

function toCsv(rows) {
  const header = ['ID', 'Amount INR', 'Amount USDT', 'My Rate', 'Binance Rate', 'UPI', 'Client', 'Created', 'Closed', 'Status'];
  const lines = rows.map((t) =>
    [t.id, t.amountInr, t.amountUsdt, t.myRate, t.binanceRate, t.upiId, t.client, t.createdAt, t.closedAt, t.status].join(',')
  );
  return [header.join(','), ...lines].join('\n');
}

// Normalize a mock trade (used as instant value + fallback) to the row shape.
function mockToRow(t) {
  return {
    id: t.id,
    amountInr: t.amountInr,
    amountUsdt: t.amountUsdt,
    myRate: t.myRate,
    binanceRate: t.binanceRate,
    client: t.client,
    createdAt: t.createdAt,
    closedAt: t.closedAt,
    status: t.status,
    upiId: t.bank?.upiId || '',
    accountType: t.bank?.type || '',
  };
}

export default function Trades() {
  const [filters, setFilters] = useState({ id: '', amount: '', bank: '', client: '', status: 'all' });
  const [page, setPage] = useState(1);

  // Real orders overlay the mock; mock stays as instant value + fallback on error.
  const { data: rows, loading } = useApi(
    () => traderApi.orders().then((res) => (res.data.data.orders || []).map(orderToRow)),
    { fallback: trades.map(mockToRow) }
  );

  // Current rate info (base = "Binance", trader_rate = "My Rate") for rows that
  // don't have a persisted rate yet (assigned/paid orders).
  const { data: rateInfo } = useApi(
    () => traderApi.dashboard().then((res) => res.data.data),
    { fallback: { base_rate: 100, trader_rate: 104 } }
  );
  const baseRate = rateInfo?.base_rate ?? 100;
  const currentTraderRate = rateInfo?.trader_rate ?? 104;

  // USDT the trader loses on a row. Prefer the stored trader_deduction_usdt the
  // confirm step already computed; else derive amount_inr / trader_rate (using
  // the row's persisted rate, falling back to the current one).
  const traderUsdt = (t) => {
    if (t.traderDeductionUsdt != null) return t.traderDeductionUsdt;
    const rate = t.traderRate ?? currentTraderRate;
    if (t.amountInr != null && rate) return Number(t.amountInr) / rate;
    return t.amountUsdt;
  };

  const set = (k) => (v) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };

  const filtered = useMemo(() => {
    return rows.filter((t) => {
      if (filters.id && !String(t.id).includes(filters.id.trim())) return false;
      if (filters.amount && !String(t.amountInr).includes(filters.amount.trim())) return false;
      if (filters.bank && !String(t.upiId).toLowerCase().includes(filters.bank.toLowerCase())) return false;
      if (filters.client && !String(t.client).toLowerCase().includes(filters.client.toLowerCase())) return false;
      if (filters.status !== 'all' && t.status !== filters.status) return false;
      return true;
    });
  }, [rows, filters]);

  const pageRows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const exportCsv = () => {
    const blob = new Blob([toCsv(filtered)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'trades.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        title="Sell USDT"
        subtitle="Your outgoing trades"
        actions={
          <>
            {loading && <span className="text-xs text-gray-500">Loading…</span>}
            <Button variant="ghost" onClick={exportCsv}>
              <IconExport className="h-4 w-4" />
              Export CSV
            </Button>
          </>
        }
      />

      {/* Filters */}
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <SearchInput value={filters.id} onChange={set('id')} placeholder="Trade ID" />
          <SearchInput value={filters.amount} onChange={set('amount')} placeholder="Amount" />
          <SearchInput value={filters.bank} onChange={set('bank')} placeholder="Bank details" />
          <SearchInput value={filters.client} onChange={set('client')} placeholder="Client details" />
          <Select value={filters.status} onChange={set('status')} options={STATUS_OPTIONS} />
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 font-medium">Gateway ID</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">My Rate</th>
                <th className="px-4 py-3 font-medium">Exchange rate</th>
                <th className="px-4 py-3 font-medium">My Bank</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Closed</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {pageRows.map((t) => {
                const s = STATUS[t.status] || { color: 'gray', label: t.status || '—' };
                const type = ACCOUNT_TYPES[t.accountType];
                return (
                  <tr key={t.id} className="text-gray-200 hover:bg-gray-800/40">
                    <td className="px-4 py-3">
                      {t.gatewayOrderId
                        ? <span className="font-mono text-[11px] text-gray-300">{t.gatewayOrderId}</span>
                        : <CopyId id={t.id} />}
                    </td>
                    <td className="px-4 py-3"><DepositBadge type={t.depositType} /></td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{inr(t.amountInr)}</div>
                      <div className="text-xs text-gray-500">{usdt(traderUsdt(t))}</div>
                    </td>
                    <td className="px-4 py-3 font-medium text-emerald-400">₹{t.traderRate ?? currentTraderRate}</td>
                    <td className="px-4 py-3 text-gray-400">₹{baseRate}</td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-gray-500">{t.upiId || '—'}</div>
                      {type ? (
                        <Badge color={type.color} className="mt-1">{type.label}</Badge>
                      ) : (
                        t.accountType && <Badge color="gray" className="mt-1">{t.accountType}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">{t.client}</td>
                    <td className="px-4 py-3"><Stamp value={t.createdAt} /></td>
                    <td className="px-4 py-3"><Stamp value={t.closedAt} /></td>
                    <td className="px-4 py-3">
                      <Badge color={s.color}>
                        {s.robot && <IconRobot className="h-3.5 w-3.5" />}
                        {s.label}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-10 text-center text-sm text-gray-500">
                    {rows.length === 0 ? 'No trades yet' : 'No trades match your filters'}
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
