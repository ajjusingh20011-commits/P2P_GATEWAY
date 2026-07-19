import { useMemo, useState } from 'react';
import { Card, Badge, Button, SearchInput, Select, Pagination, PageHeader } from '../components/ui';
import { IconExport } from '../components/icons';
import { payments, traders, merchants, ACCOUNT_TYPES, ENGINES, inr, maskUpi } from '../utils/mock';

const PER_PAGE = 15;

const METHOD_OPTIONS = [
  { value: 'all', label: 'All methods' },
  ...Object.entries(ACCOUNT_TYPES).map(([value, v]) => ({ value, label: v.label })),
];
const ENGINE_OPTIONS = [{ value: 'all', label: 'All engines' }, ...ENGINES.map((e) => ({ value: e, label: e }))];
const TRADER_OPTIONS = [{ value: 'all', label: 'All traders' }, ...traders.map((t) => ({ value: String(t.id), label: t.name }))];
const MERCHANT_OPTIONS = [{ value: 'all', label: 'All merchants' }, ...merchants.map((m) => ({ value: m.businessName, label: m.businessName }))];

function toCsv(rows) {
  const header = ['Notification ID', 'Time', 'Trader', 'Merchant', 'Amount', 'Currency', 'Method', 'Engine', 'Transaction ID', 'Status'];
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = rows.map((n) =>
    [n.notificationId, n.time, n.traderName, n.merchant, n.amount, n.currency, ACCOUNT_TYPES[n.method].label, n.engine, n.transactionId, n.status].map(esc).join(',')
  );
  return [header.join(','), ...lines].join('\n');
}

const engineColor = {
  'SMS Parser': 'sky',
  'Notification Listener': 'violet',
  'UPI Intent': 'amber',
  'Bank Statement': 'green',
  Manual: 'gray',
};

export default function Payments() {
  const [filters, setFilters] = useState({ trader: 'all', merchant: 'all', method: 'all', engine: 'all', amount: '', dateFrom: '', dateTo: '' });
  const [page, setPage] = useState(1);

  const set = (k) => (v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };

  const filtered = useMemo(() => {
    return payments.filter((n) => {
      if (filters.trader !== 'all' && String(n.traderId) !== filters.trader) return false;
      if (filters.merchant !== 'all' && n.merchant !== filters.merchant) return false;
      if (filters.method !== 'all' && n.method !== filters.method) return false;
      if (filters.engine !== 'all' && n.engine !== filters.engine) return false;
      if (filters.amount && !String(n.amount).includes(filters.amount.trim())) return false;
      const date = n.time.slice(0, 10);
      if (filters.dateFrom && date < filters.dateFrom) return false;
      if (filters.dateTo && date > filters.dateTo) return false;
      return true;
    });
  }, [filters]);

  const pageRows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const exportCsv = () => {
    const blob = new Blob([toCsv(filtered)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'payments.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const dateInput = 'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 [color-scheme:dark]';

  return (
    <div>
      <PageHeader
        title="Payments / Transactions"
        subtitle="Notification logs across all traders"
        actions={<Button variant="ghost" onClick={exportCsv}><IconExport className="h-4 w-4" /> Export CSV</Button>}
      />

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select value={filters.trader} onChange={set('trader')} options={TRADER_OPTIONS} />
          <Select value={filters.merchant} onChange={set('merchant')} options={MERCHANT_OPTIONS} />
          <Select value={filters.method} onChange={set('method')} options={METHOD_OPTIONS} />
          <Select value={filters.engine} onChange={set('engine')} options={ENGINE_OPTIONS} />
          <SearchInput value={filters.amount} onChange={set('amount')} placeholder="Amount" />
          <input type="date" value={filters.dateFrom} onChange={(e) => set('dateFrom')(e.target.value)} className={dateInput} />
          <input type="date" value={filters.dateTo} onChange={(e) => set('dateTo')(e.target.value)} className={dateInput} />
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 font-medium">Notification ID</th>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Trader</th>
                <th className="px-4 py-3 font-medium">Merchant</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Method</th>
                <th className="px-4 py-3 font-medium">Captured By</th>
                <th className="px-4 py-3 font-medium">Transaction ID</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {pageRows.map((n) => (
                <tr key={n.id} className="text-gray-200 hover:bg-gray-800/40">
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{n.notificationId}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{n.time}</td>
                  <td className="px-4 py-3">
                    <div className="text-xs font-medium">{n.traderName}</div>
                    <div className="text-xs text-gray-500">{maskUpi(n.bank.upiId)}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{n.merchant}</td>
                  <td className="px-4 py-3 font-medium">{inr(n.amount)}</td>
                  <td className="px-4 py-3"><Badge color={ACCOUNT_TYPES[n.method].color}>{ACCOUNT_TYPES[n.method].label}</Badge></td>
                  <td className="px-4 py-3"><Badge color={engineColor[n.engine]}>{n.engine}</Badge></td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{n.transactionId}</td>
                  <td className="px-4 py-3"><Badge color={n.status === 'matched' ? 'green' : 'amber'}>{n.status}</Badge></td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr><td colSpan={9} className="py-10 text-center text-sm text-gray-500">No payments match your filters</td></tr>
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
