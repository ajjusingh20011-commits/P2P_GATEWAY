import { useMemo, useState } from 'react';
import { Clock3, ExternalLink, Hand, CheckCircle2, XCircle, AlertTriangle, Copy, Check } from 'lucide-react';
import { Card, Badge, Button, SearchInput, Select, Pagination, PageHeader, DataTable, Th, EmptyState, LoadingState } from '../components/ui';
import { IconExport } from '../components/icons';
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
      <div className="font-mono text-[11px]" style={{ color: 'var(--muted)' }}>{full.slice(0, 8) || '—'}…</div>
      <button onClick={copy} title="Copy full ID" className="tf-hbtn" style={{ width: 26, height: 26 }}>
        {copied ? <Check size={12} /> : <Copy size={12} />}
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
  if (!s) return <span className="text-xs" style={{ color: 'var(--muted)' }}>—</span>;
  return (
    <div>
      <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>{s.time}</div>
      <div className="text-xs" style={{ color: 'var(--muted)' }}>{s.date}</div>
    </div>
  );
}

// Terminal statuses that count as "closed" for the Closed-timestamp column.
const CLOSED_STATUSES = new Set([
  'confirmed', 'completed', 'auto_close', 'cancelled', 'expired', 'disputed', 'dispute',
]);

// Map a backend order onto the shape this table renders. The API lacks some of
// the rich mock fields (myRate/binanceRate/bank/client/closedAt) — show `—`.
// No deposit_type (FTD/STD) field is read here — that's an admin-only
// trader-classification/routing concept and is deliberately never surfaced
// on the trader panel, on this page or any other.
function orderToRow(o) {
  return {
    id: o.order_id || o.id,
    gatewayOrderId: o.gateway_order_id || null,
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

// Order System v2 statuses (backend/src/models/order.model.js STATUSES) —
// every real value is represented, nothing invented. claimed_paid/under_review
// share the same "manual review" icon+tone (the reference file's distinction
// between auto-resolved and manual-review states) since both are exactly
// Order.REVIEWABLE_STATUSES — a real backend-defined grouping. There is no
// exposed signal for "was this auto-verified" (auto_verified isn't part of
// the GET /orders response), so `success` is labelled plainly rather than
// claiming an unverifiable "auto-closed" distinction.
const STATUS = {
  pending: { color: 'gray', label: 'Pending', icon: Clock3 },
  checkout_open: { color: 'sky', label: 'Checkout Open', icon: ExternalLink },
  claimed_paid: { color: 'amber', label: 'Claimed Paid', icon: Hand },
  under_review: { color: 'amber', label: 'Under Review', icon: Hand },
  success: { color: 'green', label: 'Success', icon: CheckCircle2 },
  failed: { color: 'gray', label: 'Failed', icon: XCircle },
  rejected: { color: 'red', label: 'Rejected', icon: XCircle },
  disputed: { color: 'amber', label: 'Disputed', icon: AlertTriangle },
  cancelled: { color: 'gray', label: 'Canceled', icon: XCircle },
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  ...Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label })),
];

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
            {loading && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Loading…</span>}
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

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <DataTable minWidth={1080}>
          <thead>
            <tr>
              <Th>Gateway ID</Th>
              <Th>Amount</Th>
              <Th>My Rate</Th>
              <Th>Exchange rate</Th>
              <Th>My Bank</Th>
              <Th>Client</Th>
              <Th>Created</Th>
              <Th>Closed</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((t) => {
              const s = STATUS[t.status] || { color: 'gray', label: t.status || '—', icon: null };
              const StatusIcon = s.icon;
              const type = ACCOUNT_TYPES[t.accountType];
              return (
                <tr key={t.id} className="tf-row-hover" style={{ borderBottom: '1px solid var(--cardborder)', color: 'var(--text)' }}>
                  <td className="px-4 py-3">
                    {t.gatewayOrderId
                      ? <span className="font-mono text-[11px]" style={{ color: 'var(--text)' }}>{t.gatewayOrderId}</span>
                      : <CopyId id={t.id} />}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{inr(t.amountInr)}</div>
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>{usdt(traderUsdt(t))}</div>
                  </td>
                  <td className="px-4 py-3 font-medium" style={{ color: '#22c55e' }}>₹{t.traderRate ?? currentTraderRate}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--muted)' }}>₹{baseRate}</td>
                  <td className="px-4 py-3">
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>{t.upiId || '—'}</div>
                    {type ? (
                      <Badge color={type.color} className="mt-1">{type.label}</Badge>
                    ) : (
                      t.accountType && <Badge color="gray" className="mt-1">{t.accountType}</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--muted)' }}>{t.client}</td>
                  <td className="px-4 py-3"><Stamp value={t.createdAt} /></td>
                  <td className="px-4 py-3"><Stamp value={t.closedAt} /></td>
                  <td className="px-4 py-3">
                    <Badge color={s.color}>
                      {StatusIcon && <StatusIcon size={12} />}
                      {s.label}
                    </Badge>
                  </td>
                </tr>
              );
            })}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={9}>
                  {loading && rows.length === 0 ? (
                    <LoadingState label="Loading trades…" />
                  ) : (
                    <EmptyState
                      title={rows.length === 0 ? 'No trades yet' : 'No trades match your filters'}
                      message={rows.length === 0 ? 'Incoming orders routed to your payment details will show up here.' : undefined}
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
