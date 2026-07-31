import { useEffect, useMemo, useState } from 'react';
import { Clock3, Hand, CheckCircle2, X, AlertTriangle, Copy, Check, HelpCircle, Bot, Download, RotateCcw } from 'lucide-react';
import { Card, Badge, Button, SearchInput, Select, Pagination, PageHeader, BankBadge, EmptyState, LoadingState } from '../components/ui';
import { useApi } from '../hooks/useApi';
import { useSocket } from '../hooks/useSocket';
import { traderApi } from '../services/api';
import { toast } from '../components/Toaster';
import { trades, inr, usdt, ACCOUNT_TYPES } from '../utils/mock';

const PER_PAGE = 25;

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

// Reference's dateCell: two stacked lines, or a muted dash for missing values.
function DateCell({ value }) {
  const s = formatStamp(value);
  if (!s) return <div className="dateCell"><strong style={{ color: 'var(--muted)' }}>—</strong></div>;
  return (
    <div className="dateCell">
      <strong>{s.time}</strong>
      <span>{s.date}</span>
    </div>
  );
}

// Terminal statuses that count as "closed" for the Closed-timestamp column.
const CLOSED_STATUSES = new Set([
  'success', 'failed', 'rejected', 'cancelled', 'disputed',
]);

// Automatic-detection engines (see smartMerge.confirmOrder's `engine` tag,
// persisted via the confirm_engine column) vs. a human explicitly confirming.
const AUTO_ENGINES = new Set(['apk_notification', 'scraper', 'sms', 'notification', 'screen_scraper']);

// Map a backend order onto the shape this table renders. The API lacks a
// client-identity field — shows `—`. No deposit_type (FTD/STD) field is read
// here — that's an admin-only trader-classification/routing concept and is
// deliberately never surfaced on the trader panel, on this page or any other.
function orderToRow(o) {
  return {
    id: o.order_id || o.id,
    gatewayOrderId: o.gateway_order_id || null,
    amountInr: o.amount_inr,
    amountUsdt: o.amount_usdt,
    // USDT the trader actually gives up = amount_inr / trader_rate. Persisted on
    // confirmed orders (real field, previously silently omitted by the API);
    // null on active ones (computed at render from trader_rate).
    traderDeductionUsdt: o.trader_deduction_usdt != null ? Number(o.trader_deduction_usdt) : null,
    // Persisted trader_rate on confirmed orders; else filled from current rate.
    traderRate: o.trader_rate != null ? Number(o.trader_rate) : null,
    client: '—',
    createdAt: o.created_at || null,
    // Real settlement/close time. confirmed_at covers success; other terminal
    // states (cancelled/failed/rejected/disputed) fall back to updated_at —
    // both fields were missing from the API response entirely until this
    // pass, so this column was always "—" regardless of real order state.
    closedAt: o.confirmed_at || (CLOSED_STATUSES.has(o.status) ? o.updated_at || null : null),
    status: o.status,
    confirmEngine: o.confirm_engine || null,
    matchTier: o.match_tier,
    upiId: o.paymentDetail?.upi_id || '',
    accountName: o.paymentDetail?.account_name || '',
    accountType: o.paymentDetail?.account_type || '',
  };
}

// Order System v2 statuses (backend/src/models/order.model.js STATUSES) —
// every real value is represented, nothing invented.
const STATUS = {
  pending: { color: 'gray', label: 'Pending', icon: Clock3 },
  checkout_open: { color: 'sky', label: 'Checkout Open', icon: Clock3 },
  claimed_paid: { color: 'amber', label: 'Claimed Paid', icon: Hand },
  under_review: { color: 'amber', label: 'Under Review', icon: Hand },
  success: { color: 'green', label: 'Success', icon: CheckCircle2 },
  failed: { color: 'gray', label: 'Failed', icon: X },
  rejected: { color: 'red', label: 'Rejected', icon: X },
  disputed: { color: 'amber', label: 'Disputed', icon: AlertTriangle },
  cancelled: { color: 'gray', label: 'Canceled', icon: X },
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  ...Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label })),
];

function toCsv(rows, traderUsdt) {
  const header = ['ID', 'Amount INR', 'Amount USDT', 'My Rate', 'UPI', 'Account', 'Created', 'Closed', 'Status', 'Confirmed by'];
  const lines = rows.map((t) =>
    [t.id, t.amountInr, traderUsdt(t), t.traderRate ?? '', t.upiId, t.accountName, t.createdAt, t.closedAt, t.status, t.confirmEngine || ''].join(',')
  );
  return [header.join(','), ...lines].join('\n');
}

// Normalize a mock trade (used as instant value + fallback) to the row shape.
function mockToRow(t) {
  return {
    id: t.id,
    amountInr: t.amountInr,
    amountUsdt: t.amountUsdt,
    client: t.client,
    createdAt: t.createdAt,
    closedAt: t.closedAt,
    status: t.status,
    confirmEngine: null,
    matchTier: null,
    upiId: t.bank?.upiId || '',
    accountName: t.bank?.accountName || '',
    accountType: t.bank?.type || '',
  };
}

// Reference's combined "Resolution" cell (status + action in one place)
// mapped onto every real order status — the reference's own demo data only
// ever shows 3 conceptual outcomes (auto/manual-review/canceled), but real
// orders reach 9 distinct statuses, so pending/checkout_open/claimed_paid and
// disputed get their own honest badge instead of being forced into one of
// the reference's 3 slots.
function Resolution({ t, busy, onConfirm }) {
  if (t.status === 'under_review') {
    return (
      <div className="resolutionCell">
        <span className="manualReview"><Hand size={17} />Manual review</span>
        <button className="confirmTrade" disabled={busy} onClick={onConfirm}>
          {busy ? 'Confirming…' : 'Confirm'}
        </button>
      </div>
    );
  }
  if (t.status === 'success') {
    const isAuto = t.matchTier != null || AUTO_ENGINES.has(t.confirmEngine);
    if (isAuto) {
      return <div className="resolutionCell"><span className="autoClose"><Bot size={18} />Auto-close</span></div>;
    }
    const by = t.confirmEngine === 'trader_manual' ? 'you' : t.confirmEngine === 'admin_manual' ? 'admin' : null;
    return (
      <div className="resolutionCell">
        <span className="manualConfirmed"><CheckCircle2 size={17} />{by ? `Confirmed by ${by}` : 'Confirmed'}</span>
      </div>
    );
  }
  if (t.status === 'cancelled' || t.status === 'failed' || t.status === 'rejected') {
    return <div className="resolutionCell"><span className="canceledState"><X size={17} />{STATUS[t.status].label}</span></div>;
  }
  const s = STATUS[t.status] || { color: 'gray', label: t.status || '—', icon: null };
  const Icon = s.icon;
  return <div className="resolutionCell"><Badge color={s.color}>{Icon && <Icon size={12} />}{s.label}</Badge></div>;
}

export default function Trades() {
  const [filters, setFilters] = useState({ id: '', amount: '', bank: '', client: '', status: 'all' });
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [confirmingId, setConfirmingId] = useState(null);

  // Real orders overlay the mock; mock stays as instant value + fallback on error.
  const { data: rows, loading } = useApi(
    () => traderApi.orders().then((res) => (res.data.data.orders || []).map(orderToRow)),
    { fallback: trades.map(mockToRow), deps: [refreshKey] }
  );

  // Real-time update on settlement — smartMerge.confirmOrder emits
  // 'order:confirmed' to the trader's room for every settlement path (auto
  // Tier 0/1/2 match, admin confirm, and this page's own trader-confirm
  // button), so a single listener here covers all of them without a refresh.
  const { socket } = useSocket();
  useEffect(() => {
    if (!socket) return undefined;
    const onConfirmed = () => setRefreshKey((k) => k + 1);
    socket.on('order:confirmed', onConfirmed);
    return () => socket.off('order:confirmed', onConfirmed);
  }, [socket]);

  const handleConfirm = async (id) => {
    if (!window.confirm('Confirm this order as paid? This settles the trade immediately.')) return;
    setConfirmingId(id);
    try {
      await traderApi.confirmOrder(id);
      toast('Order confirmed', 'success');
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to confirm order', 'error');
    } finally {
      setConfirmingId(null);
    }
  };

  // Current rate info (base + trader margin %) for rows that don't have a
  // persisted rate yet (assigned/paid orders).
  const { data: rateInfo } = useApi(
    () => traderApi.dashboard().then((res) => res.data.data),
    { fallback: { base_rate: 100, trader_rate: 104, trader_margin: 4 } }
  );
  const currentTraderRate = rateInfo?.trader_rate ?? 104;
  const currentMargin = rateInfo?.trader_margin;

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
  const clearFilters = () => {
    setFilters({ id: '', amount: '', bank: '', client: '', status: 'all' });
    setPage(1);
  };
  const filtersActive = filters.id || filters.amount || filters.bank || filters.client || filters.status !== 'all';

  const filtered = useMemo(() => {
    return rows.filter((t) => {
      if (filters.id && !String(t.id).includes(filters.id.trim())) return false;
      if (filters.amount && !String(t.amountInr).includes(filters.amount.trim())) return false;
      if (filters.bank && !`${t.accountName} ${t.upiId}`.toLowerCase().includes(filters.bank.toLowerCase())) return false;
      if (filters.client && !String(t.client).toLowerCase().includes(filters.client.toLowerCase())) return false;
      if (filters.status !== 'all' && t.status !== filters.status) return false;
      return true;
    });
  }, [rows, filters]);

  const pageRows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const exportCsv = () => {
    const blob = new Blob([toCsv(filtered, traderUsdt)], { type: 'text/csv' });
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
        subtitle="Incoming donor orders and automated payment resolution"
        actions={
          <div className="flex items-center gap-2">
            {loading && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Loading…</span>}
            <Button variant="ghost" onClick={exportCsv}>
              <Download size={16} />
              Export CSV
            </Button>
          </div>
        }
      />

      <Card className="tradeFilterCard">
        <div className="tradeFilters">
          <SearchInput value={filters.id} onChange={set('id')} placeholder="Trade ID" />
          <SearchInput value={filters.amount} onChange={set('amount')} placeholder="Amount" />
          <SearchInput value={filters.bank} onChange={set('bank')} placeholder="My bank details" />
          <SearchInput value={filters.client} onChange={set('client')} placeholder="Client details" />
          <Select value={filters.status} onChange={set('status')} options={STATUS_OPTIONS} />
          <Button variant="ghost" onClick={clearFilters} disabled={!filtersActive}>
            <RotateCcw size={15} />
            Clear
          </Button>
        </div>
      </Card>

      <Card className="tradeLedger">
        <div className="tradeLedgerHead">
          <span>Info</span>
          <span>Payment method</span>
          <span>Amount</span>
          <span>My rate</span>
          <span>Exchange rate</span>
          <span>My bank</span>
          <span>Client</span>
          <span>Created</span>
          <span>Closed</span>
          <span>Resolution</span>
        </div>

        {pageRows.length === 0 ? (
          loading && rows.length === 0 ? (
            <LoadingState label="Loading trades…" />
          ) : (
            <EmptyState
              title={rows.length === 0 ? 'No trades yet' : 'No trades match your filters'}
              message={rows.length === 0 ? 'Incoming orders routed to your payment details will show up here.' : undefined}
            />
          )
        ) : (
          pageRows.map((t) => {
            const type = ACCOUNT_TYPES[t.accountType];
            return (
              <div className="tradeLedgerRow" key={t.id}>
                <button
                  className="tradeInfo"
                  title={t.id}
                  onClick={() => { navigator.clipboard?.writeText(String(t.id)); toast('Trade ID copied', 'success'); }}
                >
                  <HelpCircle size={16} />
                </button>

                <div className="tradeProvider">
                  <BankBadge type={t.accountType} label={type?.label || t.accountType} size={28} />
                  <div>
                    <strong>{type?.label || t.accountType || '—'}</strong>
                    <small>UPI</small>
                  </div>
                </div>

                <div className="tradeAmount">
                  <strong>{inr(t.amountInr)} <small>INR</small></strong>
                  <span>{usdt(traderUsdt(t))}</span>
                </div>

                <div className="rateCell">
                  <strong>{(t.traderRate ?? currentTraderRate).toFixed?.(2) ?? t.traderRate} INR</strong>
                  <span>{currentMargin != null ? `${currentMargin}% margin` : '—'}</span>
                </div>

                <div className="rateCell">
                  <strong>{Number(rateInfo?.base_rate ?? 100).toFixed(2)} INR</strong>
                  <span>Base rate</span>
                </div>

                <div className="personCell">
                  <strong>{t.accountName || '—'}</strong>
                  <span>{t.upiId || '—'}</span>
                </div>

                <div className="personCell">
                  <strong>{t.client}</strong>
                </div>

                <DateCell value={t.createdAt} />
                <DateCell value={t.closedAt} />

                <Resolution t={t} busy={confirmingId === t.id} onConfirm={() => handleConfirm(t.id)} />
              </div>
            );
          })
        )}

        <div className="tradePagination">
          <Pagination page={page} perPage={PER_PAGE} total={filtered.length} onPage={setPage} />
        </div>
      </Card>
    </div>
  );
}
