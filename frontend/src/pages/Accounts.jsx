import { useEffect, useState, useMemo, useCallback } from 'react'
import { apiCall } from '../config/api'
import { theme } from '../theme'
import { showToast } from '../lib/bus'
import { maskUpi, bankFromUpi, initials } from '../lib/format'
import { PageHeader, Spinner, EmptyState, ErrorState } from '../components/ui'
import AddAccountModal from '../components/AddAccountModal'

export default function Accounts() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [offerSearch, setOfferSearch] = useState('')
  const [detailSearch, setDetailSearch] = useState('')
  const [filter, setFilter] = useState('all') // all | apk | web
  const [menuFor, setMenuFor] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setError('')
    try {
      const json = await apiCall('/ngo/accounts')
      setAccounts(json.data || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function toggle(account) {
    const next = account.status === 'live' ? 'paused' : 'live'
    setBusyId(account._id)
    // Optimistic flip.
    setAccounts((list) =>
      list.map((a) => (a._id === account._id ? { ...a, status: next } : a))
    )
    try {
      const json = await apiCall(`/ngo/accounts/${account._id}/toggle`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      })
      setAccounts((list) => list.map((a) => (a._id === json.data._id ? json.data : a)))
      showToast(`${account.displayName || 'Account'} is now ${next}`, next === 'live' ? 'success' : 'info')
    } catch (err) {
      // Roll back.
      setAccounts((list) =>
        list.map((a) => (a._id === account._id ? account : a))
      )
      showToast(err.message, 'error')
    } finally {
      setBusyId(null)
    }
  }

  function onCreated(account) {
    setAccounts((list) => [account, ...list])
    setShowModal(false)
    showToast(`${account.displayName || 'Account'} added`, 'success')
  }

  // Left "Offers" list filtered by its own search box.
  const offers = useMemo(() => {
    const q = offerSearch.trim().toLowerCase()
    if (!q) return accounts
    return accounts.filter(
      (a) =>
        (a.displayName || '').toLowerCase().includes(q) ||
        (a.platform || '').toLowerCase().includes(q)
    )
  }, [accounts, offerSearch])

  // Right "Details" list filtered by search + connection-type dropdown.
  const details = useMemo(() => {
    const q = detailSearch.trim().toLowerCase()
    return accounts.filter((a) => {
      if (filter !== 'all' && a.connectionType !== filter) return false
      if (!q) return true
      return (
        (a.displayName || '').toLowerCase().includes(q) ||
        (a.upiId || '').toLowerCase().includes(q)
      )
    })
  }, [accounts, detailSearch, filter])

  // Group right-panel accounts by derived bank name (like the screenshot).
  const grouped = useMemo(() => {
    const map = new Map()
    for (const a of details) {
      const bank = bankFromUpi(a.upiId, a.displayName || 'Account')
      if (!map.has(bank)) map.set(bank, [])
      map.get(bank).push(a)
    }
    return Array.from(map.entries())
  }, [details])

  return (
    <div onClick={() => setMenuFor(null)}>
      <PageHeader
        title="Offers & Details"
        subtitle="Manage the accounts you receive payments on"
        right={
          <button
            className="btn"
            onClick={() => setShowModal(true)}
            style={{
              background: theme.accent,
              color: '#00201a',
              border: 'none',
              borderRadius: 10,
              padding: '11px 18px',
              fontSize: 14,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 17 }}>+</span> Add Payment Detail
          </button>
        }
      />

      {error && <ErrorState message={error} />}

      {loading ? (
        <Spinner center />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
            gap: 20,
            alignItems: 'start',
          }}
        >
          {/* ---------------- LEFT: OFFERS ---------------- */}
          <Panel>
            <PanelHeader
              title="Offers"
              count={offers.length}
              onAdd={() => setShowModal(true)}
            />
            <SearchBox
              value={offerSearch}
              onChange={setOfferSearch}
              placeholder="Search offers..."
            />
            {offers.length === 0 ? (
              <EmptyState message="No offers found." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {offers.map((a) => (
                  <OfferCard
                    key={a._id}
                    account={a}
                    busy={busyId === a._id}
                    onToggle={() => toggle(a)}
                    menuOpen={menuFor === a._id}
                    onMenu={(e) => {
                      e.stopPropagation()
                      setMenuFor(menuFor === a._id ? null : a._id)
                    }}
                  />
                ))}
              </div>
            )}
          </Panel>

          {/* ---------------- RIGHT: DETAILS ---------------- */}
          <Panel>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 16,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20, fontWeight: 800, color: theme.textPrimary }}>
                  Details
                </span>
                <CountPill count={details.length} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  style={{
                    background: theme.bg,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 9,
                    color: theme.textPrimary,
                    padding: '8px 10px',
                    fontSize: 13,
                  }}
                >
                  <option value="all">All</option>
                  <option value="apk">APK</option>
                  <option value="web">Web</option>
                </select>
                <IconPlus onClick={() => setShowModal(true)} />
              </div>
            </div>

            <SearchBox
              value={detailSearch}
              onChange={setDetailSearch}
              placeholder="Search account or UPI..."
            />

            {grouped.length === 0 ? (
              <EmptyState message="No details match this filter." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {grouped.map(([bank, group]) => (
                  <div key={bank}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 10,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Avatar text={bank} />
                        <span style={{ fontWeight: 600, fontSize: 14.5, color: theme.textPrimary }}>
                          {bank}
                        </span>
                        <span style={{ fontSize: 12, color: theme.textSecondary }}>INR</span>
                      </div>
                      <IconPlus small onClick={() => setShowModal(true)} />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {group.map((a) => (
                        <DetailRow
                          key={a._id}
                          account={a}
                          busy={busyId === a._id}
                          onToggle={() => toggle(a)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      )}

      {showModal && (
        <AddAccountModal onClose={() => setShowModal(false)} onCreated={onCreated} />
      )}
    </div>
  )
}

/* ------------------------- Sub-components ------------------------- */

function Panel({ children }) {
  return (
    <div
      style={{
        background: theme.card,
        border: `1px solid ${theme.border}`,
        borderRadius: 16,
        padding: 22,
      }}
    >
      {children}
    </div>
  )
}

function PanelHeader({ title, count, onAdd }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 20, fontWeight: 800, color: theme.textPrimary }}>
          {title}
        </span>
        <CountPill count={count} />
      </div>
      <IconPlus onClick={onAdd} />
    </div>
  )
}

function CountPill({ count }) {
  return (
    <span
      style={{
        background: theme.bg,
        border: `1px solid ${theme.border}`,
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 600,
        color: theme.textSecondary,
        padding: '2px 9px',
        minWidth: 22,
        textAlign: 'center',
      }}
    >
      {count}
    </span>
  )
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <div style={{ position: 'relative', marginBottom: 16 }}>
      <span
        style={{
          position: 'absolute',
          left: 13,
          top: '50%',
          transform: 'translateY(-50%)',
          color: theme.textSecondary,
          pointerEvents: 'none',
        }}
      >
        ⌕
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          background: theme.bg,
          border: `1px solid ${theme.border}`,
          borderRadius: 10,
          color: theme.textPrimary,
          padding: '11px 12px 11px 34px',
          fontSize: 13.5,
        }}
      />
    </div>
  )
}

function OfferCard({ account, busy, onToggle, menuOpen, onMenu }) {
  const live = account.status === 'live'
  return (
    <div
      className="hoverable"
      style={{
        background: theme.bg,
        border: `1px solid ${theme.border}`,
        borderRadius: 12,
        padding: 16,
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Avatar text={account.displayName || account.platform} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: theme.textPrimary }}>
            {account.displayName || account.platform}
          </div>
          <div style={{ fontSize: 12.5, color: theme.textSecondary, textTransform: 'capitalize' }}>
            INR · market rate
          </div>
        </div>

        <Toggle on={live} busy={busy} onClick={onToggle} />

        <button
          className="icon-btn"
          onClick={onMenu}
          style={{
            background: 'transparent',
            border: 'none',
            color: theme.textSecondary,
            fontSize: 18,
            width: 30,
            height: 30,
            borderRadius: 8,
            letterSpacing: 1,
          }}
        >
          ⋯
        </button>

        {menuOpen && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              top: 46,
              right: 12,
              background: theme.card,
              border: `1px solid ${theme.border}`,
              borderRadius: 10,
              boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
              zIndex: 30,
              minWidth: 150,
              overflow: 'hidden',
            }}
          >
            <MenuItem onClick={onToggle}>{live ? 'Pause account' : 'Set live'}</MenuItem>
            <MenuItem
              onClick={() => navigator.clipboard?.writeText(account.upiId || '')}
            >
              Copy UPI ID
            </MenuItem>
          </div>
        )}
      </div>

      <div
        style={{
          marginTop: 12,
          display: 'inline-block',
          background: live ? theme.accentDim : theme.bg,
          border: `1px solid ${live ? theme.accentBorder : theme.border}`,
          borderRadius: 8,
          padding: '4px 10px',
          fontSize: 12.5,
          color: live ? theme.accent : theme.textSecondary,
          fontWeight: 500,
        }}
      >
        {account.displayName || account.platform}
      </div>
    </div>
  )
}

function DetailRow({ account, busy, onToggle }) {
  const live = account.status === 'live'
  return (
    <div
      className="hoverable"
      style={{
        background: theme.bg,
        border: `1px solid ${theme.border}`,
        borderRadius: 12,
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Toggle on={live} busy={busy} onClick={onToggle} small />

      <span
        title={account.connectionType}
        style={{
          width: 28,
          height: 28,
          borderRadius: 7,
          background: theme.card,
          border: `1px solid ${theme.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: theme.textSecondary,
          flexShrink: 0,
        }}
      >
        {account.connectionType === 'web' ? <GlobeIcon /> : <PhoneIcon />}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: theme.textPrimary }}>
          {account.displayName || account.platform}
        </div>
        <div
          style={{
            fontSize: 12.5,
            color: theme.textSecondary,
            fontFamily: 'monospace',
          }}
        >
          {maskUpi(account.upiId)}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: live ? theme.success : theme.textSecondary,
          }}
        />
        <span style={{ fontSize: 11.5, color: theme.textSecondary }}>Day</span>
      </div>

      <button
        className="icon-btn"
        title="Details"
        onClick={() => navigator.clipboard?.writeText(account.upiId || '')}
        style={{
          background: 'transparent',
          border: 'none',
          color: theme.textSecondary,
          width: 28,
          height: 28,
          borderRadius: 7,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <PencilIcon />
      </button>
    </div>
  )
}

function Toggle({ on, busy, onClick, small }) {
  const w = small ? 42 : 48
  const h = small ? 24 : 26
  const knob = h - 6
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      disabled={busy}
      className="btn"
      style={{
        width: w,
        height: h,
        borderRadius: h,
        border: 'none',
        background: on ? theme.accent : '#2b3038',
        position: 'relative',
        padding: 0,
        flexShrink: 0,
        cursor: busy ? 'wait' : 'pointer',
      }}
      title={on ? 'Live — click to pause' : 'Paused — click to set live'}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: on ? w - knob - 3 : 3,
          width: knob,
          height: knob,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.18s ease',
          boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
        }}
      />
    </button>
  )
}

function MenuItem({ children, onClick }) {
  return (
    <button
      className="nav-link"
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: 'transparent',
        border: 'none',
        color: theme.textPrimary,
        padding: '10px 14px',
        fontSize: 13.5,
      }}
    >
      {children}
    </button>
  )
}

function Avatar({ text }) {
  return (
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: 10,
        background: theme.accentDim,
        color: theme.accent,
        border: `1px solid ${theme.accentBorder}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: 13,
        flexShrink: 0,
      }}
    >
      {initials(text)}
    </div>
  )
}

function IconPlus({ onClick, small }) {
  const s = small ? 26 : 32
  return (
    <button
      className="icon-btn"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      style={{
        width: s,
        height: s,
        borderRadius: 8,
        background: 'transparent',
        border: `1px solid ${theme.border}`,
        color: theme.accent,
        fontSize: small ? 15 : 18,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      +
    </button>
  )
}

function GlobeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" />
    </svg>
  )
}
function PhoneIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <line x1="10" y1="18" x2="14" y2="18" />
    </svg>
  )
}
function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  )
}
