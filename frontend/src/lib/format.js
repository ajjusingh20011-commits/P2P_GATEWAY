// Formatting helpers shared across pages.

// Amounts come from the backend as strings (e.g. "1,500"). Parse safely.
export function toNumber(amount) {
  const n = parseFloat(String(amount == null ? '' : amount).replace(/,/g, ''))
  return Number.isNaN(n) ? 0 : n
}

// Indian-style currency formatting, e.g. 128500 -> "₹1,28,500".
export function formatMoney(amount) {
  const n = toNumber(amount)
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

export function formatNumber(n) {
  return Number(n || 0).toLocaleString('en-IN')
}

// Mask a UPI id like "trader@okaxis" -> "tr*******@okaxis".
export function maskUpi(upi) {
  if (!upi) return '—'
  const [name, domain] = String(upi).split('@')
  if (!domain) return upi
  const visible = name.slice(0, 2)
  const masked = '*'.repeat(Math.max(name.length - 2, 3))
  return `${visible}${masked}@${domain}`
}

// Friendly relative/absolute time.
export function formatTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const diffMs = Date.now() - d.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Derive a human bank label from a UPI handle suffix (best-effort).
const BANK_MAP = {
  okaxis: 'Axis Bank',
  axl: 'Axis Bank',
  ybl: 'Yes Bank',
  okhdfcbank: 'HDFC Bank',
  hdfcbank: 'HDFC Bank',
  oksbi: 'State Bank of India',
  sbi: 'State Bank of India',
  okicici: 'ICICI Bank',
  icici: 'ICICI Bank',
  ibl: 'IDBI Bank',
  paytm: 'Paytm Payments Bank',
  apl: 'Amazon Pay',
  pz: 'PhonePe',
  upi: 'UPI',
}

export function bankFromUpi(upi, fallback = 'Bank Account') {
  if (!upi) return fallback
  const suffix = String(upi).split('@')[1]
  if (!suffix) return fallback
  return BANK_MAP[suffix.toLowerCase()] || fallback
}

export function initials(text) {
  if (!text) return '?'
  const parts = String(text).trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}
