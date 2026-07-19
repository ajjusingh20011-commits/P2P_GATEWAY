import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Card, Badge, Button, SearchInput, Select, Pagination, PageHeader, Modal, Field, Input, InlineLoader } from '../components/ui';
import { IconPlus, IconWallet, IconPhone } from '../components/icons';
import { traders as seedTraders, orders, ACCOUNT_TYPES, inr, usdt, pct, maskUpi } from '../utils/mock';
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

// Copy text to the clipboard and toast the outcome.
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

// Map a backend trader record onto the shape the table/modal expect.
function mapTrader(t) {
  const name = t.user?.email ? t.user.email.split('@')[0] : `trader-${t.id}`;
  const rawStatus = t.user?.status || 'active';
  return {
    id: t.id,
    name,
    email: t.user?.email || '',
    depositTypes: parseDepositTypes(t.deposit_types),
    balanceUsdt: Number(t.balance_usdt) || 0,
    todayVolumeInr: Number(t.current_daily_used) || 0,
    dailyLimit: Number(t.daily_limit) || 0,
    commissionRate: Number(t.commission_rate) || 0,
    payoutCommission: Number(t.payout_commission) || 0,
    traderMargin: t.trader_margin != null ? Number(t.trader_margin) : (Number(t.commission_rate) || 4),
    adminMargin: t.admin_margin != null ? Number(t.admin_margin) : 5,
    rateLabel: t.rate_label || '',
    successRate: 100,
    rawStatus,
    status: rawStatus === 'suspended' || rawStatus === 'inactive' ? 'suspended' : 'active',
    online: !!t.is_online,
    joinedAt: '—',
    phone: '+91 —',
    bankAccounts: [],
    smartphones: [],
    earnings: { grossVolume: 0, platformFee: 0, commission: 0, net: 0, tradesToday: 0 },
  };
}

const PER_PAGE = 12;

// "Deposit Types Accepted" checkbox group — at least one must stay checked.
function DepositTypesField({ value = [], onChange }) {
  const toggle = (t) => {
    const next = value.includes(t) ? value.filter((x) => x !== t) : [...value, t];
    if (!next.length) return; // never allow zero types
    onChange(next);
  };
  const OPTIONS = [
    { key: 'FTD', label: 'FTD (First Time Deposits)' },
    { key: 'STD', label: 'STD (Standard Deposits)' },
  ];
  return (
    <div>
      <label className="mb-1.5 block text-sm text-gray-400">Deposit Types Accepted</label>
      <div className="space-y-2">
        {OPTIONS.map((o) => (
          <label key={o.key} className="flex items-center gap-2 text-sm text-gray-200">
            <input
              type="checkbox"
              checked={value.includes(o.key)}
              onChange={() => toggle(o.key)}
              className="h-4 w-4 rounded border-gray-600 bg-gray-800 accent-red-500"
            />
            {o.label}
          </label>
        ))}
      </div>
      <p className="mt-1 text-xs text-gray-500">At least one type must be selected.</p>
    </div>
  );
}

// TYPES column badges: FTD green, STD blue.
function DepositTypeBadges({ types = [] }) {
  if (!types.length) return <span className="text-xs text-gray-500">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {types.includes('FTD') && <Badge color="green">FTD</Badge>}
      {types.includes('STD') && <Badge color="sky">STD</Badge>}
    </div>
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

// Compact per-row actions menu (the single "✎" pencil button). The dropdown is
// rendered through a portal with fixed positioning so it is NOT clipped by the
// table's `overflow-x-auto` wrapper (which was hiding the menu before).
function RowMenu({ trader, onView, onEdit, onBalance, onCommission, onSuspend }) {
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
      ? { label: 'Suspend', icon: '🚫', danger: true, fn: () => onSuspend(trader, true) }
      : { label: 'Activate', icon: '✅', fn: () => onSuspend(trader, false) },
  ];

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    }
    setOpen((v) => !v);
  };

  // Close on scroll / resize (the fixed menu would otherwise detach from the button).
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
      <button
        ref={btnRef}
        onClick={toggle}
        aria-label="Actions"
        title="Actions"
        className="inline-flex items-center gap-1 rounded-md border border-gray-700 px-2.5 py-1 text-sm leading-none text-gray-300 hover:bg-gray-800 hover:text-white"
      >
        ✎ <span className="text-[10px]">▼</span>
      </button>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 w-48 rounded-lg border border-gray-800 bg-gray-900 py-1 text-sm shadow-xl"
            style={{ top: pos.top, right: pos.right }}
          >
            {items.map((a) => (
              <button
                key={a.label}
                onClick={() => { a.fn(); setOpen(false); }}
                className={`flex w-full items-center gap-2.5 px-4 py-2 text-left hover:bg-gray-800 ${
                  a.danger ? 'text-red-400 hover:text-red-300' : 'text-gray-300 hover:text-white'
                }`}
              >
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

function TraderModal({ trader, onClose }) {
  if (!trader) return null;
  const history = orders.filter((o) => o.traderId === trader.id).slice(0, 6);
  const e = trader.earnings;
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
          <Button variant="ghost">Reset password</Button>
          <Button>Add balance</Button>
        </>
      }
    >
      <div className="space-y-6">
        {/* Personal info */}
        <section>
          <h3 className="mb-3 text-sm font-semibold text-white">Personal Information</h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Status"><Badge color={trader.status === 'active' ? 'green' : 'red'}>{trader.status}</Badge></Field>
            <Field label="Presence"><Badge color={trader.online ? 'green' : 'gray'}>{trader.online ? 'Online' : 'Offline'}</Badge></Field>
            <Field label="Phone">{trader.phone}</Field>
            <Field label="Joined">{trader.joinedAt}</Field>
            <Field label="Balance">{usdt(trader.balanceUsdt)}</Field>
            <Field label="Today volume">{inr(trader.todayVolumeInr)}</Field>
            <Field label="Success rate">{pct(trader.successRate)}</Field>
            <Field label="Trades today">{e.tradesToday}</Field>
          </div>
        </section>

        {/* Earnings */}
        <section>
          <h3 className="mb-3 text-sm font-semibold text-white">Earnings Breakdown</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Gross volume', value: inr(e.grossVolume) },
              { label: 'Platform fee', value: inr(e.platformFee) },
              { label: 'Commission', value: inr(e.commission) },
              { label: 'Net earnings', value: inr(e.net), accent: true },
            ].map((x) => (
              <div key={x.label} className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                <p className="text-xs text-gray-500">{x.label}</p>
                <p className={`mt-1 text-sm font-semibold ${x.accent ? 'text-emerald-400' : 'text-gray-100'}`}>{x.value}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Bank accounts + phones */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
              <IconWallet className="h-4 w-4 text-gray-400" /> Bank Accounts ({trader.bankAccounts.length})
            </h3>
            <div className="space-y-2">
              {trader.bankAccounts.map((b) => (
                <div key={b.id} className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-950 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-gray-100">{b.accountName}</p>
                    <p className="truncate text-xs text-gray-500">{maskUpi(b.upiId)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge color={ACCOUNT_TYPES[b.type].color}>{ACCOUNT_TYPES[b.type].label}</Badge>
                    <Badge color={b.isActive ? 'green' : 'gray'}>{b.isActive ? 'active' : 'off'}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
              <IconPhone className="h-4 w-4 text-gray-400" /> Smartphones ({trader.smartphones.length})
            </h3>
            <div className="space-y-2">
              {trader.smartphones.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-950 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${p.online ? 'bg-emerald-500' : 'bg-gray-500'}`} />
                    <span className="text-sm text-gray-100">{p.name}</span>
                  </div>
                  <Badge color={p.online ? 'green' : 'gray'}>{p.online ? 'online' : 'offline'}</Badge>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Transaction history */}
        <section>
          <h3 className="mb-3 text-sm font-semibold text-white">Recent Transactions</h3>
          <div className="overflow-hidden rounded-lg border border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-950 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr><th className="px-3 py-2">Order</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Method</th><th className="px-3 py-2">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {history.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-500">No transactions</td></tr>
                )}
                {history.map((o) => (
                  <tr key={o.id} className="text-gray-200">
                    <td className="px-3 py-2 font-mono text-xs text-gray-400">{o.id}</td>
                    <td className="px-3 py-2">{inr(o.amountInr)}</td>
                    <td className="px-3 py-2"><Badge color={ACCOUNT_TYPES[o.method].color}>{ACCOUNT_TYPES[o.method].label}</Badge></td>
                    <td className="px-3 py-2 text-gray-400">{o.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Modal>
  );
}

// Adjust a trader's USDT balance (add / deduct).
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
    <Modal
      open={!!trader}
      onClose={onClose}
      size="md"
      title="Adjust Balance"
      subtitle={`${trader.name} · current ${usdt(trader.balanceUsdt)}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Apply'}</Button></>}
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm text-gray-400">Action</label>
          <div className="flex gap-4">
            {[['add', 'Add'], ['deduct', 'Deduct']].map(([v, l]) => (
              <label key={v} className="flex items-center gap-2 text-sm text-gray-200">
                <input type="radio" name="balance-action" value={v} checked={action === v} onChange={() => setAction(v)} className="accent-red-500" />
                {l}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-gray-400">Amount (USDT)</label>
          <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 500" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-gray-400">Note (optional)</label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for adjustment" />
        </div>
      </div>
    </Modal>
  );
}

// Edit trader commercial settings + status.
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
    <Modal
      open={!!trader}
      onClose={onClose}
      size="md"
      title="Edit Trader"
      subtitle={`${trader.name} · ${trader.email}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button></>}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">Commission rate (%)</label>
            <Input type="number" step="0.01" value={form.commission_rate} onChange={(e) => upd('commission_rate')(e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">Payout commission (%)</label>
            <Input type="number" step="0.01" value={form.payout_commission} onChange={(e) => upd('payout_commission')(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-gray-400">Rate label</label>
          <Input value={form.rate_label} onChange={(e) => upd('rate_label')(e.target.value)} placeholder="e.g. Standard" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-gray-400">Daily limit (INR)</label>
          <Input type="number" value={form.daily_limit} onChange={(e) => upd('daily_limit')(e.target.value)} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-gray-400">Status</label>
          <Select value={form.status} onChange={upd('status')} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
        </div>
        <DepositTypesField value={form.deposit_types} onChange={upd('deposit_types')} />
      </div>
    </Modal>
  );
}

// Edit ONLY the commission rates (dedicated PUT /traders/:id/commission).
// Edit the trader's rate margins with a LIVE preview of the resulting rates,
// per-100-INR USDT amounts, and the platform profit spread.
const BASE_RATE = 100; // display base (INR/USDT); real base comes from settings

function EditCommissionModal({ trader, onClose, onSaved }) {
  const [traderMargin, setTraderMargin] = useState('');
  const [adminMargin, setAdminMargin] = useState('');
  const [payout, setPayout] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (trader) {
      setTraderMargin(String(trader.traderMargin ?? '4.00'));
      setAdminMargin(String(trader.adminMargin ?? '5.00'));
      setPayout(String(trader.payoutCommission ?? '2.00'));
    }
  }, [trader?.id]);
  if (!trader) return null;

  // Live preview math (per 100 INR).
  const tm = Number(traderMargin) || 0;
  const am = Number(adminMargin) || 0;
  const traderRate = BASE_RATE * (1 + tm / 100);
  const adminRate = BASE_RATE * (1 + am / 100);
  const traderDeduction = 100 / traderRate; // USDT deducted from trader per 100 INR
  const merchantSettlement = 100 / adminRate; // USDT merchant receives per 100 INR
  const platformProfit = traderDeduction - merchantSettlement;
  const f = (n, d = 4) => (Number.isFinite(n) ? n.toFixed(d) : '—');

  // Rule: trader margin MUST be less than the admin/merchant margin, else the
  // platform makes zero/negative revenue. Save is disabled when invalid.
  const isValid = tm > 0 && am > 0 && tm < am;

  const submit = async () => {
    if (!isValid) return;
    setSaving(true);
    try {
      await adminApi.updateTraderCommission(trader.id, {
        trader_margin: tm,
        admin_margin: am,
        commission_rate: tm,
        payout_commission: Number(payout) || 0,
      });
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
    <Modal
      open={!!trader}
      onClose={onClose}
      size="md"
      title={`Edit Commercial — ${trader.name}`}
      subtitle={`Balance ${usdt(trader.balanceUsdt)} · base rate ₹${BASE_RATE}/USDT`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={saving || !isValid}>{saving ? 'Saving…' : 'Save changes'}</Button></>}
    >
      <div className="space-y-4">
        {/* Trader margin */}
        <div>
          <label className="mb-1.5 block text-sm text-gray-400">Trader Margin (My Rate) %</label>
          <Input type="number" step="0.01" min="0" max={am - 0.01} value={traderMargin} onChange={(e) => setTraderMargin(e.target.value)} placeholder="4.00" />
          {!isValid ? (
            <p className="mt-1 text-xs font-medium text-red-400">⚠️ Trader margin must be less than the admin/merchant margin ({f(am, 2)}%)</p>
          ) : (
            <p className="mt-1 text-xs text-emerald-400">
              Trader rate: base + {f(tm, 2)}% = <strong>₹{f(traderRate, 2)}</strong> · Deduction per 100 INR: <strong>{f(traderDeduction)} USDT</strong>
            </p>
          )}
        </div>

        {/* Admin / merchant margin */}
        <div>
          <label className="mb-1.5 block text-sm text-gray-400">Admin / Merchant Margin %</label>
          <Input type="number" step="0.01" min="0" value={adminMargin} onChange={(e) => setAdminMargin(e.target.value)} placeholder="5.00" />
          <p className="mt-1 text-xs text-sky-400">
            Admin rate: base + {f(am, 2)}% = <strong>₹{f(adminRate, 2)}</strong> · Merchant gets per 100 INR: <strong>{f(merchantSettlement)} USDT</strong>
          </p>
        </div>

        {/* Live preview box */}
        <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
          <p className="mb-2 text-[11px] uppercase tracking-wide text-gray-500">Live preview (per 100 INR)</p>
          <table className="w-full text-sm">
            <tbody>
              <tr><td className="py-0.5 text-gray-400">Base rate</td><td className="py-0.5 text-right text-gray-200">₹{BASE_RATE}</td></tr>
              <tr><td className="py-0.5 text-gray-400">Admin rate ({f(am, 2)}%)</td><td className="py-0.5 text-right text-emerald-400">₹{f(adminRate, 2)}</td></tr>
              <tr><td className="py-0.5 text-gray-400">Trader rate ({f(tm, 2)}%)</td><td className="py-0.5 text-right text-sky-400">₹{f(traderRate, 2)}</td></tr>
              <tr><td className="py-0.5 text-gray-400">Merchant gets</td><td className="py-0.5 text-right text-emerald-400">{f(merchantSettlement)} USDT</td></tr>
              <tr><td className="py-0.5 text-gray-400">Trader deduction</td><td className="py-0.5 text-right text-red-400">{f(traderDeduction)} USDT</td></tr>
              <tr className="border-t border-gray-800"><td className="py-1 font-semibold text-gray-200">Platform profit</td><td className="py-1 text-right font-semibold text-amber-400">+{f(platformProfit)} USDT</td></tr>
            </tbody>
          </table>
        </div>

        {/* Payout commission */}
        <div>
          <label className="mb-1.5 block text-sm text-gray-400">Payout Commission %</label>
          <Input type="number" step="0.01" min="0" value={payout} onChange={(e) => setPayout(e.target.value)} placeholder="2.00" />
        </div>
      </div>
    </Modal>
  );
}

export default function Traders() {
  const [list, setList] = useState(seedTraders);
  const [filters, setFilters] = useState({ status: 'all', online: 'all', q: '' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ full_name: '', email: '', password: '', commission_rate: '4.00', payout_commission: '2.00', initial_balance_usdt: '0', daily_limit: '500000', telegram_chat_id: '', deposit_types: ['FTD', 'STD'] });
  const [created, setCreated] = useState(null); // { email, password }
  const [balanceFor, setBalanceFor] = useState(null);
  const [editFor, setEditFor] = useState(null);
  const [commissionFor, setCommissionFor] = useState(null);

  // Load traders from the backend; keep the mock seed as fallback on error.
  const { data: apiData, loading, refetch } = useApi(() => adminApi.listTraders(), { fallback: null });
  useEffect(() => {
    if (apiData?.traders) setList(apiData.traders.map(mapTrader));
  }, [apiData]);

  const set = (k) => (v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };

  // Suspend / reactivate a trader (blocks login + removes from routing). Also
  // forces them offline server-side when suspending.
  const suspend = async (t, shouldSuspend) => {
    const nextStatus = shouldSuspend ? 'suspended' : 'active';
    setList((l) => l.map((x) => (x.id === t.id ? { ...x, status: nextStatus, online: shouldSuspend ? false : x.online } : x)));
    try {
      await adminApi.suspendTrader(t.id, shouldSuspend);
      toast(`${t.name} ${shouldSuspend ? 'suspended' : 'activated'}`, shouldSuspend ? 'info' : 'success');
      refetch();
    } catch (err) {
      setList((l) => l.map((x) => (x.id === t.id ? { ...x, status: t.status, online: t.online } : x)));
      toast(err.response?.data?.message || 'Failed to update trader status', 'error');
    }
  };

  // Demo helper: flip a trader online/offline (also refreshes their heartbeat
  // server-side so routing can assign them immediately).
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

  const [saving, setSaving] = useState(false);

  const resetDraft = () => setDraft({ full_name: '', email: '', password: '', commission_rate: '4.00', payout_commission: '2.00', initial_balance_usdt: '0', daily_limit: '500000', telegram_chat_id: '', deposit_types: ['FTD', 'STD'] });

  const addTrader = async () => {
    if (!draft.email.trim() || !draft.password.trim()) {
      toast('Email and password are required', 'error');
      return;
    }
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
      refetch();
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
        actions={
          <>
            {loading && <InlineLoader />}
            <Button onClick={() => setShowAdd(true)}><IconPlus className="h-4 w-4" /> Add Trader</Button>
          </>
        }
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
              <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Trader</th>
                <th className="px-4 py-3 font-medium">Balance USDT</th>
                <th className="px-4 py-3 font-medium">Commission</th>
                <th className="px-4 py-3 font-medium">Types</th>
                <th className="px-4 py-3 font-medium">Today Volume</th>
                <th className="px-4 py-3 font-medium">Success</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Presence</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {pageRows.map((t) => (
                <tr key={t.id} className="cursor-pointer text-gray-200 hover:bg-gray-800/40" onClick={() => setSelected(t)}>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">#{t.id}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-100">{t.name}</div>
                    <div className="text-xs text-gray-500">{t.email}</div>
                  </td>
                  <td className="px-4 py-3 font-medium text-emerald-400">{usdt(t.balanceUsdt)}</td>
                  <td className="px-4 py-3">{pct(t.commissionRate)}</td>
                  <td className="px-4 py-3"><DepositTypeBadges types={t.depositTypes} /></td>
                  <td className="px-4 py-3">{inr(t.todayVolumeInr)}</td>
                  <td className="px-4 py-3">{pct(t.successRate)}</td>
                  <td className="px-4 py-3"><Badge color={t.status === 'active' ? 'green' : 'red'}>{t.status}</Badge></td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => toggleOnline(t)}
                      title="Toggle online (demo)"
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                        t.online
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                          : 'border-gray-700 bg-gray-800 text-gray-400 hover:bg-gray-700'
                      }`}
                    >
                      <span className={`h-2 w-2 rounded-full ${t.online ? 'bg-emerald-500' : 'bg-gray-500'}`} />
                      {t.online ? 'Online' : 'Offline'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <RowMenu
                      trader={t}
                      onView={setSelected}
                      onEdit={setEditFor}
                      onBalance={setBalanceFor}
                      onCommission={setCommissionFor}
                      onSuspend={suspend}
                    />
                  </td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr><td colSpan={10} className="py-10 text-center text-sm text-gray-500">No traders match your filters</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-gray-800">
          <Pagination page={page} perPage={PER_PAGE} total={filtered.length} onPage={setPage} />
        </div>
      </Card>

      <TraderModal trader={selected} onClose={() => setSelected(null)} />
      <BalanceModal trader={balanceFor} onClose={() => setBalanceFor(null)} onSaved={refetch} />
      <EditTraderModal trader={editFor} onClose={() => setEditFor(null)} onSaved={refetch} />
      <EditCommissionModal trader={commissionFor} onClose={() => setCommissionFor(null)} onSaved={refetch} />

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
            <label className="mb-1.5 block text-sm text-gray-400">Full name</label>
            <Input value={draft.full_name} onChange={(e) => setDraft((d) => ({ ...d, full_name: e.target.value }))} placeholder="John Doe" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">Email</label>
            <Input value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} placeholder="trader@example.com" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">Password</label>
            <div className="flex gap-2">
              <Input value={draft.password} onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))} placeholder="Set or auto-generate" className="flex-1" />
              <Button variant="ghost" onClick={() => setDraft((d) => ({ ...d, password: genPassword() }))}>Auto-generate</Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm text-gray-400">Commission rate (%)</label>
              <Input type="number" step="0.01" value={draft.commission_rate} onChange={(e) => setDraft((d) => ({ ...d, commission_rate: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-gray-400">Payout commission (%)</label>
              <Input type="number" step="0.01" value={draft.payout_commission} onChange={(e) => setDraft((d) => ({ ...d, payout_commission: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-gray-400">Initial USDT balance</label>
              <Input type="number" step="0.01" value={draft.initial_balance_usdt} onChange={(e) => setDraft((d) => ({ ...d, initial_balance_usdt: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-gray-400">Daily limit (INR)</label>
              <Input type="number" value={draft.daily_limit} onChange={(e) => setDraft((d) => ({ ...d, daily_limit: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">Telegram ID (optional)</label>
            <Input value={draft.telegram_chat_id} onChange={(e) => setDraft((d) => ({ ...d, telegram_chat_id: e.target.value }))} placeholder="e.g. 123456789" />
          </div>
          <DepositTypesField value={draft.deposit_types} onChange={(v) => setDraft((d) => ({ ...d, deposit_types: v }))} />
        </div>
      </Modal>

      {/* Generated credentials (shown once after create). */}
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
            <label className="mb-1.5 block text-xs uppercase tracking-wide text-gray-500">Email</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-gray-950 px-3 py-2 font-mono text-xs text-gray-300">{created?.email || '—'}</code>
              <Button size="sm" variant="ghost" onClick={() => copy(created?.email, 'Email copied')}>Copy</Button>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-wide text-gray-500">Password</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-gray-950 px-3 py-2 font-mono text-xs text-gray-300">{created?.password || '—'}</code>
              <Button size="sm" variant="ghost" onClick={() => copy(created?.password, 'Password copied')}>Copy</Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
