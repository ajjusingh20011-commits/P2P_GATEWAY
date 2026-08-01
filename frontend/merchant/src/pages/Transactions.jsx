import { useEffect, useMemo, useState } from 'react';
import { Card, Badge, Button, SearchInput, Pagination, PageHeader } from '../components/ui';
import { IconExport } from '../components/icons';
import { transactions as seedTransactions, ACCOUNT_TYPES, inr } from '../utils/mock';
import { merchantApi } from '../services/api';

const PER_PAGE = 12;
// Same 100/page backend cap as Pay-in/Payout — loop so filters/search/CSV
// export operate on real recent history instead of a silently-truncated
// first page. See Orders.jsx's fetchAllOrders for the identical pattern.
const TXN_FETCH_PAGES = 10;

const DASH = '—';
const methodLabel = (m) => (m && ACCOUNT_TYPES[m] ? ACCOUNT_TYPES[m].label : DASH);

// Normalize an API transaction into the shape the table renders.
function mapTxn(t) {
  return {
    id: String(t.id),
    orderId: t.order?.uuid || DASH,
    amountInr: t.amount_detected,
    utr: t.utr_number || DASH,
    sender: t.sender_name || DASH,
    method: t.engine_used || null, // may not map to a known ACCOUNT_TYPE
    time: t.created_at || DASH,
    date: t.created_at ? String(t.created_at).slice(0, 10) : '',
  };
}

async function fetchAllTransactions() {
  const all = [];
  for (let page = 1; page <= TXN_FETCH_PAGES; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await merchantApi.transactions({ page, limit: 100 });
    const rows = res.data?.data?.transactions || [];
    all.push(...rows);
    if (rows.length < 100) break;
  }
  return all.map(mapTxn);
}

function toCsv(rows) {
  const header = ['Transaction ID', 'Order ID', 'Amount INR', 'UTR', 'Sender', 'Method', 'Time'];
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = rows.map((t) =>
    [t.id, t.orderId, t.amountInr, t.utr, t.sender, methodLabel(t.method), t.time].map(esc).join(',')
  );
  return [header.join(','), ...lines].join('\n');
}

const isToday = (iso) => {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
};

export default function Transactions() {
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState(seedTransactions);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchAllTransactions()
      .then((mapped) => { if (alive) setRows(mapped); })
      .catch(() => { if (alive) setRows(seedTransactions); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const summary = useMemo(() => {
    const totalInr = rows.reduce((s, t) => s + (Number(t.amountInr) || 0), 0);
    const todayCount = rows.filter((t) => isToday(t.time)).length;
    return { count: rows.length, totalInr, todayCount };
  }, [rows]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return rows.filter((t) => {
      if (query && !t.id.toLowerCase().includes(query) && !t.utr.toLowerCase().includes(query) && !t.sender.toLowerCase().includes(query) && !t.orderId.toLowerCase().includes(query)) return false;
      if (from && t.date < from) return false;
      if (to && t.date > to) return false;
      return true;
    });
  }, [rows, q, from, to]);

  const pageRows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const exportCsv = () => {
    const blob = new Blob([toCsv(filtered)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transactions.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const dateInputStyle = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text)' };
  const dateInput = 'rounded-lg px-3 py-2 text-sm outline-none focus:ring-1';
  const reset = () => { setQ(''); setFrom(''); setTo(''); setPage(1); };

  return (
    <div>
      <PageHeader
        title="Live Tracker"
        subtitle={loading ? 'Loading transactions…' : 'Completed pay-in transactions — a settled ledger, not a live in-progress feed.'}
        actions={<Button variant="ghost" onClick={exportCsv}><IconExport className="h-4 w-4" /> Export CSV</Button>}
      />

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3 mb-4">
        <Card className="p-4">
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>Total transactions</p>
          <p style={{ color: 'var(--text)', fontSize: 22, fontWeight: 700, margin: '6px 0 0' }}>{summary.count.toLocaleString()}</p>
        </Card>
        <Card className="p-4">
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>Total amount</p>
          <p style={{ color: 'var(--text)', fontSize: 22, fontWeight: 700, margin: '6px 0 0' }}>{inr(summary.totalInr)}</p>
        </Card>
        <Card className="p-4">
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>Successful today</p>
          <p style={{ color: 'var(--text)', fontSize: 22, fontWeight: 700, margin: '6px 0 0' }}>{summary.todayCount.toLocaleString()}</p>
        </Card>
      </div>

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search ID, UTR, sender, order" className="min-w-[220px] flex-1" />
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--muted)' }}>
            <span>From</span>
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className={dateInput} style={dateInputStyle} />
            <span>To</span>
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className={dateInput} style={dateInputStyle} />
          </div>
          {(q || from || to) && <Button size="sm" variant="ghost" onClick={reset}>Clear</Button>}
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ borderBottom: '1px solid var(--cardborder)', color: 'var(--muted)' }}>
                <th className="px-4 py-3 font-medium">Transaction ID</th>
                <th className="px-4 py-3 font-medium">Order ID</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">UTR Number</th>
                <th className="px-4 py-3 font-medium">Sender</th>
                <th className="px-4 py-3 font-medium">Method</th>
                <th className="px-4 py-3 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((t) => (
                <tr key={t.id} className="tf-row-hover" style={{ color: 'var(--text)', borderTop: '1px solid var(--cardborder)' }}>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--muted)' }}>{t.id}</td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--muted)' }}>{t.orderId}</td>
                  <td className="px-4 py-3 font-medium">{inr(t.amountInr)}</td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--muted)' }}>{t.utr}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text)' }}>{t.sender}</td>
                  <td className="px-4 py-3">{t.method && ACCOUNT_TYPES[t.method] ? <Badge color={ACCOUNT_TYPES[t.method].color}>{ACCOUNT_TYPES[t.method].label}</Badge> : <span style={{ color: 'var(--muted)' }}>{t.method || DASH}</span>}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>{t.time}</td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr><td colSpan={7} className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>No transactions match your filters</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ borderTop: '1px solid var(--cardborder)' }}>
          <Pagination page={page} perPage={PER_PAGE} total={filtered.length} onPage={setPage} />
        </div>
      </Card>
    </div>
  );
}
