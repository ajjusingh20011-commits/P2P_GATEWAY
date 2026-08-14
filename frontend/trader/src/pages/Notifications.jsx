import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Card, Badge, Button, SearchInput, Select, Pagination, PageHeader, EmptyState, LoadingState, BankBadge } from '../components/ui';
import IdReveal from '../components/IdReveal';
import { IconRefresh, IconBell, IconWarning } from '../components/icons';
import { useApi } from '../hooks/useApi';
import { getTransactions, getNgoSocketToken, NGO_SOCKET_ORIGIN } from '../lib/ngoApi';
import { notifications, ACCOUNT_TYPES } from '../utils/mock';

const PER_PAGE = 8;

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

const METHOD_OPTIONS = [
  { value: 'all', label: 'All methods' },
  ...Object.entries(ACCOUNT_TYPES).map(([value, v]) => ({ value, label: v.label })),
];

export default function Notifications() {
  const [filters, setFilters] = useState({ transactionId: '', amount: '', method: 'all', date: '', bankDetails: '' });
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);

  const { data: transactions, loading: txnLoading, error, refetch } = useApi(
    () => getTransactions().then((list) => list || []),
    { fallback: [] }
  );

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

  // Filter rows
  const filtered = useMemo(() => {
    return rows.filter((n) => {
      if (filters.transactionId && !String(n.notificationId).toLowerCase().includes(filters.transactionId.toLowerCase())) return false;
      if (filters.amount && !String(n.amount).includes(filters.amount.trim())) return false;
      if (filters.method !== 'all' && n.method !== filters.method) return false;
      // date and bankDetails filters are placeholders for now
      return true;
    });
  }, [rows, filters]);

  const pageRows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const refresh = () => {
    setRefreshing(true);
    refetch();
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
      socket.on('new-transactions', () => refetch());
    }).catch((e) => console.error('Could not start notifications socket:', e.message));

    return () => { cancelled = true; };
  }, [refetch]);
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <SearchInput value={filters.date} onChange={set('date')} placeholder="Date" />
          <SearchInput value={filters.amount} onChange={set('amount')} placeholder="Amount" />
          <SearchInput value={filters.bankDetails} onChange={set('bankDetails')} placeholder="My bank details" />
          <Select value={filters.method} onChange={set('method')} options={METHOD_OPTIONS} />
          <SearchInput value={filters.transactionId} onChange={set('transactionId')} placeholder="Transaction ID" />
        </div>
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

                  {/* 3. Amount */}
                  <div style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text)' }}>
                    ₹{Number(n.amount || 0).toLocaleString('en-IN')}
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
                  </div>
                </div>
              );
            })}
          </>
        )}
        <div style={{ borderTop: '1px solid var(--cardborder)' }}>
          <Pagination page={page} perPage={PER_PAGE} total={filtered.length} onPage={setPage} />
        </div>
      </Card>
    </div>
  );
}
