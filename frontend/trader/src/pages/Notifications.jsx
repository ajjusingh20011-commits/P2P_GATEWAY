import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Card, Badge, Button, SearchInput, Select, Pagination, PageHeader, EmptyState, LoadingState, BankBadge } from '../components/ui';
import IdReveal from '../components/IdReveal';
import { IconRefresh, IconBell, IconWarning } from '../components/icons';
import { getTransactions, getNgoSocketToken, NGO_SOCKET_ORIGIN } from '../lib/ngoApi';
import { notifications, ACCOUNT_TYPES } from '../utils/mock';
import { formatAmount } from '../utils/amount';

// Rows per page in the single, unified pager below.
const PER_PAGE = 20;
// Each server fetch pulls a full page (the endpoint caps limit at 100). The page
// shows the newest 100 immediately, then backfills the rest of the trader's real
// history in the background so ONE pager and every filter operate across the
// complete set — not just whatever's currently loaded (see loadAll).
const FETCH_LIMIT = 100;

// Map Transaction + rawEventId (populated) to row shape for table rendering.
function apiToRow(txn) {
  const rawEvent = txn.rawEventId; // Now populated with type, body, deviceId, category
  const isApk = !!rawEvent;

  // The old "<captureType> · <deviceName>" subtitle ("Web scraper · web",
  // "Notification · abc123…") was internal plumbing: which of our own engines
  // saw the payment, and on which device row. A trader reconciling a payment
  // cares about the money and the bank reference, not our capture topology —
  // and the platform is already shown as a badge in the Method column, so
  // repeating it there would just be redundant. That line now carries the
  // UTR/RRN instead (see `utr` below), consistently for every source: APK
  // notification, APK SMS and Web scraper alike.

  // Linked account name (from Transaction.payerName) — still used in the
  // Description subtitle's device attribution, just not in the Method column.
  let linkedAccount = txn.payerName || 'Unknown';

  // Full, unmasked UPI ID for the Method column — the trader needs the real
  // payer UPI ID to reconcile, not a masked preview.
  let upiId = txn.payerUpiId || '—';

  // The captured line that actually describes the payment.
  //
  // `capturedText` is resolved server-side (ngo-backend utils/captureText.js)
  // by whichever half of the capture names an amount. Reading RawEvent.body
  // alone showed "See live notifications here…" for a real ₹10 payment,
  // because GPay had put the payment in the notification's title that time and
  // the boilerplate in the body — the same root cause as the amount fix in
  // 1317477, one field further along. Falls back to the body so a panel talking
  // to an older server behaves exactly as before.
  let originalText = '';
  if (txn.capturedText) {
    originalText = txn.capturedText;
  } else if (rawEvent && rawEvent.body) {
    originalText = rawEvent.body;
  } else if (!isApk) {
    // Web scraper: reconstruct from parsed fields
    originalText = `Payment from ${txn.payerName || 'Unknown'}${txn.payerUpiId ? ` (${txn.payerUpiId})` : ''}`;
  }

  // Which payment app the money actually arrived in, and how we captured it —
  // resolved server-side (ngo-backend utils/sourceApp.js). Transaction.platform
  // is NOT that: for APK rows it holds our own capture tag, which is why this
  // column used to read "apk-notification" where a scraper row read "Paytm".
  const sourceApp = txn.sourceApp || {};
  const appKey = sourceApp.key || null;

  return {
    id: txn._id,
    notificationId: txn.txnId || txn._id,
    time: txn.scrapedAt || txn.createdAt || null,
    amount: txn.amount,
    currency: 'INR',
    // Money direction. 'debit' rows are captured bank-debit SMS (money the
    // trader sent out) — shown here for visibility; they never match an order.
    direction: txn.direction === 'debit' ? 'debit' : 'credit',
    // The badge keys off the real app; the filter follows it so filtering by
    // "GPay Business" catches APK captures and scraped rows alike.
    method: appKey || txn.platform,
    appLabel: sourceApp.label || txn.platform,
    // How it reached us (Notification / SMS / Web scraper / Web login). Shown
    // as secondary text: useful for support, never the headline.
    channel: sourceApp.channel || '',
    methodBadgeColor: ACCOUNT_TYPES[appKey]?.color || 'default',
    linkedAccount,
    upiId,
    originalText,
    // Bank reference for the payment (Paytm calls it rrn; UPI calls it UTR).
    // Real data, already stored on every scraped Transaction — it was simply
    // never rendered, so traders had no way to reconcile a row against their
    // bank statement. Null rather than '—' so the row can omit the line
    // entirely when there genuinely isn't one.
    utr: txn.utr || null,
    transactionId: txn.utr || '—',
    // Linked if matched=true (matched to an order), Process if false
    linkedStatus: txn.matched ? 'linked' : 'process',
    isLinked: txn.matched,
    // The phone this was captured on, appended to the description so a trader
    // running several devices can tell which one saw the payment.
    deviceName: txn.deviceName || '',
    // Which of the trader's OWN UPIs a settled capture landed in — resolved
    // from the settled order, so it only exists for linked rows. Distinct from
    // `upiId` above, which is the payer's.
    receivingUpiId: txn.receivingUpiId || '',
    // The order this settled. Trades resolves its own Transaction ID from
    // `o.order_id || o.id`, and `order_id` is the order's UUID (orderView in
    // orderController.js) — not the numeric id, as this previously assumed. So
    // the two pages labelled one order "21" here and "670644d5-…" there, which
    // reads as two unrelated records. `p2pOrderUuid` is that same UUID,
    // resolved alongside the receiving UPI, so both pages now print the same
    // string for the same order. The numeric id remains the fallback for rows
    // settled before ngo-backend started resolving the UUID.
    orderId: txn.p2pOrderId || null,
    realId: txn.p2pOrderUuid || txn.p2pOrderId || txn.utr || txn.txnId || txn._id,
  };
}

// Normalize a mock notification to the same shape.
function mockToRow(n) {
  return {
    id: n.id,
    notificationId: n.notificationId,
    time: n.time,
    amount: n.amount,
    currency: n.currency,
    method: n.method,
    methodBadgeColor: ACCOUNT_TYPES[n.method]?.color || 'default',
    originalText: n.description,
    utr: n.transactionId || null,
    transactionId: n.transactionId,
    linkedStatus: 'linked',
    isLinked: true,
    realId: n.transactionId,
  };
}

// createdAt/scrapedAt are stored in UTC and must stay that way — only the
// rendering is converted.
//
// The bug this fixes: 'en-IN' is a LOCALE, not a timezone. It selects Indian
// formatting conventions (dd/mm/yyyy, am/pm) but the clock still comes from
// whatever machine is doing the rendering, so the same payment showed a
// different time to a trader in Kolkata than to anyone viewing from another
// zone — and neither was labelled. Pinning timeZone makes the output IST for
// every viewer, everywhere, independent of the host's clock settings.
const IST = 'Asia/Kolkata';

function fmtTime(value) {
  if (!value) return { time: '—', date: '' };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { time: '—', date: '' };

  const timeStr = d.toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: IST,
  });
  const dateStr = d.toLocaleDateString('en-IN', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: IST,
  });

  return { time: timeStr, date: dateStr };
}

// The row's calendar day in IST as 'YYYY-MM-DD', to compare against the native
// date-range inputs (which also emit 'YYYY-MM-DD'). Same IST pinning as fmtTime:
// the day a payment "belongs to" is its Indian calendar day, for every viewer.
function istDateKey(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA', { timeZone: IST }); // en-CA => YYYY-MM-DD
}

// Native date input styled to match the panel's other filter controls — a real
// browser calendar, no extra dependency. The label overlays the empty state so
// it reads "From" / "To" instead of a bare mm/dd/yyyy.
function DateField({ label, value, onChange, min, max }) {
  return (
    <div className="relative">
      {!value && (
        <span
          style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--muted)', pointerEvents: 'none' }}
        >
          {label}
        </span>
      )}
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="w-full rounded-xl py-2 px-3 text-sm outline-none focus:ring-2"
        style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: value ? 'var(--text)' : 'transparent' }}
      />
    </div>
  );
}

const METHOD_OPTIONS = [
  { value: 'all', label: 'All methods' },
  ...Object.entries(ACCOUNT_TYPES).map(([value, v]) => ({ value, label: v.label })),
];

const LINKED_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'linked', label: 'Linked only' },
  { value: 'unlinked', label: 'Unlinked only' },
];

export default function Notifications() {
  const [filters, setFilters] = useState({
    transactionId: '', amount: '', method: 'all',
    dateFrom: '', dateTo: '', device: 'all', linked: 'all', bankDetails: '',
  });
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);

  const [transactions, setTransactions] = useState([]);
  const [total, setTotal] = useState(0);
  const [txnLoading, setTxnLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const [error, setError] = useState(null);

  // Item 1 — ONE pagination system. The page loads the newest FETCH_LIMIT rows
  // first (so the table paints immediately), then backfills the rest of the
  // trader's real history in the background until everything the server reports
  // (`total`) is in hand. With the complete set loaded, the single pager below
  // and every filter operate across all records — there is no second "load
  // older" control, and no filter that silently only searches the newest page.
  // (This supersedes BUG-52's on-demand "load older": history is still reached
  // in full, just without the confusing second pagination layered on top.)
  const loadAll = useCallback(async () => {
    setTxnLoading(true);
    setError(null);
    try {
      const first = await getTransactions(1, FETCH_LIMIT);
      const totalCount = first.total || 0;
      let acc = first.transactions || [];
      setTotal(totalCount);
      setTransactions(acc);
      setTxnLoading(false); // newest page is visible; keep filling behind it
      let pageNum = 2;
      while (acc.length < totalCount) {
        setBackfilling(true);
        const res = await getTransactions(pageNum, FETCH_LIMIT);
        const list = res.transactions || [];
        if (list.length === 0) break;
        const seen = new Set(acc.map((t) => t._id));
        acc = [...acc, ...list.filter((t) => !seen.has(t._id))];
        setTransactions(acc);
        setTotal(res.total || totalCount);
        pageNum += 1;
      }
    } catch (e) {
      setError(e.message || 'Could not load notifications.');
    } finally {
      setTxnLoading(false);
      setBackfilling(false);
      setRefreshing(false);
    }
  }, []);

  // A socket push means newer rows exist. Pull the newest page and fold in only
  // the genuinely new ones at the front, leaving the already-loaded history (and
  // the trader's current page/filters) untouched.
  const mergeNew = useCallback(async () => {
    try {
      const res = await getTransactions(1, FETCH_LIMIT);
      const list = res.transactions || [];
      setTotal((t) => res.total || t);
      setTransactions((prev) => {
        const seen = new Set(prev.map((t) => t._id));
        const fresh = list.filter((t) => !seen.has(t._id));
        return fresh.length ? [...fresh, ...prev] : prev;
      });
    } catch (e) {
      // Non-fatal: the next refresh / socket push catches up.
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // The devices fetch + deviceId->Device map that used to live here existed
  // solely to resolve a display name for the "<captureType> · <deviceName>"
  // subtitle. That subtitle is gone (it was internal plumbing, not something a
  // trader reconciles against), so the extra round trip on every page load
  // went with it.
  const rows = useMemo(() => transactions.map((txn) => apiToRow(txn)), [transactions]);

  const set = (k) => (v) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };

  const clearFilters = () => {
    setFilters({
      transactionId: '', amount: '', method: 'all',
      dateFrom: '', dateTo: '', device: 'all', linked: 'all', bankDetails: '',
    });
    setPage(1);
  };

  // Item 3 — the device filter is built from the same deviceName the Description
  // column already shows, so it only ever lists devices the trader really has
  // captures from. Populates as the background backfill completes.
  const deviceOptions = useMemo(() => {
    const names = [...new Set(rows.map((n) => n.deviceName).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return [{ value: 'all', label: 'All devices' }, ...names.map((nm) => ({ value: nm, label: nm }))];
  }, [rows]);

  const anyFilterActive =
    !!filters.transactionId || !!filters.amount || filters.method !== 'all' ||
    !!filters.dateFrom || !!filters.dateTo || filters.device !== 'all' ||
    filters.linked !== 'all' || !!filters.bankDetails;

  // Filter rows
  const filtered = useMemo(() => {
    return rows.filter((n) => {
      if (filters.transactionId && !String(n.notificationId).toLowerCase().includes(filters.transactionId.toLowerCase())) return false;
      if (filters.amount && !String(n.amount).includes(filters.amount.trim())) return false;
      if (filters.method !== 'all' && n.method !== filters.method) return false;
      // Item 2 — calendar date range, compared on the IST calendar day.
      if (filters.dateFrom || filters.dateTo) {
        const key = istDateKey(n.time);
        if (!key) return false;
        if (filters.dateFrom && key < filters.dateFrom) return false;
        if (filters.dateTo && key > filters.dateTo) return false;
      }
      // Item 3 — only captures from the chosen device.
      if (filters.device !== 'all' && n.deviceName !== filters.device) return false;
      // Item 4 — linked (matched to an order) / unlinked only.
      if (filters.linked === 'linked' && !n.isLinked) return false;
      if (filters.linked === 'unlinked' && n.isLinked) return false;
      // bankDetails remains a placeholder (unchanged).
      return true;
    });
  }, [rows, filters]);

  const pageRows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // A filter can shrink the result set below the current page — clamp so the
  // pager and the visible rows never disagree (e.g. filtering while on page 20).
  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filtered.length, page]);

  const refresh = () => {
    setRefreshing(true);
    loadAll();
  };

  useEffect(() => {
    if (!txnLoading) setRefreshing(false);
  }, [txnLoading]);

  // Live socket refresh
  const notifSocketRef = useRef(null);
  useEffect(() => {
    if (notifSocketRef.current) return undefined;
    let cancelled = false;

    getNgoSocketToken().then((serviceToken) => {
      if (cancelled) return;
      const socket = io(NGO_SOCKET_ORIGIN, { auth: { serviceToken } });
      notifSocketRef.current = socket;
      socket.on('new-transactions', () => mergeNew());
    }).catch((e) => console.error('Could not start notifications socket:', e.message));

    return () => { cancelled = true; };
  }, [mergeNew]);
  useEffect(() => () => notifSocketRef.current?.disconnect(), []);

  return (
    <div>
      <PageHeader
        eyebrow="ACTIVITY CENTER"
        title="Notifications"
        info="Captured payments, SMS and notification events."
        actions={
          <>
            {txnLoading && <span style={{ color: 'var(--muted)', fontSize: 12 }}>Loading…</span>}
            <Button variant="ghost" onClick={refresh}>
              <IconRefresh className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </>
        }
      />

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Item 2 — real calendar date-range picker (native input, no new dep). */}
          <DateField label="From date" value={filters.dateFrom} max={filters.dateTo || undefined} onChange={set('dateFrom')} />
          <DateField label="To date" value={filters.dateTo} min={filters.dateFrom || undefined} onChange={set('dateTo')} />
          {/* Item 3 — filter by a specific paired device. */}
          <Select value={filters.device} onChange={set('device')} options={deviceOptions} />
          {/* Item 4 — Linked / Unlinked status. */}
          <Select value={filters.linked} onChange={set('linked')} options={LINKED_OPTIONS} />
          <SearchInput value={filters.amount} onChange={set('amount')} placeholder="Amount" />
          <Select value={filters.method} onChange={set('method')} options={METHOD_OPTIONS} />
          <SearchInput value={filters.transactionId} onChange={set('transactionId')} placeholder="Transaction ID" />
          <SearchInput value={filters.bankDetails} onChange={set('bankDetails')} placeholder="My bank details" />
        </div>
        {anyFilterActive && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {filtered.length.toLocaleString()} of {rows.length.toLocaleString()} shown
            </span>
            <button
              onClick={clearFilters}
              style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              Clear filters
            </button>
          </div>
        )}
      </Card>

      {/* New table-based layout */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {pageRows.length === 0 ? (
          txnLoading && rows.length === 0 ? (
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
          <>
            {/* Table header */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '40px 90px 80px 150px 1fr 100px',
                gap: '12px',
                padding: '12px 16px',
                borderBottom: '1px solid var(--cardborder)',
                backgroundColor: 'var(--surface2)',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              <div style={{ textAlign: 'center' }}>N.ID</div>
              <div>Time</div>
              <div style={{ textAlign: 'right' }}>Amount</div>
              <div>Method</div>
              <div>Description</div>
              <div style={{ textAlign: 'center' }}>Status</div>
            </div>

            {/* Table rows */}
            {pageRows.map((n) => {
              const method = ACCOUNT_TYPES[n.method];
              const { time: timeStr, date: dateStr } = fmtTime(n.time);

              return (
                <div
                  key={n.id}
                  className="tf-row-hover"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '40px 90px 80px 150px 1fr 100px',
                    gap: '12px',
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--cardborder)',
                    alignItems: 'start',
                    fontSize: 13,
                  }}
                >
                  {/* 1. N.ID — Notification ID */}
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    <IdReveal value={n.notificationId} label="Notification ID" size={16} />
                  </div>

                  {/* 2. Time (time + date) */}
                  {/* Always IST, whoever is viewing and wherever from — the
                      suffix says so explicitly so the number is unambiguous. */}
                  <div style={{ color: 'var(--text)', lineHeight: 1.4 }}>
                    <div style={{ fontWeight: 600 }}>
                      {timeStr}
                      {timeStr !== '—' && (
                        <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--subtle)', marginLeft: 4 }}>IST</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{dateStr}</div>
                  </div>

                  {/* 3. Amount — debits render as red money-out with a − sign. */}
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 600, color: n.direction === 'debit' ? '#ef4444' : 'var(--text)' }}>
                      {n.direction === 'debit' ? '−' : ''}₹{formatAmount(n.amount)}
                    </div>
                    {n.direction === 'debit' && (
                      <div
                        style={{
                          marginTop: 4,
                          display: 'inline-block',
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: '.03em',
                          textTransform: 'uppercase',
                          padding: '2px 8px',
                          borderRadius: 999,
                          background: 'rgba(239,68,68,0.12)',
                          color: '#ef4444',
                        }}
                      >
                        Debit
                      </div>
                    )}
                  </div>

                  {/* 4. Method (badge + full, unmasked UPI ID — no bank/SMS-source label) */}
                  <div>
                    <div style={{ marginBottom: 4 }}>
                      {method ? (
                        <div style={{ display: 'inline-block' }}>
                          <BankBadge type={n.method} label={n.appLabel || method.label} size={28} />
                        </div>
                      ) : (
                        // No brand badge for this source (a bank app, or an app
                        // we can't name) — still a real app name, rendered the
                        // same way, never the raw capture tag.
                        <Badge>{n.appLabel || n.method}</Badge>
                      )}
                    </div>
                    {/* The UPI the money landed in, shown only once the row is
                        genuinely linked to an order — that is the only point
                        at which we know which account received it. An
                        unmatched capture has no answer, and printing the
                        payer's UPI (often absent for notifications) in its
                        place read as a dash for no stated reason. */}
                    {n.isLinked && n.receivingUpiId ? (
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, wordBreak: 'break-all' }}>
                        {n.receivingUpiId}
                      </div>
                    ) : null}
                  </div>

                  {/* 5. Description (source app + full original text + UTR) */}
                  <div style={{ minWidth: 0 }}>
                    {/* Which app sent this notification. The captured text
                        alone ("₹1,000 received from NITESH K at 9:35 pm")
                        never says, so two accounts on the same phone were
                        indistinguishable on this page. The channel follows it
                        because the time INSIDE the text is the app's own
                        rendering of when the payment happened, which is not
                        always when the notification was posted. */}
                    {(n.appLabel || n.channel) && (
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--muted)',
                          marginBottom: 4,
                          display: 'flex',
                          alignItems: 'baseline',
                          gap: 6,
                        }}
                      >
                        <span style={{ fontWeight: 600, color: 'var(--subtle)' }}>{n.appLabel}</span>
                        {n.channel && <span>· {n.channel}</span>}
                      </div>
                    )}
                    <div
                      style={{
                        color: 'var(--text)',
                        wordBreak: 'break-word',
                        whiteSpace: 'pre-wrap',
                        marginBottom: 4,
                        maxHeight: '4em',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {n.originalText || '—'}
                      {n.deviceName ? (
                        <span style={{ color: 'var(--subtle)' }}>{` · ${n.deviceName}`}</span>
                      ) : null}
                    </div>
                    {/* Bank reference (UTR/RRN) — what a trader actually
                        matches against their statement. Monospace + tabular
                        figures so digits line up down the column and a
                        transposed one is easy to spot. Omitted rather than
                        shown as a dash when the source genuinely has none. */}
                    {n.utr ? (
                      <div style={{ fontSize: 11, color: 'var(--subtle)', display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontWeight: 600, letterSpacing: '.03em' }}>UTR</span>
                        <span
                          style={{
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                            fontVariantNumeric: 'tabular-nums',
                            color: 'var(--muted)',
                            wordBreak: 'break-all',
                          }}
                        >
                          {n.utr}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  {/* 6. Status (Linked/Unlinked badge + info) */}
                  {/* Both states get the same pill geometry and a caption, so
                      an unmatched row reads as a deliberate state rather than
                      an unfinished one. "Process" was a solid orange block
                      that looked like a button but was never clickable —
                      there is no action to take here; the row is simply a
                      captured payment that matched no open order. */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    {n.direction === 'debit' ? (
                      // A captured debit is money OUT — it never matches an
                      // incoming order, so the Linked/Unlinked axis doesn't apply.
                      <>
                        <div
                          style={{
                            fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 4,
                            textAlign: 'center', backgroundColor: 'transparent', color: '#ef4444',
                            border: '1px solid rgba(239,68,68,.4)',
                          }}
                        >
                          Debit
                        </div>
                        <span style={{ fontSize: 10, color: 'var(--subtle)', textAlign: 'center' }}>
                          Money out
                        </span>
                      </>
                    ) : (
                      <>
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '4px 12px',
                            borderRadius: 4,
                            textAlign: 'center',
                            backgroundColor: n.isLinked ? '#10b981' : 'transparent',
                            color: n.isLinked ? '#fff' : 'var(--muted)',
                            border: n.isLinked ? '1px solid #10b981' : '1px solid var(--cardborder)',
                          }}
                        >
                          {n.isLinked ? 'Linked' : 'Unlinked'}
                        </div>
                        {/* Real Transaction ID — only exists once matched=true (Linked).
                            An unlinked row genuinely has none, so it says why it has
                            none instead of leaving the cell to look truncated. */}
                        {n.isLinked ? (
                          <IdReveal value={n.realId} label="Transaction ID" size={12} />
                        ) : (
                          <span style={{ fontSize: 10, color: 'var(--subtle)', textAlign: 'center' }}>
                            No matching order
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
        <div style={{ borderTop: '1px solid var(--cardborder)' }}>
          <Pagination page={page} perPage={PER_PAGE} total={filtered.length} onPage={setPage} />
          {/* Passive indicator only — the full history is being pulled in the
              background so the single pager above already spans every record.
              No second pagination control. */}
          {backfilling && transactions.length < total && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: '2px 0 12px' }}>
              <IconRefresh className="h-3.5 w-3.5 animate-spin" style={{ color: 'var(--muted)' }} />
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                Loading full history… {transactions.length.toLocaleString()} of {total.toLocaleString()}
              </span>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
