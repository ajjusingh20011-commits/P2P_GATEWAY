import { useEffect, useState } from 'react';
import { Card, Badge, PageHeader } from '../components/ui';
import { previewSettlements } from '../utils/previewData';
import { inr, usdt } from '../utils/mock';
import { merchantApi } from '../services/api';

/**
 * Preview page — no merchant settlement endpoint exists in the backend yet
 * (see merchantRoutes.js). The ledger table is fed entirely by
 * src/utils/previewData.js, never a real fetcher. See Sidebar.jsx's
 * `preview: true` nav flag.
 *
 * The "Fee schedule" card below IS real, though — payin_fee_percent /
 * payout_fee_percent are genuine per-merchant columns already returned by
 * GET /merchant/dashboard (same source Dashboard.jsx reads), so unlike the
 * ledger there's no need to fake this part.
 */
export default function Settlements() {
  const [fees, setFees] = useState(null);
  useEffect(() => {
    merchantApi.dashboard().then((res) => {
      const d = res.data?.data;
      setFees({ payin: d?.payin_fee_percent, payout: d?.payout_fee_percent });
    }).catch(() => {});
  }, []);

  return (
    <div>
      <PageHeader title="Settlements" subtitle="Settlement ledger and payout history" />

      <div
        className="mb-5 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm"
        style={{ borderColor: 'var(--cardborder)', background: 'var(--hover)', color: 'var(--muted)' }}
      >
        <Badge color="gray">Preview</Badge>
        <span>
          This page is not connected to a live settlement system yet. The rows below are illustrative sample data,
          not your real settlement history.
        </span>
      </div>

      <Card>
        <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--cardborder)' }}>
          <h2 className="font-semibold" style={{ color: 'var(--text)' }}>Settlement Ledger</h2>
          <Badge color="gray">Sample data</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ borderBottom: '1px solid var(--cardborder)', color: 'var(--muted)' }}>
                <th className="px-4 py-3 font-medium">Settlement ID</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Gross</th>
                <th className="px-4 py-3 font-medium">Fee</th>
                <th className="px-4 py-3 font-medium">Net Payout</th>
                <th className="px-4 py-3 font-medium">UTR</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {previewSettlements.map((s) => (
                <tr key={s.id} className="tf-row-hover" style={{ color: 'var(--text)', borderTop: '1px solid var(--cardborder)' }}>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--muted)' }}>{s.id}</td>
                  <td className="px-4 py-3">{s.date}</td>
                  <td className="px-4 py-3">{inr(s.grossInr)}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--muted)' }}>{inr(s.feeInr)}</td>
                  <td className="px-4 py-3 font-medium" style={{ color: '#22c55e' }}>{usdt(s.netUsdt)}</td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--muted)' }}>{s.utr}</td>
                  <td className="px-4 py-3"><Badge color="green">{s.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-4 p-5">
        <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: 0 }}>Fee schedule</h2>
        <p style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0 0' }}>Your current commission rates</p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between" style={{ padding: '10px 0', borderBottom: '1px solid var(--cardborder)' }}>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>Pay-in fee</span>
            <strong style={{ color: 'var(--text)' }}>{fees?.payin != null ? `${fees.payin}%` : '—'}</strong>
          </div>
          <div className="flex items-center justify-between" style={{ padding: '10px 0', borderBottom: '1px solid var(--cardborder)' }}>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>Payout fee</span>
            <strong style={{ color: 'var(--text)' }}>{fees?.payout != null ? `${fees.payout}%` : '—'}</strong>
          </div>
        </div>
      </Card>
    </div>
  );
}
