import { useEffect, useState, useCallback } from 'react'
import { apiCall } from '../config/api'
import { theme } from '../theme'
import { donationBus } from '../lib/bus'
import { formatMoney, formatTime } from '../lib/format'
import {
  PageHeader,
  Card,
  Table,
  Td,
  VerifiedBadge,
  Spinner,
  EmptyState,
  ErrorState,
  Pagination,
} from '../components/ui'

const LIMIT = 15

export default function Ledger() {
  const [rows, setRows] = useState([])
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) })
      const json = await apiCall(`/ngo/ledger?${qs.toString()}`)
      // NOTE: ledger/total/pages are top-level, NOT under json.data
      setRows(json.ledger || [])
      setPages(json.pages || 1)
      setTotal(json.total || 0)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => {
    load()
  }, [load])

  // Refresh when a new verified donation arrives over the socket.
  useEffect(() => {
    return donationBus.subscribe(() => {
      if (page === 1) load()
    })
  }, [load, page])

  async function copyHash(hash) {
    try {
      await navigator.clipboard.writeText(hash)
      setCopied(hash)
      setTimeout(() => setCopied(''), 1500)
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  return (
    <div>
      <PageHeader
        title="Public Ledger"
        subtitle={`${total} verified, hash-chained donation${total === 1 ? '' : 's'}`}
      />

      <Card>
        {error && <ErrorState message={error} />}
        {loading ? (
          <Spinner center />
        ) : rows.length === 0 ? (
          <EmptyState message="No verified donations yet." />
        ) : (
          <>
            <Table
              columns={['Donor', 'Amount', 'Purpose', 'UTR', 'Platform', 'Hash', 'Verified', 'Time']}
            >
              {rows.map((l) => (
                <tr key={l._id} className="hoverable">
                  <Td>{l.donorName || 'Unknown'}</Td>
                  <Td style={{ fontWeight: 700, color: theme.accent }}>
                    {formatMoney(l.amount)}
                  </Td>
                  <Td style={{ color: theme.textSecondary }}>{l.purpose || '—'}</Td>
                  <Td style={{ fontFamily: 'monospace', color: theme.textSecondary }}>
                    {l.utr || '—'}
                  </Td>
                  <Td style={{ textTransform: 'capitalize' }}>{l.platform || '—'}</Td>
                  <Td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <code
                        style={{
                          fontFamily: 'monospace',
                          fontSize: 12.5,
                          color: theme.textPrimary,
                          background: theme.bg,
                          border: `1px solid ${theme.border}`,
                          borderRadius: 6,
                          padding: '2px 7px',
                        }}
                      >
                        {l.hash ? `${l.hash.slice(0, 16)}…` : '—'}
                      </code>
                      {l.hash && (
                        <button
                          className="icon-btn"
                          onClick={() => copyHash(l.hash)}
                          title="Copy full hash"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: copied === l.hash ? theme.success : theme.textSecondary,
                            fontSize: 13,
                            padding: 4,
                            borderRadius: 6,
                          }}
                        >
                          {copied === l.hash ? '✓' : '⧉'}
                        </button>
                      )}
                    </div>
                  </Td>
                  <Td>
                    <VerifiedBadge />
                  </Td>
                  <Td style={{ color: theme.textSecondary }}>
                    {formatTime(l.verifiedAt || l.createdAt)}
                  </Td>
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
