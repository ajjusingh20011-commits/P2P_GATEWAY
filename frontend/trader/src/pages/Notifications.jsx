import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Info } from 'lucide-react';
import { Card, Badge, Button, SearchInput, Select, Pagination, PageHeader, EmptyState, LoadingState, BankBadge } from '../components/ui';
import { IconRefresh, IconBell, IconWarning } from '../components/icons';
import { useApi } from '../hooks/useApi';
import { getTransactions, getNgoSocketToken, NGO_SOCKET_ORIGIN, getDevices } from '../lib/ngoApi';
import { notifications, ACCOUNT_TYPES } from '../utils/mock';

const PER_PAGE = 8;

// Map Transaction + rawEventId (populated) to row shape for table rendering.
function apiToRow(txn, deviceMap) {
  const rawEvent = txn.rawEventId; // Now populated with type, body, deviceId, category
  const isApk = !!rawEvent;

  // Determine capture type
  let captureType = 'Web scraper';
  if (rawEvent) {
    const typeMap = { SMS: 'SMS', NOTIFICATION: 'Notification', SCREEN: 'Screen' };
    captureType = typeMap[rawEvent.type] || 'Unknown';
  }

  // Determine device/source display name (for description subtitle)
  let sourceDeviceName = 'web';
  if (rawEvent && rawEvent.deviceId && deviceMap) {
    const device = deviceMap[rawEvent.deviceId];
    sourceDeviceName = device?.deviceName || rawEvent.deviceId;
  }

  // Linked account name (from Transaction.payerName)
  let linkedAccount = txn.payerName || 'Unknown';

  // Masked UPI for method column display
  function maskUpi(upi = '') {
    const [name, domain] = upi.split('@');
    if (!domain) return upi;
    const head = name.slice(0, 2);
    return `${head}${'*'.repeat(Math.max(2, name.length - 2))}@${domain}`;
  }
  let maskedUpi = txn.payerUpiId ? maskUpi(txn.payerUpiId) : '—';

  // Full original captured text: RawEvent.body for APK, reconstructed for scraper
  let originalText = '';
  if (rawEvent && rawEvent.body) {
    originalText = rawEvent.body;
  } else if (!isApk) {
    // Web scraper: reconstruct from parsed fields
    originalText = `Payment from ${txn.payerName || 'Unknown'}${txn.payerUpiId ? ` (${txn.payerUpiId})` : ''}`;
  }

  return {
    id: txn._id,
    notificationId: txn.txnId || txn._id,
    time: txn.scrapedAt || txn.createdAt || null,
    amount: txn.amount,
    currency: 'INR',
    method: txn.platform,
    methodBadgeColor: ACCOUNT_TYPES[txn.platform]?.color || 'default',
    captureType,
    linkedAccount,
    maskedUpi,
    sourceDeviceName,
    originalText,
    transactionId: txn.utr || '—',
    // Linked if matched=true (matched to an order), Process if false
    linkedStatus: txn.matched ? 'linked' : 'process',
    isLinked: txn.matched,
    realId: txn.utr || txn.txnId || txn._id,
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
    captureType: 'Notification',
    source: 'mobile-device',
    originalText: n.description,
    transactionId: n.transactionId,
    linkedStatus: 'linked',
    isLinked: true,
    realId: n.transactionId,
  };
}

function fmtTime(value) {
  if (!value) return { time: '—', date: '' };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { time: '—', date: '' };

  const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  const dateStr = d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });

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
  const [infoTooltip, setInfoTooltip] = useState(null); // { type: 'notif' | 'status', value: string }

  // Fetch both transactions AND devices for name lookups
  const { data: transactions, loading: txnLoading, error, refetch } = useApi(
    () => getTransactions().then((list) => list || []),
    { fallback: [] }
  );

  const { data: devices } = useApi(
    () => getDevices().then((list) => list || []),
    { fallback: [] }
  );

  // Build deviceMap: deviceId (Android ID) → Device object for quick lookup
  const deviceMap = useMemo(() => {
    const map = {};
    devices.forEach((d) => {
      map[d.deviceId] = d;
    });
    return map;
  }, [devices]);

  // Transform transactions to row format using populated rawEventId
  const rows = useMemo(() => {
    return transactions.map((txn) => apiToRow(txn, deviceMap));
  }, [transactions, deviceMap]);

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
              <div style={{ textAlign: 'center' }}>T.ID</div>
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
                  {/* 1. Info icon */}
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    <button
                      onClick={() => setInfoTooltip(infoTooltip?.type === 'notif' && infoTooltip?.value === n.notificationId ? null : { type: 'notif', value: n.notificationId })}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 0,
                        color: 'var(--muted)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        position: 'relative',
                      }}
                      title={`Notification ID: ${n.notificationId}`}
                    >
                      <Info size={16} />
                      {infoTooltip?.type === 'notif' && infoTooltip?.value === n.notificationId && (
                        <div
                          style={{
                            position: 'absolute',
                            bottom: '100%',
                            left: 0,
                            background: 'var(--text)',
                            color: 'var(--bg)',
                            padding: '4px 8px',
                            borderRadius: 4,
                            whiteSpace: 'nowrap',
                            fontSize: 11,
                            marginBottom: 4,
                            zIndex: 10,
                          }}
                        >
                          {n.notificationId}
                        </div>
                      )}
                    </button>
                  </div>

                  {/* 2. Time (time + date) */}
                  <div style={{ color: 'var(--text)', lineHeight: 1.4 }}>
                    <div style={{ fontWeight: 600 }}>{timeStr}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{dateStr}</div>
                  </div>

                  {/* 3. Amount */}
                  <div style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text)' }}>
                    ₹{Number(n.amount || 0).toLocaleString('en-IN')}
                  </div>

                  {/* 4. Method (badge + linked account name · masked UPI) */}
                  <div>
                    <div style={{ marginBottom: 4 }}>
                      {method ? (
                        <div style={{ display: 'inline-block' }}>
                          <BankBadge type={n.method} label={method.label} size={28} />
                        </div>
                      ) : (
                        <Badge>{n.method}</Badge>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                      {n.linkedAccount} · {n.maskedUpi}
                    </div>
                  </div>

                  {/* 5. Description (full original text + capture type/device name) */}
                  <div style={{ minWidth: 0 }}>
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
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--subtle)' }}>
                      {n.captureType} · {n.sourceDeviceName}
                    </div>
                  </div>

                  {/* 6. Status (Linked/Process badge + info) */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: '4px 12px',
                        borderRadius: 4,
                        backgroundColor: n.isLinked ? '#10b981' : '#f59e0b',
                        color: '#fff',
                        textAlign: 'center',
                      }}
                    >
                      {n.isLinked ? 'Linked' : 'Process'}
                    </div>
                    {n.isLinked && (
                      <button
                        onClick={() => setInfoTooltip(infoTooltip?.type === 'status' && infoTooltip?.value === n.realId ? null : { type: 'status', value: n.realId })}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                          color: 'var(--muted)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          position: 'relative',
                          fontSize: 12,
                        }}
                        title={`Real ID: ${n.realId}`}
                      >
                        <Info size={12} />
                        {infoTooltip?.type === 'status' && infoTooltip?.value === n.realId && (
                          <div
                            style={{
                              position: 'absolute',
                              bottom: '100%',
                              right: 0,
                              background: 'var(--text)',
                              color: 'var(--bg)',
                              padding: '4px 8px',
                              borderRadius: 4,
                              whiteSpace: 'nowrap',
                              fontSize: 10,
                              marginBottom: 4,
                              zIndex: 10,
                            }}
                          >
                            {n.realId}
                          </div>
                        )}
                      </button>
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
