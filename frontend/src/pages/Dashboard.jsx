import { useEffect, useState, useCallback } from 'react'
import { apiCall } from '../config/api'
import { theme } from '../theme'
import { donationBus } from '../lib/bus'
import { formatMoney, formatNumber, maskUpi, formatTime } from '../lib/format'
import {
  PageHeader,
  Card,
  Table,
  Td,
  StatusBadge,
  Spinner,
  EmptyState,
  ErrorState,
} from '../components/ui'

const STAT_CARDS = [
  { key: 'totalDonations', label: 'Total Donations', money: true, icon: '₹' },
  { key: 'todayDonations', label: 'Today Donations', money: true, icon: '↑' },
  { key: 'totalCount', label: 'Total Count', money: false, icon: '#' },
  { key: 'activeAccounts', label: 'Active Accounts', money: false, icon: '◉' },
]

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [txns, setTxns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const [statsRes, txnRes] = await Promise.all([
        apiCall('/ngo/stats'),
        apiCall('/ngo/transactions?page=1&limit=8'),
      ])
      setStats(statsRes.data)
      // Transactions live at the top level, not under `data`.
      setTxns(txnRes.transactions || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // A live newDonation bumps the counters and refreshes the recent list.
  useEffect(() => {
    return donationBus.subscribe(() => load())
  }, [load])

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Overview of your donation activity"
      />

      {error && <ErrorState message={error} />}

      {/* Stat cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
          marginBottom: 24,
        }}
      >
        {STAT_CARDS.map((c) => (
          <Card key={c.key} style={{ padding: 20 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12,
              }}
            >
              <span style={{ fontSize: 13, color: theme.textSecondary, fontWeight: 500 }}>
                {c.label}
              </span>
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 9,
                  background: theme.accentDim,
                  color: theme.accent,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 15,
                  fontWeight: 700,
                }}
              >
                {c.icon}
              </span>
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: theme.textPrimary }}>
              {loading || !stats
                ? '—'
                : c.money
                ? formatMoney(stats[c.key])
                : formatNumber(stats[c.key])}
            </div>
          </Card>
        ))}
      </div>

      {/* Recent transactions */}
      <Card>
        <div
          style={{
            padding: '16px 18px',
            borderBottom: `1px solid ${theme.border}`,
            fontWeight: 700,
            fontSize: 16,
            color: theme.textPrimary,
          }}
        >
          Recent Transactions
        </div>

        {loading ? (
          <Spinner center />
        ) : txns.length === 0 ? (
          <EmptyState message="No transactions yet." />
        ) : (
          <Table columns={['Amount', 'Payer', 'UPI ID', 'Platform', 'Status', 'Time']}>
            {txns.map((t) => (
              <tr key={t._id} className="hoverable">
                <Td style={{ fontWeight: 700, color: theme.accent }}>
                  {formatMoney(t.amount)}
                </Td>
                <Td>{t.payerName || '—'}</Td>
                <Td style={{ color: theme.textSecondary, fontFamily: 'monospace' }}>
                  {maskUpi(t.payerUpiId)}
                </Td>
                <Td style={{ textTransform: 'capitalize' }}>{t.platform || '—'}</Td>
                <Td>
                  <StatusBadge status={t.status} />
                </Td>
                <Td style={{ color: theme.textSecondary }}>{formatTime(t.scrapedAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  )
}
