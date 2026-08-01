import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Card, Badge, Button, SearchInput, Select, Pagination, PageHeader, Modal, Field, Input, InlineLoader } from '../components/ui';
import AdminIdPopover from '../components/AdminIdPopover';
import ConfirmModal from '../components/ConfirmModal';
import { IconPlus, IconPhone } from '../components/icons';
import { inr, usdt, pct } from '../utils/mock';
import { useApi } from '../hooks/useApi';
import { adminApi } from '../services/api';
import { toast } from '../components/toast';

// Generate a random strong password (letters, digits, symbols).
function genPassword(len = 16) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  const arr = new Uint32Array(len);
  (window.crypto || window.msCrypto).getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join('');
}

function copy(text, label = 'Copied') {
  if (!text) return;
  navigator.clipboard?.writeText(String(text)).then(
    () => toast(`${label} to clipboard`, 'success'),
    () => toast('Copy failed', 'error')
  );
}

// Deposit types the trader accepts. Stored as JSON on traders.deposit_types;
// tolerate an array, a JSON string, or null (defaults to both).
export function parseDepositTypes(raw) {
  let arr = raw;
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr); } catch (e) { arr = null; }
  }
  if (!Array.isArray(arr)) return ['FTD', 'STD'];
  const valid = [...new Set(arr.filter((x) => x === 'FTD' || x === 'STD'))];
  return valid.length ? valid : ['FTD', 'STD'];
}

// Map a backend trader record onto the shape the table/modal expect. No
// success-rate / risk-level / earnings-breakdown fields here — the old
// version of this page hardcoded `successRate: 100` (always 100%,
// regardless of reality) and an all-zero `earnings` object with no backend
// source at all. Both dropped rather than shown as if real; "risk level"
// was never here to begin with (no risk model exists anywhere, per the
// mapping review).
function mapTrader(t) {
  const rawStatus = t.user?.status || 'active';
  return {
    id: t.id,
    name: t.user?.email ? t.user.email.split('@')[0] : `trader-${t.id}`,
    email: t.user?.email || '',
    depositTypes: parseDepositTypes(t.deposit_types),
    balanceUsdt: Number(t.balance_usdt) || 0,
    todayVolumeInr: Number(t.current_daily_used) || 0,
    dailyLimit: Number(t.daily_limit) || 0,
    commissionRate: Number(t.commission_rate) || 0,
    payoutCommission: Number(t.payout_commission) || 0,
    traderMargin: t.trader_margin != null ? Number(t.trader_margin) : (Number(t.commission_rate) || 4),
    rateLabel: t.rate_label || '',
    rawStatus,
    status: rawStatus === 'suspended' || rawStatus === 'inactive' ? 'suspended' : 'active',
    online: !!t.is_online,
  };
}

async function fetchAllTraders() {
  const first = await adminApi.listTraders({ page: 1, limit: 100 });
  const rows = [...(first.traders || [])];
  const total = first.pagination?.total ?? rows.length;
  const pages = Math.min(5, Math.ceil(total / 100));
  for (let p = 2; p <= pages; p++) {
    const res = await adminApi.listTraders({ page: p, limit: 100 });
    rows.push(...(res.traders || []));
  }
  return rows;
}

// A shared, real recent-orders window (like Dashboard/Attention use) — feeds
// both the per-row "active orders" count and each trader's detail-modal
// transaction history, replacing the old always-empty mock `orders` import.
async function fetchRecentOrders(maxPages = 5) {
  const first = await adminApi.listOrders({ page: 1, limit: 100 });
  const all = [...(first.orders || [])];
  const total = first.pagination?.total ?? all.length;
  const pages = Math.min(maxPages, Math.ceil(total / 100));
  for (let p = 2; p <= pages; p++) {
    const res = await adminApi.listOrders({ page: p, limit: 100 });
    all.push(...(res.orders || []));
  }
  return all;
}

const PER_PAGE = 12;

function DepositTypesField({ value = [], onChange }) {
  const toggle = (t) => {
    const next = value.includes(t) ? value.filter((x) => x !== t) : [...value, t];
    if (!next.length) return;
    onChange(next);
  };
  const OPTIONS = [
    { key: 'FTD', label: 'FTD (First Time Deposits)' },
    { key: 'STD', label: 'STD (Standard Deposits)' },
  ];
  return (
    <div>
      <label className="mb-1.5 block text-sm text-[var(--muted)]">Deposit Types Accepted</label>
      <div className="space-y-2">
        {OPTIONS.map((o) => (
          <label key={o.key} className="flex items-center gap-2 text-sm text-[var(--text)]">
            <input type="checkbox" checked={value.includes(o.key)} onChange={() => toggle(o.key)} className="h-4 w-4 rounded border-[var(--cardborder)] bg-[var(--hover)] accent-[var(--accent)]" />
            {o.label}
          </label>
        ))}
      </div>
      <p className="mt-1 text-xs text-[var(--muted)]">At least one type must be selected.</p>
    </div>
  );
}

function DepositTypeBadges({ types = [] }) {
  if (!types.length) return <span className="text-xs text-[var(--muted)]">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {types.includes('FTD') && <Badge color="green">FTD</Badge>}
      {types.includes('STD') && <Badge color="sky">STD</Badge>}
    </span>
  );
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
];
const ONLINE_OPTIONS = [
  { value: 'all', label: 'Online & Offline' },
  { value: 'online', label: 'Online only' },
  { value: 'offline', label: 'Offline only' },
];

function RowMenu({ trader, onView, onEdit, onBalance, onCommission, onSuspendRequest }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const isActive = trader.status === 'active';
  const items = [
    { label: 'Edit Balance', icon: '💰', fn: () => onBalance(trader) },
    { label: 'Edit Commercial', icon: '％', fn: () => onCommission(trader) },
    { label: 'Edit Details', icon: '✏️', fn: () => onEdit(trader) },
    { label: 'View Details', icon: '🔍', fn: () => onView(trader) },
    isActive
      ? { label: 'Suspend', icon: '🚫', danger: true, fn: () => onSuspendRequest(trader, true) }
      : { label: 'Activate', icon: '✅', fn: () => onSuspendRequest(trader, false) },
  ];

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  return (
    <div className="flex justify-end">
      <button ref={btnRef} onClick={toggle} aria-label="Actions" title="Actions" className="inline-flex items-center gap-1 rounded-md border border-[var(--cardborder)] px-2.5 py-1 text-sm leading-none text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]">
        ✎ <span className="text-[10px]">▼</span>
      </button>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed z-50 w-48 rounded-lg border border-[var(--cardborder)] bg-[var(--card)] py-1 text-sm shadow-xl" style={{ top: pos.top, right: pos.right }}>
            {items.map((a) => (
              <button key={a.label} onClick={() => { a.fn(); setOpen(false); }} className={`flex w-full items-center gap-2.5 px-4 py-2 text-left hover:bg-[var(--hover)] ${a.danger ? 'text-red-400 hover:text-red-300' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>
                <span className="w-4 text-center text-xs">{a.icon}</span>
                {a.label}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

// Real detail modal: wallet/commission/pay-in capacity from the trader row
// itself, real linked smartphones (cross-referenced from adminApi.
// listSmartphones() by trader_id) and real recent transactions (from the
// shared recent-orders window, filtered by trader). No Bank Accounts
// section (no admin endpoint lists a trader's payment accounts), no
// Earnings Breakdown (was 100% fake), no Risk level (no such concept in
// the backend at all).
function TraderModal({ trader, smartphones, orders, ordersLoading, onClose, onAddBalance, onSuspendRequest }) {
  if (!trader) return null;
  const devices = smartphones.filter((s) => s.trader_id === trader.id || s.trader?.id === trader.id);
  const history = orders.filter((o) => o.trader?.id === trader.id).slice(0, 6);
  const activeOrders = orders.filter((o) => o.trader?.id === trader.id && ['claimed_paid', 'under_review'].includes(o.status)).length;

  return (
    <Modal
      open={!!trader}
      onClose={onClose}
      size="xl"
      title={trader.name}
      subtitle={`Trader #${trader.id} · ${trader.email}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="ghost" onClick={() => onAddBalance(trader)}>Add balance</Button>
          {trader.status === 'active'
            ? <Button variant="danger" onClick={() => onSuspendRequest(trader, true)}>Suspend trader</Button>
            : <Button variant="success" onClick={() => onSuspendRequest(trader, false)}>Reactivate trader</Button>}
        </>
      }
    >
      <div className="space-y-6">
        <section>
          <h3 className="mb-3 text-sm font-semibold text-[var(--text)]">Overview</h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Status"><Badge color={trader.status === 'active' ? 'green' : 'red'}>{trader.status}</Badge></Field>
            <Field label="Presence"><Badge color={trader.online ? 'green' : 'gray'}>{trader.online ? 'Online' : 'Offline'}</Badge></Field>
            <Field label="Wallet balance">{usdt(trader.balanceUsdt)}</Field>
            <Field label="Trader margin">{pct(trader.traderMargin)}</Field>
            <Field label="Payout commission">{pct(trader.payoutCommission)}</Field>
            <Field label="Deposit types"><DepositTypeBadges types={trader.depositTypes} /></Field>
            <Field label="Pay-in capacity">{inr(trader.todayVolumeInr)} / {inr(trader.dailyLimit)}</Field>
            <Field label="Active orders">{ordersLoading ? '…' : activeOrders}</Field>
          </div>
        </section>

        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
            <IconPhone className="h-4 w-4 text-[var(--muted)]" /> Linked Smartphones ({devices.length})
          </h3>
          <div className="space-y-2">
            {devices.length === 0 && <p className="text-sm text-[var(--muted)]">No devices linked.</p>}
            {devices.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border border-[var(--cardborder)] bg-[var(--hover)] px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${p.is_online ? 'bg-emerald-500' : 'bg-[var(--muted)]'}`} />
                  <span className="text-sm text-[var(--text)]">{p.device_id || `Device #${p.id}`}</span>
                  {p.connection_type && <span className="text-xs text-[var(--muted)]">· {p.connection_type}</span>}
                </div>
                <Badge color={p.is_online ? 'green' : 'gray'}>{p.is_online ? 'online' : 'offline'}</Badge>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-[var(--text)]">Recent Transactions</h3>
          <div className="overflow-hidden rounded-lg border border-[var(--cardborder)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--hover)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <tr><th className="px-3 py-2">Order</th><th className="px-3 py-2">Merchant</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-[var(--cardborder)]">
                {ordersLoading && <tr><td colSpan={4} className="px-3 py-4 text-center text-[var(--muted)]">Loading…</td></tr>}
                {!ordersLoading && history.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-4 text-center text-[var(--muted)]">No recent transactions in the fetched window</td></tr>
                )}
                {history.map((o) => (
                  <tr key={o.id} className="text-[var(--text)]">
                    <td className="px-3 py-2 font-mono text-xs text-[var(--muted)]">#{o.id}</td>
                    <td className="px-3 py-2">{o.merchant?.business_name || '—'}</td>
                    <td className="px-3 py-2">{inr(o.amount_inr)}</td>
                    <td className="px-3 py-2 text-[var(--muted)]">{o.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!ordersLoading && <p className="mt-1.5 text-xs text-[var(--muted)]">From the {orders.length.toLocaleString()} most recently fetched platform-wide orders, not this trader's full history.</p>}
        </section>
      </div>
    </Modal>
  );
}

function BalanceModal({ trader, onClose, onSaved }) {
  const [action, setAction] = useState('add');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setAction('add'); setAmount(''); setNote(''); }, [trader?.id]);
  if (!trader) return null;

  const submit = async () => {
    const amt = Number(amount);
    if (!(amt > 0)) { toast('Enter a positive amount', 'error'); return; }
    setSaving(true);
    try {
      await adminApi.updateTraderBalance(trader.id, { action, amount_usdt: amt, note: note.trim() || undefined });
      toast(`Balance ${action === 'add' ? 'added' : 'deducted'} successfully`, 'success');
      onSaved();
      onClose();
    } catch (err) {
      toast(err.response?.data?.error?.message || err.response?.data?.message || 'Failed to update balance', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={!!trader} onClose={onClose} size="md" title="Adjust Balance" subtitle={`${trader.name} · current ${usdt(trader.balanceUsdt)}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Apply'}</Button></>}>
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm text-[var(--muted)]">Action</label>
          <div className="flex gap-4">
            {[['add', 'Add'], ['deduct', 'Deduct']].map(([v, l]) => (
              <label key={v} className="flex items-center gap-2 text-sm text-[var(--text)]">
                <input type="radio" name="balance-action" value={v} checked={action === v} onChange={() => setAction(v)} className="accent-[var(--accent)]" />
                {l}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-[var(--muted)]">Amount (USDT)</label>
          <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 500" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-[var(--muted)]">Note (optional)</label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for adjustment" />
        </div>
      </div>
    </Modal>
  );
}

function EditTraderModal({ trader, onClose, onSaved }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (trader) setForm({
      commission_rate: String(trader.commissionRate ?? ''),
      payout_commission: String(trader.payoutCommission ?? ''),
      rate_label: trader.rateLabel || '',
      daily_limit: String(trader.dailyLimit ?? ''),
      status: trader.status === 'active' ? 'active' : 'inactive',
      deposit_types: trader.depositTypes || ['FTD', 'STD'],
    });
  }, [trader?.id]);
  if (!trader || !form) return null;

  const upd = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async () => {
    setSaving(true);
    try {
      await adminApi.updateTrader(trader.id, {
        commission_rate: Number(form.commission_rate) || 0,
        payout_commission: Number(form.payout_commission) || 0,
        rate_label: form.rate_label.trim(),
        daily_limit: Number(form.daily_limit) || 0,
        status: form.status,
        deposit_types: form.deposit_types,
      });
      toast('Trader updated', 'success');
      onSaved();
      onClose();
    } catch (err) {
      toast(err.response?.data?.error?.message || err.response?.data?.message || 'Failed to update trader', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={!!trader} onClose={onClose} size="md" title="Edit Trader" subtitle={`${trader.name} · ${trader.email}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block text-sm text-[var(--muted)]">Commission rate (%)</label>
            <Input type="number" step="0.01" value={form.commission_rate} onChange={(e) => upd('commission_rate')(e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-[var(--muted)]">Payout commission (%)</label>
            <Input type="number" step="0.01" value={form.payout_commission} onChange={(e) => upd('payout_commission')(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-[var(--muted)]">Rate label</label>
          <Input value={form.rate_label} onChange={(e) => upd('rate_label')(e.target.value)} placeholder="e.g. Standard" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-[var(--muted)]">Daily limit (INR)</label>
          <Input type="number" value={form.daily_limit} onChange={(e) => upd('daily_limit')(e.target.value)} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-[var(--muted)]">Status</label>
          <Select value={form.status} onChange={upd('status')} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
        </div>
        <DepositTypesField value={form.deposit_types} onChange={upd('deposit_types')} />
      </div>
    </Modal>
  );
}

function EditCommissionModal({ trader, onClose, onSaved }) {
  const [traderMargin, setTraderMargin] = useState('');
  const [payout, setPayout] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (trader) {
      setTraderMargin(String(trader.traderMargin ?? '4.00'));
      setPayout(String(trader.payoutCommission ?? '2.00'));
    }
  }, [trader?.id]);
  if (!trader) return null;

  const tm = Number(traderMargin) || 0;
  const isValid = tm > 0;

  const submit = async () => {
    if (!isValid) return;
    setSaving(true);
    try {
      await adminApi.updateTraderCommission(trader.id, { trader_margin: tm, commission_rate: tm, payout_commission: Number(payout) || 0 });
      toast('Commercial settings updated', 'success');
      onSaved();
      onClose();
    } catch (err) {
      toast(err.response?.data?.message || err.response?.data?.error?.message || 'Failed to update', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={!!trader} onClose={onClose} size="md" title={`Edit Commercial — ${trader.name}`} subtitle={`Balance ${usdt(trader.balanceUsdt)}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={saving || !isValid}>{saving ? 'Saving…' : 'Save changes'}</Button></>}>
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm text-[var(--muted)]">Trader Margin (My Rate) %</label>
          <Input type="number" step="0.01" min="0" value={traderMargin} onChange={(e) => setTraderMargin(e.target.value)} placeholder="4.00" />
          <p className="mt-1 text-xs text-[var(--muted)]">
            Deducted from this trader on each confirmed order. Platform profit on an order = the paired merchant's Pay-in Fee % minus this margin — set the merchant's fee from Merchants → Edit Fees.
          </p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-[var(--muted)]">Payout Commission %</label>
          <Input type="number" step="0.01" min="0" value={payout} onChange={(e) => setPayout(e.target.value)} placeholder="2.00" />
          <p className="mt-1 text-xs text-[var(--muted)]">Credited to this trader on each settled payout (Buy USDT).</p>
        </div>
      </div>
    </Modal>
  );
}

export default function Traders() {
  const [list, setList] = useState([]);
  const [filters, setFilters] = useState({ status: 'all', online: 'all', q: '' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ full_name: '', email: '', password: '', commission_rate: '4.00', payout_commission: '2.00', initial_balance_usdt: '0', daily_limit: '500000', telegram_chat_id: '', deposit_types: ['FTD', 'STD'] });
  const [created, setCreated] = useState(null);
  const [balanceFor, setBalanceFor] = useState(null);
  const [editFor, setEditFor] = useState(null);
  const [commissionFor, setCommissionFor] = useState(null);
  const [confirming, setConfirming] = useState(null); // { trader, next }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [smartphones, setSmartphones] = useState([]);
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await fetchAllTraders();
      setList(rows.map(mapTrader));
    } catch (e) {
      toast('Could not load traders.', 'error');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  // Real cross-reference data for the detail modal — fetched once, reused
  // across every trader (same "shared window" pattern as Dashboard).
  useEffect(() => {
    adminApi.listSmartphones().then((res) => setSmartphones(res.smartphones || [])).catch(() => {});
    setOrdersLoading(true);
    fetchRecentOrders().then(setOrders).catch(() => setOrders([])).finally(() => setOrdersLoading(false));
  }, []);

  const set = (k) => (v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };

  const requestSuspend = (t, shouldSuspend) => setConfirming({ trader: t, next: shouldSuspend });

  const applySuspend = async () => {
    if (!confirming) return;
    const { trader: t, next: shouldSuspend } = confirming;
    const nextStatus = shouldSuspend ? 'suspended' : 'active';
    setList((l) => l.map((x) => (x.id === t.id ? { ...x, status: nextStatus, online: shouldSuspend ? false : x.online } : x)));
    try {
      await adminApi.suspendTrader(t.id, shouldSuspend);
      toast(`${t.name} ${shouldSuspend ? 'suspended' : 'activated'}`, shouldSuspend ? 'info' : 'success');
      load();
    } catch (err) {
      setList((l) => l.map((x) => (x.id === t.id ? { ...x, status: t.status, online: t.online } : x)));
      toast(err.response?.data?.message || 'Failed to update trader status', 'error');
    } finally {
      setConfirming(null);
      setSelected(null);
    }
  };

  const toggleOnline = async (t) => {
    const next = !t.online;
    setList((l) => l.map((x) => (x.id === t.id ? { ...x, online: next } : x)));
    try {
      await adminApi.setTraderOnline(t.id, next);
      toast(`${t.name} is now ${next ? 'online' : 'offline'}`, next ? 'success' : 'info');
    } catch (err) {
      setList((l) => l.map((x) => (x.id === t.id ? { ...x, online: t.online } : x)));
      toast('Failed to update online status', 'error');
    }
  };

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return list.filter((t) => {
      if (filters.status !== 'all' && t.status !== filters.status) return false;
      if (filters.online !== 'all' && (filters.online === 'online') !== t.online) return false;
      if (q && !t.name.toLowerCase().includes(q) && !t.email.toLowerCase().includes(q) && !String(t.id).includes(q)) return false;
      return true;
    });
  }, [list, filters]);

  const pageRows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const selectedLive = selected ? list.find((t) => t.id === selected.id) : null;

  const resetDraft = () => setDraft({ full_name: '', email: '', password: '', commission_rate: '4.00', payout_commission: '2.00', initial_balance_usdt: '0', daily_limit: '500000', telegram_chat_id: '', deposit_types: ['FTD', 'STD'] });

  const addTrader = async () => {
    if (!draft.email.trim() || !draft.password.trim()) { toast('Email and password are required', 'error'); return; }
    setSaving(true);
    try {
      const data = await adminApi.createTraderFull({
        full_name: draft.full_name.trim() || undefined,
        email: draft.email.trim(),
        password: draft.password,
        commission_rate: Number(draft.commission_rate) || 0,
        payout_commission: Number(draft.payout_commission) || 0,
        initial_balance_usdt: Number(draft.initial_balance_usdt) || 0,
        daily_limit: Number(draft.daily_limit) || 0,
        telegram_chat_id: draft.telegram_chat_id.trim() || undefined,
        deposit_types: draft.deposit_types,
      });
      const creds = data?.credentials || { email: draft.email.trim(), password: draft.password };
      setCreated(creds);
      toast('Trader created', 'success');
      resetDraft();
      setShowAdd(false);
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || err.response?.data?.message || 'Failed to create trader', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Traders"
        subtitle={`${filtered.length} of ${list.length} traders`}
        actions={<>{loading && <InlineLoader />}<Button onClick={() => setShowAdd(true)}><IconPlus className="h-4 w-4" /> Add Trader</Button></>}
      />

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SearchInput value={filters.q} onChange={set('q')} placeholder="Search name, email, ID" className="lg:col-span-2" />
          <Select value={filters.status} onChange={set('status')} options={STATUS_OPTIONS} />
          <Select value={filters.online} onChange={set('online')} options={ONLINE_OPTIONS} />
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--cardborder)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="w-10 px-4 py-3" />
                <th className="px-4 py-3 font-medium">Trader</th>
                <th className="px-4 py-3 font-medium">Balance USDT</th>
                <th className="px-4 py-3 font-medium">Margin</th>
                <th className="px-4 py-3 font-medium">Types</th>
                <th className="px-4 py-3 font-medium">Pay-in capacity</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Presence</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--cardborder)]">
              {pageRows.map((t) => (
                <tr key={t.id} className="cursor-pointer text-[var(--text)] hover:bg-[var(--hover)]" onClick={() => setSelected(t)}>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <AdminIdPopover rows={[{ label: 'Trader ID', value: t.id }, { label: 'Email', value: t.email }]} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-[var(--text)]">{t.name}</div>
                    <div className="text-xs text-[var(--muted)]">{t.email}</div>
                  </td>
                  <td className="px-4 py-3 font-medium text-emerald-400">{usdt(t.balanceUsdt)}</td>
                  <td className="px-4 py-3">{pct(t.traderMargin)}</td>
                  <td className="px-4 py-3"><DepositTypeBadges types={t.depositTypes} /></td>
                  <td className="px-4 py-3">
                    <div>{inr(t.todayVolumeInr)}</div>
                    <div className="text-xs text-[var(--muted)]">of {inr(t.dailyLimit)}</div>
                  </td>
                  <td className="px-4 py-3"><Badge color={t.status === 'active' ? 'green' : 'red'}>{t.status}</Badge></td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => toggleOnline(t)}
                      title="Toggle online (demo)"
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${t.online ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20' : 'border-[var(--cardborder)] bg-[var(--hover)] text-[var(--muted)] hover:bg-[var(--hover)]'}`}
                    >
                      <span className={`h-2 w-2 rounded-full ${t.online ? 'bg-emerald-500' : 'bg-[var(--muted)]'}`} />
                      {t.online ? 'Online' : 'Offline'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <RowMenu trader={t} onView={setSelected} onEdit={setEditFor} onBalance={setBalanceFor} onCommission={setCommissionFor} onSuspendRequest={requestSuspend} />
                  </td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr><td colSpan={9} className="py-10 text-center text-sm text-[var(--muted)]">{loading ? 'Loading…' : 'No traders match your filters'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-[var(--cardborder)]">
          <Pagination page={page} perPage={PER_PAGE} total={filtered.length} onPage={setPage} />
        </div>
      </Card>

      <TraderModal
        trader={selectedLive}
        smartphones={smartphones}
        orders={orders}
        ordersLoading={ordersLoading}
        onClose={() => setSelected(null)}
        onAddBalance={(t) => { setSelected(null); setBalanceFor(t); }}
        onSuspendRequest={requestSuspend}
      />
      <BalanceModal trader={balanceFor} onClose={() => setBalanceFor(null)} onSaved={load} />
      <EditTraderModal trader={editFor} onClose={() => setEditFor(null)} onSaved={load} />
      <EditCommissionModal trader={commissionFor} onClose={() => setCommissionFor(null)} onSaved={load} />

      <ConfirmModal
        open={!!confirming}
        title={confirming?.next ? 'Suspend this trader?' : 'Reactivate this trader?'}
        description={
          confirming
            ? confirming.next
              ? `${confirming.trader.name} will be immediately removed from routing eligibility, forced offline, and blocked from logging in. Reversible from this same screen.`
              : `${confirming.trader.name} will become eligible for routing and able to log in again.`
            : ''
        }
        tone={confirming?.next ? 'danger' : 'primary'}
        confirmLabel={confirming?.next ? 'Suspend' : 'Reactivate'}
        onConfirm={applySuspend}
        onClose={() => setConfirming(null)}
      />

      <Modal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        size="md"
        title="Add New Trader"
        subtitle="Create a trader account"
        footer={<><Button variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={addTrader} disabled={saving}>{saving ? 'Creating…' : 'Create trader'}</Button></>}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm text-[var(--muted)]">Full name</label>
            <Input value={draft.full_name} onChange={(e) => setDraft((d) => ({ ...d, full_name: e.target.value }))} placeholder="John Doe" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-[var(--muted)]">Email</label>
            <Input value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} placeholder="trader@example.com" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-[var(--muted)]">Password</label>
            <div className="flex gap-2">
              <Input value={draft.password} onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))} placeholder="Set or auto-generate" className="flex-1" />
              <Button variant="ghost" onClick={() => setDraft((d) => ({ ...d, password: genPassword() }))}>Auto-generate</Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm text-[var(--muted)]">Commission rate (%)</label>
              <Input type="number" step="0.01" value={draft.commission_rate} onChange={(e) => setDraft((d) => ({ ...d, commission_rate: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-[var(--muted)]">Payout commission (%)</label>
              <Input type="number" step="0.01" value={draft.payout_commission} onChange={(e) => setDraft((d) => ({ ...d, payout_commission: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-[var(--muted)]">Initial USDT balance</label>
              <Input type="number" step="0.01" value={draft.initial_balance_usdt} onChange={(e) => setDraft((d) => ({ ...d, initial_balance_usdt: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-[var(--muted)]">Daily limit (INR)</label>
              <Input type="number" value={draft.daily_limit} onChange={(e) => setDraft((d) => ({ ...d, daily_limit: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-[var(--muted)]">Telegram ID (optional)</label>
            <Input value={draft.telegram_chat_id} onChange={(e) => setDraft((d) => ({ ...d, telegram_chat_id: e.target.value }))} placeholder="e.g. 123456789" />
          </div>
          <DepositTypesField value={draft.deposit_types} onChange={(v) => setDraft((d) => ({ ...d, deposit_types: v }))} />
        </div>
      </Modal>

      <Modal
        open={!!created}
        onClose={() => setCreated(null)}
        size="md"
        title="Trader created"
        subtitle="Share these login credentials with the trader"
        footer={<Button onClick={() => setCreated(null)}>Done</Button>}
      >
        <div className="space-y-4">
          <p className="text-sm text-amber-400">Save these now — the password won't be shown again.</p>
          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted)]">Email</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-[var(--hover)] px-3 py-2 font-mono text-xs text-[var(--muted)]">{created?.email || '—'}</code>
              <Button size="sm" variant="ghost" onClick={() => copy(created?.email, 'Email copied')}>Copy</Button>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted)]">Password</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-[var(--hover)] px-3 py-2 font-mono text-xs text-[var(--muted)]">{created?.password || '—'}</code>
              <Button size="sm" variant="ghost" onClick={() => copy(created?.password, 'Password copied')}>Copy</Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
