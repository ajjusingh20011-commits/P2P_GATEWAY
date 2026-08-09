import { useEffect, useMemo, useState } from 'react';
import { Clock3, Hand, CheckCircle2, X, AlertTriangle, Download, RotateCcw } from 'lucide-react';
// HelpCircle no longer used directly here — the Info trigger now lives in IdReveal.
import { Card, Badge, Button, SearchInput, Select, Pagination, PageHeader, BankBadge, EmptyState, LoadingState, Modal } from '../components/ui';
import IdReveal from '../components/IdReveal';
import { useApi } from '../hooks/useApi';
import { useSocket } from '../hooks/useSocket';
import { traderApi } from '../services/api';
import { toast } from '../components/Toaster';
import ConfirmModal from '../components/ConfirmModal';
import { trades, inr, usdt, ACCOUNT_TYPES } from '../utils/mock';

const PER_PAGE = 25;

// Hold a value still for `delay` ms after it stops changing. Used so the filter
// bar's text inputs produce one request per pause in typing rather than one per
// keystroke, now that filtering is a server round-trip instead of an in-memory
// array filter. Compares by JSON so an object of fields can be passed directly.
function useDebounced(value, delay = 300) {
  const [settled, setSettled] = useState(value);
  const serialized = JSON.stringify(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(JSON.parse(serialized)), delay);
    return () => clearTimeout(id);
  }, [serialized, delay]);
  return settled;
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

// Reference's dateCell, applied to Created+Closed merged into one cell: two
// stacked lines (created timestamp, then closed timestamp or a muted dash),
// each combining time + date since there's no longer a second column to
// carry the date separately.
function CreatedClosedCell({ createdAt, closedAt }) {
  const c = formatStamp(createdAt);
  const cl = formatStamp(closedAt);
  return (
    <div className="dateCell">
      <strong>{c ? `${c.time} · ${c.date}` : '—'}</strong>
      <span>{cl ? `${cl.time} · ${cl.date}` : '—'}</span>
    </div>
  );
}

// Terminal statuses that count as "closed" for the Closed-timestamp column.
const CLOSED_STATUSES = new Set([
  'success', 'failed', 'rejected', 'cancelled', 'disputed',
]);

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
    upiId: t.bank?.upiId || '',
    accountName: t.bank?.accountName || '',
    accountType: t.bank?.type || '',
  };
}

// Status cell — icon + the REAL order.status word only (backend/src/models/
// order.model.js STATUSES; the STATUS map above already carries the right
// icon/color/real label per value — nothing invented here, so this no
// longer distinguishes auto-matched vs. trader/admin-confirmed the way an
// earlier pass did) + the real trader action where one actually exists:
//
//   under_review -> the trader can settle it right now with the real,
//     already-built POST /orders/:id/trader-confirm (bare click).
//   cancelled/failed -> real backend REOPENABLE_STATUSES; recoverable via
//     POST /orders/:id/reopen-for-review, which requires a UTR and only
//     re-opens the order into under_review — NOT the same action as
//     trader-confirm (which 409s outside under_review), so it keeps its own
//     "Reopen" button/flow rather than a "Confirm" that would just fail.
//   everything else (success, rejected, disputed, pending, checkout_open,
//     claimed_paid) -> no trader action from this column; just the real
//     status word via the shared STATUS-map badge.
function StatusCell({ t, busy, onConfirm, onReopen }) {
  if (t.status === 'under_review') {
    return (
      <div className="resolutionCell">
        <span className="needsAction"><Hand size={16} />Under review</span>
        <button className="confirmTrade" disabled={busy} onClick={onConfirm}>
          {busy ? 'Confirming…' : 'Confirm'}
        </button>
      </div>
    );
  }
  // Cancelled/failed orders get a real recovery path — the trader may have
  // spotted a genuine payment (e.g. a late/misrouted UTR) after the order
  // already closed out. Rejected orders don't: that's an explicit admin
  // decision, not a routing timeout, so it stays a plain terminal badge.
  if (t.status === 'cancelled' || t.status === 'failed') {
    return (
      <div className="resolutionCell">
        <span className="terminalState"><AlertTriangle size={16} />{STATUS[t.status].label}</span>
        <button className="reopenTrade" onClick={onReopen}>Reopen</button>
      </div>
    );
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
  const [reopening, setReopening] = useState(null); // the trade row currently in the reopen modal, or null
  const [reopenUtr, setReopenUtr] = useState('');
  const [reopenBusy, setReopenBusy] = useState(false);

  // Filters are debounced before they reach the API so typing in a search box
  // doesn't fire a request per keystroke. `status` and `page` are applied
  // immediately — they come from discrete clicks, not typing.
  const debouncedText = useDebounced(
    { id: filters.id, amount: filters.amount, bank: filters.bank },
    300
  );

  // Real orders overlay the mock; mock stays as instant value + fallback on error.
  //
  // Paging and searching are both SERVER-side now. Previously this fetched one
  // default-limit page (25 rows) and did all filtering + pagination in the
  // browser, so the pagination control just re-sliced the same fixed batch and
  // nothing older than a trader's 25 most recent orders could be found at all.
  const { data: result, loading } = useApi(
    () =>
      traderApi
        .orders(filters.status !== 'all' ? filters.status : undefined, {
          page,
          limit: PER_PAGE,
          ...(debouncedText.id ? { id: debouncedText.id.trim() } : {}),
          ...(debouncedText.amount ? { amount: debouncedText.amount.trim() } : {}),
          ...(debouncedText.bank ? { bank: debouncedText.bank.trim() } : {}),
        })
        .then((res) => ({
          rows: (res.data.data.orders || []).map(orderToRow),
          total: res.data.data.pagination?.total ?? (res.data.data.orders || []).length,
        })),
    {
      fallback: { rows: trades.map(mockToRow), total: trades.length },
      deps: [refreshKey, page, filters.status, debouncedText.id, debouncedText.amount, debouncedText.bank],
    }
  );
  const rows = result?.rows ?? [];
  const total = result?.total ?? 0;

  // Deleting/settling rows can shrink the result set under the current page
  // (e.g. confirming the last under_review order while filtered to it). Fall
  // back to the last page that still exists instead of showing a blank table.
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

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

  const [confirmOrderId, setConfirmOrderId] = useState(null);
  const handleConfirm = (id) => setConfirmOrderId(id);

  const doConfirm = async () => {
    const id = confirmOrderId;
    if (!id) return;
    setConfirmingId(id);
    try {
      await traderApi.confirmOrder(id);
      toast('Order confirmed', 'success');
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to confirm order', 'error');
    } finally {
      setConfirmingId(null);
      setConfirmOrderId(null);
    }
  };

  const openReopen = (t) => { setReopening(t); setReopenUtr(''); };
  const closeReopen = () => { if (!reopenBusy) { setReopening(null); setReopenUtr(''); } };

  const handleReopenSubmit = async () => {
    const utr = reopenUtr.trim();
    if (!utr) { toast('Enter the UTR you found for this payment', 'error'); return; }
    setReopenBusy(true);
    try {
      await traderApi.reopenForReview(reopening.id, utr);
      toast('Order reopened for review', 'success');
      setReopening(null);
      setReopenUtr('');
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to reopen this order', 'error');
    } finally {
      setReopenBusy(false);
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

  // id / amount / bank / status are all applied by the query now (see the
  // useApi call above), so `rows` is already the correct page of the correct
  // filtered set — no client-side re-filtering or re-slicing.
  //
  // `client` is the one exception and stays here: orderToRow hardcodes it to
  // '—' because no order field carries a customer identity, so there is nothing
  // for the server to match on. Keeping it local preserves its existing
  // behaviour exactly rather than inventing a column to search.
  const pageRows = useMemo(
    () => (filters.client
      ? rows.filter((t) => String(t.client).toLowerCase().includes(filters.client.toLowerCase()))
      : rows),
    [rows, filters.client]
  );

  // Export every row matching the current filters, not just the page on screen.
  // Now that the table only holds one server page, exporting `rows` would
  // silently produce a 25-line file — so this walks the same filtered query to
  // the end using the server's max page size.
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const SERVER_MAX_LIMIT = 100; // utils/http.js pagination() caps limit here
      const params = {
        ...(debouncedText.id ? { id: debouncedText.id.trim() } : {}),
        ...(debouncedText.amount ? { amount: debouncedText.amount.trim() } : {}),
        ...(debouncedText.bank ? { bank: debouncedText.bank.trim() } : {}),
      };
      const status = filters.status !== 'all' ? filters.status : undefined;

      const all = [];
      for (let p = 1; ; p += 1) {
        const res = await traderApi.orders(status, { ...params, page: p, limit: SERVER_MAX_LIMIT });
        const batch = (res.data.data.orders || []).map(orderToRow);
        all.push(...batch);
        const grandTotal = res.data.data.pagination?.total ?? all.length;
        if (batch.length < SERVER_MAX_LIMIT || all.length >= grandTotal) break;
      }

      const out = filters.client
        ? all.filter((t) => String(t.client).toLowerCase().includes(filters.client.toLowerCase()))
        : all;

      const blob = new Blob([toCsv(out, traderUsdt)], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'trades.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(err.response?.data?.message || 'Could not export trades', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
    <div>
      <PageHeader
        title="Sell USDT"
        info="Incoming donor orders and automated payment resolution."
        actions={
          <div className="flex items-center gap-2">
            {loading && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Loading…</span>}
            <Button variant="ghost" onClick={exportCsv} disabled={exporting}>
              <Download size={16} />
              {exporting ? 'Exporting…' : 'Export CSV'}
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
          <span>T.ID</span>
          <span>Method / Account</span>
          <span>Amount</span>
          <span>My rate</span>
          <span>Exchange Rate</span>
          <span>Created / Closed</span>
          <span>Client</span>
          <span>Status</span>
        </div>

        {pageRows.length === 0 ? (
          loading ? (
            <LoadingState label="Loading trades…" />
          ) : (
            // With filtering done server-side, an empty result no longer implies
            // an empty history — it usually means the filters matched nothing.
            // Branch on whether any filter is active, not on rows.length.
            <EmptyState
              title={filtersActive ? 'No trades match your filters' : 'No trades yet'}
              message={filtersActive ? undefined : 'Incoming orders routed to your payment details will show up here.'}
            />
          )
        ) : (
          pageRows.map((t) => {
            const type = ACCOUNT_TYPES[t.accountType];
            return (
              <div className="tradeLedgerRow" key={t.id}>
                <IdReveal value={t.id} label="Transaction ID" size={16} />

                {/* Method / Account — merged: the old separate Method + My Bank
                    columns both showed the trader's own account, just different
                    fields of it (platform label vs. UPI ID). One cell now: the
                    real UPI ID is the prominent bold line (title= gives the full
                    value on hover if the ellipsis truncates it), platform full
                    name is the muted line underneath. */}
                <div className="tradeProvider">
                  <BankBadge type={t.accountType} label={type?.label || t.accountType} size={22} />
                  <div style={{ minWidth: 0 }}>
                    <strong title={t.upiId || undefined}>{t.upiId || '—'}</strong>
                    <small>{type?.label || t.accountType || '—'}</small>
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

                <CreatedClosedCell createdAt={t.createdAt} closedAt={t.closedAt} />

                <div className="personCell">
                  <strong>{t.client}</strong>
                </div>

                <StatusCell t={t} busy={confirmingId === t.id} onConfirm={() => handleConfirm(t.id)} onReopen={() => openReopen(t)} />
              </div>
            );
          })
        )}

        <div className="tradePagination">
          {/* `total` is the server's count for the current filter set, so the
              page buttons reflect the trader's whole history — clicking one now
              refetches from the API instead of re-slicing an already-loaded batch. */}
          <Pagination page={page} perPage={PER_PAGE} total={total} onPage={setPage} />
        </div>
      </Card>

      {reopening && (
        <Modal
          open
          onClose={closeReopen}
          title="Reopen for review"
          subtitle={`Trade ${reopening.id} · ${inr(reopening.amountInr)}`}
        >
          <div className="space-y-3">
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
              This order has no existing payment trail, so it needs real evidence before it can go
              back under review. Enter the UTR / reference number you found for this payment.
            </p>
            <label className="block">
              <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>UTR / reference number</span>
              <input
                autoFocus
                value={reopenUtr}
                onChange={(e) => setReopenUtr(e.target.value)}
                disabled={reopenBusy}
                placeholder="e.g. 412589637421"
                style={{
                  width: '100%', borderRadius: 8, border: '1px solid var(--input-border)', background: 'var(--input-bg)',
                  padding: '8px 12px', fontSize: 14, color: 'var(--text)', outline: 'none',
                }}
              />
            </label>
          </div>
          <div className="mt-5 flex items-center justify-between">
            <Button variant="ghost" onClick={closeReopen} disabled={reopenBusy}>Cancel</Button>
            <Button onClick={handleReopenSubmit} disabled={reopenBusy || !reopenUtr.trim()}>
              {reopenBusy ? 'Reopening…' : 'Reopen for review'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
    <ConfirmModal
      open={!!confirmOrderId}
      title="Confirm this order?"
      description="Confirm this order as paid? This settles the trade immediately."
      confirmLabel="Confirm"
      tone="primary"
      busy={confirmingId === confirmOrderId}
      onConfirm={doConfirm}
      onClose={() => setConfirmOrderId(null)}
    />
    </>
  );
}
