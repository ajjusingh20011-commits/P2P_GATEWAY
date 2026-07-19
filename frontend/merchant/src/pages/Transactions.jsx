import { useMemo, useState } from 'react';
import { Card, Badge, Button, SearchInput, Pagination, PageHeader } from '../components/ui';
import { IconExport } from '../components/icons';
import { transactions as seedTransactions, ACCOUNT_TYPES, inr } from '../utils/mock';
import { useApi } from '../hooks/useApi';
import { merchantApi } from '../services/api';

const PER_PAGE = 12;

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

function toCsv(rows) {
  const header = ['Transaction ID', 'Order ID', 'Amount INR', 'UTR', 'Sender', 'Method', 'Time'];
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = rows.map((t) =>
    [t.id, t.orderId, t.amountInr, t.utr, t.sender, methodLabel(t.method), t.time].map(esc).join(',')
  );
  return [header.join(','), ...lines].join('\n');
}

export default function Transactions() {
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const { data: rows, loading } = useApi(
    () => merchantApi.transactions().then((res) => (res.data.data.transactions || []).map(mapTxn)),
    { fallback: seedTransactions }
  );

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

  const dateInput = 'rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 [color-scheme:dark]';
  const reset = () => { setQ(''); setFrom(''); setTo(''); setPage(1); };

  return (
    <div>
      <PageHeader
        title="Transactions"
        subtitle={loading ? 'Loading transactions…' : 'All received payments'}
        actions={<Button variant="ghost" onClick={exportCsv}><IconExport className="h-4 w-4" /> Export CSV</Button>}
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search ID, UTR, sender, order" className="min-w-[220px] flex-1" />
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <span>From</span>
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className={dateInput} />
            <span>To</span>
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className={dateInput} />
          </div>
          {(q || from || to) && <Button size="sm" variant="ghost" onClick={reset}>Clear</Button>}
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 font-medium">Transaction ID</th>
                <th className="px-4 py-3 font-medium">Order ID</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">UTR Number</th>
                <th className="px-4 py-3 font-medium">Sender</th>
                <th className="px-4 py-3 font-medium">Method</th>
                <th className="px-4 py-3 font-medium">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {pageRows.map((t) => (
                <tr key={t.id} className="text-gray-200 hover:bg-gray-800/40">
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{t.id}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{t.orderId}</td>
                  <td className="px-4 py-3 font-medium">{inr(t.amountInr)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{t.utr}</td>
                  <td className="px-4 py-3 text-gray-300">{t.sender}</td>
                  <td className="px-4 py-3">{t.method && ACCOUNT_TYPES[t.method] ? <Badge color={ACCOUNT_TYPES[t.method].color}>{ACCOUNT_TYPES[t.method].label}</Badge> : <span className="text-gray-500">{t.method || DASH}</span>}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{t.time}</td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr><td colSpan={7} className="py-10 text-center text-sm text-gray-500">No transactions match your filters</td></tr>
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
