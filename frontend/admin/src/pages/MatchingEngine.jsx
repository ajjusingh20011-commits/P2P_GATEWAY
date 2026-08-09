import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Badge, Button, SearchInput, Select, Pagination, PageHeader, Modal, Field, InlineLoader } from '../components/ui';
import AdminIdPopover from '../components/AdminIdPopover';
import { adminApi } from '../services/api';
import { inr, usdt } from '../utils/mock';
import { toast } from '../components/toast';

/*
  Admin Matching Engine — Phase 4 of the MaxPay UI/UX migration.

  Visual layout follows the approved MaxPayDesign reference
  (Admin/MatchingEngine.tsx), rebuilt on this app's own `ui.jsx` primitives
  (the same ones Orders.jsx/Disputes.jsx already use) instead of the
  prototype's separate DashboardPrimitives kit, and wired to
  GET /admin/matching + GET /admin/matching/:id (adminController.js) —
  no mock data, no fabricated confidence score.

  Real field mapping (see backend/src/controllers/adminController.js):
    - match_tier (0/1/2/null)      -> Match Tier ("Exact UTR" / "UTR Mismatch"
                                       / "Amount Only" / "Legacy / Manual")
    - confirm_engine (string/null) -> Settlement Engine
    - donor_submitted_utr          -> Customer Submitted UTR
    - utr_number                   -> Receiver Detected UTR
    - utr_discrepancy_logs         -> Discrepancy Log (Tier 1 only)
    - disputes                     -> Linked Dispute + record status

  What the prototype's mock had that real data does NOT, and is honestly
  omitted rather than faked:
    - a numeric "confidence %" — no such column/computation exists anywhere
      in matchingEngineV2.js or smartMerge.js; showing one would be invented.
    - "Trader Assigned" / "Checkout Opened" / "Receiver Evidence Detected" /
      "Matching Engine Evaluated" timeline steps — no timestamp columns back
      any of these independently of the ones actually shown below.
*/

const PAGE_SIZE = 10;

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'matched', label: 'Matched' },
  { value: 'disputed', label: 'Disputed' },
  { value: 'resolved', label: 'Resolved' },
];

// match_tier is a real TINYINT column (0/1/2) or null — not a string enum —
// so the filter's values are the literal tier numbers ('null' for "never
// evaluated by matching engine v2").
const TIER_OPTIONS = [
  { value: 'all', label: 'All tiers' },
  { value: '0', label: 'Exact UTR' },
  { value: '1', label: 'UTR Mismatch' },
  { value: '2', label: 'Amount Only' },
  { value: 'null', label: 'Legacy / Manual' },
];

// Every real confirm_engine value that has ever been written to the
// column (see order.model.js's comment + smartMerge.js / matchingEngineV2.js
// / orderController.js / paymentController.js callers) — not a fictional
// "APK / Scraper / Trader Manual / Admin Manual" shortlist.
const ENGINE_OPTIONS = [
  { value: 'all', label: 'All engines' },
  { value: 'apk_notification', label: 'Matching engine · APK notification' },
  { value: 'scraper', label: 'Matching engine · Web scraper' },
  { value: 'trader_manual', label: 'Trader self-confirm' },
  { value: 'admin_manual', label: 'Admin manual review' },
  { value: 'manual', label: 'Legacy manual (paymentController)' },
  { value: 'sms', label: 'Legacy Engine 1 · SMS' },
  { value: 'notification', label: 'Legacy Engine 2 · Notification' },
  { value: 'screen_scraper', label: 'Legacy Engine 3 · Screen scraper' },
  { value: 'null', label: 'Not recorded (pre-tracking orders)' },
];

const ENGINE_LABEL = Object.fromEntries(ENGINE_OPTIONS.map((o) => [o.value, o.label]));

function tierColor(tier) {
  if (tier === 0) return 'green';
  if (tier === 1) return 'amber';
  if (tier === 2) return 'sky';
  return 'gray';
}
function utrMatchColor(m) {
  if (m === 'Matched') return 'green';
  if (m === 'Mismatch') return 'red';
  if (m === 'Unavailable') return 'gray';
  return 'gray';
}
function statusColor(s) {
  if (s === 'Matched') return 'green';
  if (s === 'Disputed') return 'red';
  if (s === 'Resolved') return 'sky';
  return 'gray';
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

export default function MatchingEngine() {
  const navigate = useNavigate();
  const [records, setRecords] = useState([]);
  const [meta, setMeta] = useState({ total: 0, returned: 0, capped: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [tierFilter, setTierFilter] = useState('all');
  const [engineFilter, setEngineFilter] = useState('all');
  const [hasDiscrepancyOnly, setHasDiscrepancyOnly] = useState(false);
  const [page, setPage] = useState(1);

  const [viewingId, setViewingId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      if (tierFilter !== 'all') params.tier = tierFilter;
      if (engineFilter !== 'all') params.engine = engineFilter;
      if (hasDiscrepancyOnly) params.has_discrepancy = 'true';
      const data = await adminApi.listMatching(params);
      setRecords(data.records || []);
      setMeta({ total: data.total ?? 0, returned: data.returned ?? 0, capped: !!data.capped });
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Could not load matching records.');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };
  // Server-side filters (status/tier/engine/has_discrepancy) trigger a
  // re-fetch; search text is filtered client-side below without a re-fetch.
  useEffect(() => { load(); }, [statusFilter, tierFilter, engineFilter, hasDiscrepancyOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return records;
    return records.filter((r) => {
      const hay = `${r.orderId} ${r.customerRef || ''} ${r.traderName || ''} ${r.merchantName || ''}`.toLowerCase();
      return hay.includes(query);
    });
  }, [records, q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const changeFilter = (setter) => (v) => { setter(v); setPage(1); };

  const openDetail = async (id) => {
    setViewingId(id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const data = await adminApi.getMatchingDetail(id);
      setDetail(data);
    } catch (e) {
      setDetailError(e.response?.data?.message || e.message || 'Could not load this record.');
      toast('Failed to load match detail.', 'error');
    } finally {
      setDetailLoading(false);
    }
  };
  const closeDetail = () => { setViewingId(null); setDetail(null); setDetailError(null); };

  const stats = useMemo(() => {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return {
      matchedToday: records.filter((r) => r.status === 'Matched' && r.matchedAt && new Date(r.matchedAt).getTime() > dayAgo).length,
      utrMismatches: records.filter((r) => r.utrMatch === 'Mismatch').length,
      manualSettlements: records.filter((r) => r.confirmEngine === 'trader_manual' || r.confirmEngine === 'admin_manual' || r.confirmEngine === 'manual').length,
      activeDisputes: records.filter((r) => r.status === 'Disputed').length,
    };
  }, [records]);

  return (
    <div>
      <PageHeader
        title="Matching Engine"
        subtitle="How each order was settled — match tier, engine, UTR agreement, and any discrepancy or dispute"
        actions={loading ? <InlineLoader /> : null}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card style={{ padding: '16px 18px' }}>
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 6px' }}>Matched today</p>
          <p style={{ color: 'var(--text)', fontWeight: 800, fontSize: 22, margin: 0 }}>{stats.matchedToday}</p>
        </Card>
        <Card style={{ padding: '16px 18px' }}>
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 6px' }}>UTR mismatches</p>
          <p style={{ color: 'var(--text)', fontWeight: 800, fontSize: 22, margin: 0 }}>{stats.utrMismatches}</p>
        </Card>
        <Card style={{ padding: '16px 18px' }}>
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 6px' }}>Manual settlements</p>
          <p style={{ color: 'var(--text)', fontWeight: 800, fontSize: 22, margin: 0 }}>{stats.manualSettlements}</p>
        </Card>
        <Card style={{ padding: '16px 18px' }}>
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 6px' }}>Disputed</p>
          <p style={{ color: 'var(--text)', fontWeight: 800, fontSize: 22, margin: 0 }}>{stats.activeDisputes}</p>
        </Card>
      </div>

      <Card className="mb-4 flex flex-wrap items-center gap-3 p-4">
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search order ID, customer ref, trader, merchant…" className="sm:max-w-xs" />
        <Select value={statusFilter} onChange={changeFilter(setStatusFilter)} options={STATUS_OPTIONS} className="sm:w-44" />
        <Select value={tierFilter} onChange={changeFilter(setTierFilter)} options={TIER_OPTIONS} className="sm:w-48" />
        <Select value={engineFilter} onChange={changeFilter(setEngineFilter)} options={ENGINE_OPTIONS} className="sm:w-64" />
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={hasDiscrepancyOnly}
            onChange={(e) => { setHasDiscrepancyOnly(e.target.checked); setPage(1); }}
          />
          Has discrepancy
        </label>
      </Card>

      {meta.capped && !loading && (
        <p className="mb-3 text-xs" style={{ color: 'var(--muted)' }}>
          Showing the {meta.returned.toLocaleString()} most recent of {meta.total.toLocaleString()} matching records for this filter — narrow the filters to see older ones.
        </p>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ borderBottom: '1px solid var(--cardborder)', color: 'var(--muted)' }}>
                <th className="w-10 px-4 py-3" />
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Tier</th>
                <th className="px-4 py-3 font-medium">Engine</th>
                <th className="px-4 py-3 font-medium">UTR Match</th>
                <th className="px-4 py-3 font-medium">Trader</th>
                <th className="px-4 py-3 font-medium">Merchant</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Matched</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {error ? (
                <tr><td colSpan={10} className="py-14 text-center text-sm" style={{ color: '#ef4444' }}>{error} — <button className="underline" onClick={load}>retry</button></td></tr>
              ) : pageRows.length === 0 ? (
                <tr><td colSpan={10} className="py-14 text-center text-sm" style={{ color: 'var(--muted)' }}>{loading ? 'Loading…' : 'No matching records for this filter.'}</td></tr>
              ) : (
                pageRows.map((r) => (
                  <tr
                    key={r.id}
                    className={`tf-row-hover cursor-pointer ${r.hasDiscrepancy ? 'mp-discrepancyRow' : ''}`}
                    style={{ borderTop: '1px solid var(--cardborder)' }}
                    onClick={() => openDetail(r.id)}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <AdminIdPopover rows={[{ label: 'Order ID', value: r.orderId }, { label: 'Numeric ID', value: r.id }, { label: 'Customer Reference', value: r.customerRef }]} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium" style={{ color: 'var(--text)' }}>{inr(r.amountInr)}</div>
                      {r.amountUsdt > 0 && <div style={{ color: 'var(--muted)', fontSize: 11 }}>{usdt(r.amountUsdt)}</div>}
                    </td>
                    <td className="px-4 py-3"><Badge color={tierColor(r.matchTier)}>{r.tierLabel}</Badge></td>
                    <td className="px-4 py-3" style={{ color: 'var(--muted)', fontSize: 12.5 }}>{r.confirmEngine ? (ENGINE_LABEL[r.confirmEngine] || r.confirmEngine) : '—'}</td>
                    <td className="px-4 py-3"><Badge color={utrMatchColor(r.utrMatch)}>{r.utrMatch}</Badge></td>
                    <td className="px-4 py-3" style={{ color: 'var(--muted)' }}>{r.traderName || 'Unassigned'}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--muted)' }}>{r.merchantName || '—'}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>{fmtDateTime(r.createdAt)}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>{fmtDateTime(r.matchedAt)}</td>
                    <td className="px-4 py-3"><Badge color={statusColor(r.status)}>{r.status}</Badge></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div style={{ borderTop: '1px solid var(--cardborder)' }}>
          <Pagination page={page} perPage={PAGE_SIZE} total={filtered.length} onPage={setPage} />
        </div>
      </Card>

      <Modal
        open={!!viewingId}
        onClose={closeDetail}
        title={detail ? `Match · ${detail.orderId.slice(0, 8)}…` : 'Match detail'}
        subtitle={detail ? `${inr(detail.amountInr)}${detail.amountUsdt ? ` / ${usdt(detail.amountUsdt)}` : ''}` : ''}
        size="xl"
      >
        {detailLoading && <InlineLoader label="Loading record…" />}
        {detailError && <p style={{ color: '#ef4444', fontSize: 14 }}>{detailError}</p>}
        {detail && !detailLoading && (
          <div className="space-y-6">
            <div>
              <h3 className="mp-detailHead">Order Summary</h3>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field label="Order ID" mono>{detail.orderId}</Field>
                <Field label="Amount">{`${inr(detail.amountInr)}${detail.amountUsdt ? ` / ${usdt(detail.amountUsdt)}` : ''}`}</Field>
                <Field label="Status"><Badge color={statusColor(detail.status)}>{detail.status}</Badge></Field>
                <Field label="Trader">{detail.traderName || 'Unassigned'}</Field>
                <Field label="Merchant">{detail.merchantName || '—'}</Field>
                <Field label="Exchange rate">{detail.exchangeRate != null ? detail.exchangeRate : '—'}</Field>
              </div>
            </div>

            <div>
              <h3 className="mp-detailHead">Match Decision</h3>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field label="Match tier"><Badge color={tierColor(detail.matchTier)}>{detail.tierLabel}</Badge></Field>
                <Field label="Settlement engine">{detail.confirmEngine ? (ENGINE_LABEL[detail.confirmEngine] || detail.confirmEngine) : 'Not recorded'}</Field>
              </div>
            </div>

            <div>
              <h3 className="mp-detailHead">UTR Comparison</h3>
              {detail.utrMatch === 'Mismatch' ? (
                <div className="mp-utrMismatch">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="mp-utrLabel" style={{ color: '#b42318' }}>Customer Submitted</p>
                      <p className="mp-utrValue" style={{ color: '#7a271a' }}>{detail.customerSubmittedUtr || '—'}</p>
                      {detail.senderName && <p style={{ fontSize: 12, color: '#9a3412', marginTop: 8 }}>{detail.senderName}</p>}
                    </div>
                    <div>
                      <p className="mp-utrLabel" style={{ color: '#b42318' }}>Receiver Detected</p>
                      <p className="mp-utrValue" style={{ color: '#7a271a' }}>{detail.receiverDetectedUtr || '—'}</p>
                      {detail.receiverAccount?.upiId && <p style={{ fontSize: 12, color: '#9a3412', marginTop: 8 }}>Account {detail.receiverAccount.upiId}</p>}
                    </div>
                  </div>
                </div>
              ) : detail.utrMatch === 'Matched' ? (
                <div className="mp-utrMatched">
                  <p className="mp-utrLabel" style={{ color: '#067647' }}>✓ UTR matched</p>
                  <p className="mp-utrValue" style={{ color: '#067647' }}>{detail.receiverDetectedUtr || '—'}</p>
                  <p style={{ fontSize: 12, color: '#067647', marginTop: 8 }}>
                    {detail.senderName || 'Unknown sender'}{detail.receiverAccount?.upiId ? ` → ${detail.receiverAccount.upiId}` : ''}
                  </p>
                </div>
              ) : (
                <p style={{ color: 'var(--muted)', fontSize: 13 }}>
                  {detail.utrMatch === 'Unavailable'
                    ? 'No receiver-side UTR was captured for this order — it settled on amount + time-window match only.'
                    : 'This order settled outside matching engine v2 (manual confirm) — no UTR comparison was performed.'}
                </p>
              )}
            </div>

            <div>
              <h3 className="mp-detailHead">Timeline</h3>
              <div className="flex flex-col gap-2">
                {[
                  ['Order created', detail.timeline.orderCreated],
                  ['Customer claimed paid', detail.timeline.claimedPaid],
                  ['Sent to admin review', detail.timeline.sentToReview],
                  ['Settled / confirmed', detail.timeline.confirmed],
                  ['Rejected', detail.timeline.rejected],
                ].map(([label, time]) => (
                  <div key={label} className="mp-timelineRow">
                    <span style={{ color: 'var(--text)', fontSize: 13 }}>{label}</span>
                    <span style={{ color: 'var(--muted)', fontSize: 12, fontFamily: 'monospace' }}>{fmtDateTime(time)}</span>
                  </div>
                ))}
              </div>
              {detail.rejectionReason && (
                <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8 }}>Reason: {detail.rejectionReason}</p>
              )}
            </div>

            {detail.discrepancies.length > 0 && (
              <div>
                <h3 className="mp-detailHead">Discrepancy Log</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--cardborder)', color: 'var(--muted)' }}>
                        <th className="px-2 py-2 text-left font-medium">Time</th>
                        <th className="px-2 py-2 text-left font-medium">Expected UTR</th>
                        <th className="px-2 py-2 text-left font-medium">Actual UTR</th>
                        <th className="px-2 py-2 text-left font-medium">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.discrepancies.map((d) => (
                        <tr key={d.id} style={{ borderBottom: '1px solid var(--cardborder)' }}>
                          <td className="px-2 py-2 font-mono" style={{ color: 'var(--text)' }}>{fmtDateTime(d.time)}</td>
                          <td className="px-2 py-2 font-mono" style={{ color: 'var(--text)' }}>{d.expectedUtr || '(none)'}</td>
                          <td className="px-2 py-2 font-mono" style={{ color: 'var(--text)' }}>{d.actualUtr}</td>
                          <td className="px-2 py-2" style={{ color: 'var(--muted)' }}>{d.source || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {detail.disputes.length > 0 && (
              <div>
                <h3 className="mp-detailHead">Linked Dispute{detail.disputes.length > 1 ? 's' : ''}</h3>
                <div className="flex flex-col gap-3">
                  {detail.disputes.map((d) => (
                    <div key={d.id} className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                      <Field label="Dispute ID">#{d.id}</Field>
                      <Field label="Status">
                        <Badge color={d.status === 'resolved' ? 'sky' : 'red'}>{d.status === 'open' ? 'Open' : d.status === 'reviewing' ? 'Reviewing' : 'Resolved'}</Badge>
                      </Field>
                      <Field label="Opened">{fmtDateTime(d.createdAt)}</Field>
                      <Field label="Reason">{d.reason || '—'}</Field>
                      {d.resolution && <Field label="Resolution">{d.resolution}</Field>}
                    </div>
                  ))}
                </div>
                <Button variant="ghost" size="sm" className="mt-3" onClick={() => navigate('/disputes')}>
                  Open Disputes queue →
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      <style>{`
        .mp-discrepancyRow { border-left: 3px solid #f04438; }
        .mp-detailHead {
          font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em;
          color: var(--muted); margin: 0 0 10px;
        }
        .mp-utrLabel {
          font-size: 11px; color: var(--muted); margin: 0 0 6px; text-transform: uppercase; font-weight: 600;
        }
        .mp-utrValue {
          font-size: 15px; font-weight: 700; font-family: monospace; color: var(--text); margin: 0;
        }
        .mp-utrMatched {
          padding: 12px; border-radius: 12px; background: #ecfdf3; border: 1px solid #12b76a;
        }
        .mp-utrMismatch {
          padding: 12px; border-radius: 12px; background: rgba(240, 68, 56, 0.06); border: 1px solid rgba(240, 68, 56, 0.28);
        }
        .mp-timelineRow {
          display: flex; justify-content: space-between; align-items: center; padding: 7px 0;
          border-bottom: 1px solid var(--cardborder);
        }
      `}</style>
    </div>
  );
}
