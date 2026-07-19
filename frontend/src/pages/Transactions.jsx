import { useEffect, useState, useCallback } from 'react'
import { apiCall } from '../config/api'
import { theme } from '../theme'
import { formatMoney, maskUpi, formatTime } from '../lib/format'
import {
  PageHeader,
  Card,
  Table,
  Td,
  StatusBadge,
  Spinner,
  EmptyState,
  ErrorState,
  Pagination,
} from '../components/ui'

const STATUS_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Success', value: 'SUCCESS' },
  { label: 'Failed', value: 'FAILED' },
  { label: 'Pending', value: 'PENDING' },
]

const LIMIT = 15

export default function Transactions() {
  const [rows, setRows] = useState([])
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) })
      if (status) qs.set('status', status)
      const json = await apiCall(`/ngo/transactions?${qs.toString()}`)
      // NOTE: transactions/total/pages are top-level, NOT under json.data
      setRows(json.transactions || [])
      setPages(json.pages || 1)
      setTotal(json.total || 0)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [page, status])

  useEffect(() => {
    load()
  }, [load])

  function changeStatus(value) {
    setStatus(value)
    setPage(1)
  }

  return (
    <div>
      <PageHeader
        title="Transactions"
        subtitle={`${total} scraped payment${total === 1 ? '' : 's'}`}
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            {STATUS_FILTERS.map((f) => {
              const active = status === f.value
              return (
                <button
                  key={f.label}
                  className="btn"
                  onClick={() => changeStatus(f.value)}
                  style={{
                    background: active ? theme.accentDim : theme.card,
                    border: `1px solid ${active ? theme.accentBorder : theme.border}`,
                    color: active ? theme.accent : theme.textSecondary,
                    borderRadius: 9,
                    padding: '8px 14px',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {f.label}
                </button>
              )
            })}
          </div>
        }
      />

      <Card>
        {error && <ErrorState message={error} />}
        {loading ? (
          <Spinner center />
        ) : rows.length === 0 ? (
          <EmptyState message="No transactions match this filter." />
        ) : (
          <>
            <Table
              columns={['Amount', 'Payer Name', 'UPI ID', 'UTR', 'Platform', 'Status', 'Time']}
            >
              {rows.map((t) => (
                <tr key={t._id} className="hoverable">
                  <Td style={{ fontWeight: 700, color: theme.accent }}>
                    {formatMoney(t.amount)}
                  </Td>
                  <Td>{t.payerName || '—'}</Td>
                  <Td style={{ color: theme.textSecondary, fontFamily: 'monospace' }}>
                    {maskUpi(t.payerUpiId)}
                  </Td>
                  <Td style={{ fontFamily: 'monospace', color: theme.textSecondary }}>
                    {t.utr || '—'}
                  </Td>
                  <Td style={{ textTransform: 'capitalize' }}>{t.platform || '—'}</Td>
                  <Td>
                    <StatusBadge status={t.status} />
                  </Td>
                  <Td style={{ color: theme.textSecondary }}>{formatTime(t.scrapedAt)}</Td>
                </tr>
              ))}
            </Table>
            <Pagination page={page} pages={pages} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  )
}
