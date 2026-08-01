import { useEffect, useMemo, useState } from 'react';
import { Card, Badge, Button, SearchInput, Select, Pagination, PageHeader, Modal, Field, Input, InlineLoader } from '../components/ui';
import AdminIdPopover from '../components/AdminIdPopover';
import ConfirmModal from '../components/ConfirmModal';
import { IconPlus, IconDots, IconKey, IconEye } from '../components/icons';
import { inr, usdt, pct, maskKey } from '../utils/mock';
import { adminApi } from '../services/api';
import { toast } from '../components/toast';

// Random strong password generator (used by the auto-generate button).
function genPassword(len = 16) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  const arr = new Uint32Array(len);
  (window.crypto || window.msCrypto).getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join('');
}

// Map a backend merchant record onto the table/modal shape. No total-volume
// or revenue-generated fields — the old page hardcoded both to 0 always
// (no backend aggregation exists), which is worse than not showing them.
function mapMerchant(m) {
  return {
    id: m.id,
    businessName: m.business_name || '—',
    email: m.user?.email || '',
    apiKey: m.api_key || '',
    apiSecret: m.api_secret || '••••••••',
    webhookUrl: m.webhook_url || '',
    balanceUsdt: Number(m.balance_usdt ?? m.balance) || 0,
    commissionRate: Number(m.commission_rate) || 0,
    payinFeePercent: Number(m.payin_fee_percent) || 0,
    payoutFeePercent: Number(m.payout_fee_percent) || 0,
    isActive: m.is_active !== false,
    status: m.is_active === false || m.user?.status === 'suspended' ? 'suspended' : 'active',
  };
}

async function fetchAllMerchants() {
  const first = await adminApi.listMerchants({ page: 1, limit: 100 });
  const rows = [...(first.merchants || [])];
  const total = first.pagination?.total ?? rows.length;
  const pages = Math.min(5, Math.ceil(total / 100));
  for (let p = 2; p <= pages; p++) {
    const res = await adminApi.listMerchants({ page: p, limit: 100 });
    rows.push(...(res.merchants || []));
  }
  return rows;
}

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

const PER_PAGE = 10;

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
];

function Secret({ label, value }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-[var(--hover)] px-2 py-1.5 font-mono text-xs text-[var(--muted)]">
          {show ? value : maskKey(value)}
        </code>
        <button onClick={() => setShow((v) => !v)} className="rounded p-1.5 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]" aria-label={show ? 'Hide' : 'Show'}>
          <IconEye className="h-4 w-4" />
        </button>
        <button onClick={() => navigator.clipboard?.writeText(value)} className="rounded px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]">
          Copy
        </button>
      </div>
    </div>
  );
}

// "Edit" and "Set commission" were dead menu items (fn: () => {}) with no
// backend behind them at all — dropped, same rule already applied to
// Traders' "Reset password". "Regenerate API key" is real-looking but has
// zero backend support (no key-rotation endpoint exists anywhere in
// adminController.js), so it's disabled rather than silently fabricating a
// new key client-side the way this menu used to.
function RowMenu({ merchant, onView, onSuspendRequest }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex justify-end">
      <button onClick={() => setOpen((v) => !v)} aria-label="Actions" className="rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]">
        <IconDots className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-20 w-52 rounded-lg border border-[var(--cardborder)] bg-[var(--card)] py-1 text-sm shadow-xl">
            <button onClick={() => { onView(merchant); setOpen(false); }} className="block w-full px-4 py-2 text-left text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]">
              View details
            </button>
            <button onClick={() => { onSuspendRequest(merchant, merchant.status === 'active'); setOpen(false); }} className="block w-full px-4 py-2 text-left text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]">
              {merchant.status === 'active' ? 'Deactivate' : 'Activate'}
            </button>
            <button disabled title="No key-rotation endpoint exists in the backend yet" className="flex w-full items-center justify-between px-4 py-2 text-left text-[var(--muted)] opacity-50 cursor-not-allowed">
              Regenerate API key <Badge color="gray">Preview</Badge>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function MerchantModal({ merchant, orders, ordersLoading, onClose, onSuspendRequest }) {
  if (!merchant) return null;
  const history = orders.filter((o) => o.merchant?.id === merchant.id).slice(0, 6);
  return (
    <Modal
      open={!!merchant}
      onClose={onClose}
      size="xl"
      title={merchant.businessName}
      subtitle={`Merchant #${merchant.id} · ${merchant.email}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="ghost" disabled title="No key-rotation endpoint exists in the backend yet">Regenerate key (Preview)</Button>
          {merchant.status === 'active'
            ? <Button variant="danger" onClick={() => onSuspendRequest(merchant, true)}>Deactivate merchant</Button>
            : <Button variant="success" onClick={() => onSuspendRequest(merchant, false)}>Activate merchant</Button>}
        </>
      }
    >
      <div className="space-y-6">
        <section>
          <h3 className="mb-3 text-sm font-semibold text-[var(--text)]">Business Information</h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Status"><Badge color={merchant.status === 'active' ? 'green' : 'red'}>{merchant.status}</Badge></Field>
            <Field label="Balance">{usdt(merchant.balanceUsdt)}</Field>
            <Field label="PayIn fee">{pct(merchant.payinFeePercent)}</Field>
            <Field label="Payout fee">{pct(merchant.payoutFeePercent)}</Field>
          </div>
        </section>

        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text)]"><IconKey className="h-4 w-4 text-[var(--muted)]" /> API Credentials</h3>
          <div className="space-y-3 rounded-lg border border-[var(--cardborder)] bg-[var(--hover)] p-4">
            <Secret label="API Key" value={merchant.apiKey} />
            <Secret label="API Secret" value={merchant.apiSecret} />
            <Field label="Webhook URL" mono>{merchant.webhookUrl || 'Not configured'}</Field>
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-[var(--text)]">Recent Transactions</h3>
          <div className="overflow-hidden rounded-lg border border-[var(--cardborder)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--hover)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <tr><th className="px-3 py-2">Order</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-[var(--cardborder)]">
                {ordersLoading && <tr><td colSpan={3} className="px-3 py-4 text-center text-[var(--muted)]">Loading…</td></tr>}
                {!ordersLoading && history.length === 0 && <tr><td colSpan={3} className="px-3 py-4 text-center text-[var(--muted)]">No recent transactions in the fetched window</td></tr>}
                {history.map((o) => (
                  <tr key={o.id} className="text-[var(--text)]">
                    <td className="px-3 py-2 font-mono text-xs text-[var(--muted)]">#{o.id}</td>
                    <td className="px-3 py-2">{inr(o.amount_inr)}</td>
                    <td className="px-3 py-2 text-[var(--muted)]">{o.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!ordersLoading && <p className="mt-1.5 text-xs text-[var(--muted)]">From the {orders.length.toLocaleString()} most recently fetched platform-wide orders, not this merchant's full history.</p>}
        </section>
      </div>
    </Modal>
  );
}

function EditFeesModal({ merchant, onClose, onSaved }) {
  const [payin, setPayin] = useState('');
  const [payout, setPayout] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (merchant) {
      setPayin(String(merchant.payinFeePercent ?? '5.00'));
      setPayout(String(merchant.payoutFeePercent ?? '2.00'));
    }
  }, [merchant?.id]);
  if (!merchant) return null;

  const submit = async () => {
    setSaving(true);
    try {
      await adminApi.updateMerchantFees(merchant.id, { payin_fee_percent: Number(payin) || 0, payout_fee_percent: Number(payout) || 0 });
      toast('Fees updated', 'success');
      onSaved();
      onClose();
    } catch (err) {
      toast(err.response?.data?.message || err.response?.data?.error?.message || 'Failed to update fees', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={!!merchant} onClose={onClose} size="md" title="Edit Fees" subtitle={merchant.businessName}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save fees'}</Button></>}>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1.5 block text-sm text-[var(--muted)]">PayIn Fee (%)</label>
          <Input type="number" step="0.01" min="0" value={payin} onChange={(e) => setPayin(e.target.value)} placeholder="5.00" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-[var(--muted)]">Payout Fee (%)</label>
          <Input type="number" step="0.01" min="0" value={payout} onChange={(e) => setPayout(e.target.value)} placeholder="2.00" />
        </div>
      </div>
    </Modal>
  );
}

export default function Merchants() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: 'all', q: '' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ businessName: '', email: '', password: '', payin_fee_percent: '5.00', payout_fee_percent: '2.00', webhook_url: '', daily_limit_inr: '1000000' });
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null);
  const [feesFor, setFeesFor] = useState(null);
  const [confirming, setConfirming] = useState(null); // { merchant, deactivate: bool }

  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await fetchAllMerchants();
      setList(rows.map(mapMerchant));
    } catch (e) {
      toast('Could not load merchants.', 'error');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    setOrdersLoading(true);
    fetchRecentOrders().then(setOrders).catch(() => setOrders([])).finally(() => setOrdersLoading(false));
  }, []);

  const set = (k) => (v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };

  const requestSuspend = (m, deactivate) => setConfirming({ merchant: m, deactivate });

  // Real: PUT /admin/merchants/:id, which already supports both is_active
  // and the linked user's status in one call — this merchant previously had
  // Activate/Deactivate as a local-only setList() toggle with no backend
  // call at all. Sets both so a deactivated merchant is blocked from both
  // accepting orders (is_active) and logging in (user.status), matching
  // suspendTrader's real behavior on the Traders page.
  const applySuspend = async () => {
    if (!confirming) return;
    const { merchant: m, deactivate } = confirming;
    const nextActive = !deactivate;
    setList((l) => l.map((x) => (x.id === m.id ? { ...x, isActive: nextActive, status: nextActive ? 'active' : 'suspended' } : x)));
    try {
      await adminApi.updateMerchant(m.id, { is_active: nextActive, status: nextActive ? 'active' : 'suspended' });
      toast(`${m.businessName} ${nextActive ? 'activated' : 'deactivated'}`, nextActive ? 'success' : 'info');
      load();
    } catch (err) {
      setList((l) => l.map((x) => (x.id === m.id ? { ...x, isActive: m.isActive, status: m.status } : x)));
      toast(err.response?.data?.message || 'Failed to update merchant status', 'error');
    } finally {
      setConfirming(null);
      setSelected(null);
    }
  };

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return list.filter((m) => {
      if (filters.status !== 'all' && m.status !== filters.status) return false;
      if (q && !m.businessName.toLowerCase().includes(q) && !m.email.toLowerCase().includes(q) && !String(m.id).includes(q)) return false;
      return true;
    });
  }, [list, filters]);

  const pageRows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const selectedLive = selected ? list.find((m) => m.id === selected.id) : null;

  const addMerchant = async () => {
    if (!draft.businessName.trim() || !draft.email.trim() || !draft.password.trim()) {
      toast('Business name, email and password are required', 'error');
      return;
    }
    setSaving(true);
    try {
      const data = await adminApi.createMerchantFull({
        email: draft.email.trim(),
        password: draft.password,
        business_name: draft.businessName.trim(),
        payin_fee_percent: Number(draft.payin_fee_percent) || 0,
        payout_fee_percent: Number(draft.payout_fee_percent) || 0,
        webhook_url: draft.webhook_url.trim() || undefined,
        daily_limit_inr: Number(draft.daily_limit_inr) || 0,
      });
      setCreated({ business_name: data?.merchant?.business_name || draft.businessName, api_key: data?.api_key, api_secret: data?.api_secret });
      toast('Merchant created', 'success');
      load();
    } catch (err) {
      toast(err.response?.data?.message || err.response?.data?.error?.message || 'Failed to create merchant', 'error');
    } finally {
      setSaving(false);
      setDraft({ businessName: '', email: '', password: '', payin_fee_percent: '5.00', payout_fee_percent: '2.00', webhook_url: '', daily_limit_inr: '1000000' });
      setShowAdd(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Merchants"
        subtitle={`${filtered.length} of ${list.length} merchants`}
        actions={<>{loading && <InlineLoader />}<Button onClick={() => setShowAdd(true)}><IconPlus className="h-4 w-4" /> Add Merchant</Button></>}
      />

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SearchInput value={filters.q} onChange={set('q')} placeholder="Search business, email, ID" className="sm:col-span-2" />
          <Select value={filters.status} onChange={set('status')} options={STATUS_OPTIONS} />
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--cardborder)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="w-10 px-4 py-3" />
                <th className="px-4 py-3 font-medium">Business</th>
                <th className="px-4 py-3 font-medium">API Key</th>
                <th className="px-4 py-3 font-medium">Balance USDT</th>
                <th className="px-4 py-3 font-medium">PayIn %</th>
                <th className="px-4 py-3 font-medium">Payout %</th>
                <th className="px-4 py-3 font-medium">Webhook</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--cardborder)]">
              {pageRows.map((m) => (
                <tr key={m.id} className="cursor-pointer text-[var(--text)] hover:bg-[var(--hover)]" onClick={() => setSelected(m)}>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <AdminIdPopover rows={[{ label: 'Merchant ID', value: m.id }, { label: 'Email', value: m.email }]} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-[var(--text)]">{m.businessName}</div>
                    <div className="text-xs text-[var(--muted)]">{m.email}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--muted)]">{maskKey(m.apiKey)}</td>
                  <td className="px-4 py-3 font-medium text-emerald-400">{usdt(m.balanceUsdt)}</td>
                  <td className="px-4 py-3">{pct(m.payinFeePercent)}</td>
                  <td className="px-4 py-3">{pct(m.payoutFeePercent)}</td>
                  <td className="px-4 py-3">{m.webhookUrl ? <Badge color="green">Set</Badge> : <Badge color="gray">Not set</Badge>}</td>
                  <td className="px-4 py-3"><Badge color={m.status === 'active' ? 'green' : 'red'}>{m.status}</Badge></td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setFeesFor(m)}>Edit Fees</Button>
                      <RowMenu merchant={m} onView={setSelected} onSuspendRequest={requestSuspend} />
                    </div>
                  </td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr><td colSpan={9} className="py-10 text-center text-sm text-[var(--muted)]">{loading ? 'Loading…' : 'No merchants match your filters'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-[var(--cardborder)]">
          <Pagination page={page} perPage={PER_PAGE} total={filtered.length} onPage={setPage} />
        </div>
      </Card>

      <MerchantModal merchant={selectedLive} orders={orders} ordersLoading={ordersLoading} onClose={() => setSelected(null)} onSuspendRequest={requestSuspend} />
      <EditFeesModal merchant={feesFor} onClose={() => setFeesFor(null)} onSaved={load} />

      <ConfirmModal
        open={!!confirming}
        title={confirming?.deactivate ? 'Deactivate this merchant?' : 'Activate this merchant?'}
        description={
          confirming
            ? confirming.deactivate
              ? `${confirming.merchant.businessName} will immediately stop accepting new pay-in and payout orders, and their login will be blocked. Reversible from this same screen.`
              : `${confirming.merchant.businessName} will resume accepting orders and be able to log in again.`
            : ''
        }
        tone={confirming?.deactivate ? 'danger' : 'primary'}
        confirmLabel={confirming?.deactivate ? 'Deactivate' : 'Activate'}
        onConfirm={applySuspend}
        onClose={() => setConfirming(null)}
      />

      <Modal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        size="md"
        title="Add New Merchant"
        subtitle="Onboard a merchant business"
        footer={<><Button variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={addMerchant} disabled={saving}>{saving ? 'Creating…' : 'Create merchant'}</Button></>}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm text-[var(--muted)]">Business name</label>
            <Input value={draft.businessName} onChange={(e) => setDraft((d) => ({ ...d, businessName: e.target.value }))} placeholder="e.g. Nova Retail" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-[var(--muted)]">Email</label>
            <Input value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} placeholder="payments@example.com" />
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
              <label className="mb-1.5 block text-sm text-[var(--muted)]">PayIn Fee (%)</label>
              <Input type="number" step="0.01" value={draft.payin_fee_percent} onChange={(e) => setDraft((d) => ({ ...d, payin_fee_percent: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-[var(--muted)]">Payout Fee (%)</label>
              <Input type="number" step="0.01" value={draft.payout_fee_percent} onChange={(e) => setDraft((d) => ({ ...d, payout_fee_percent: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-[var(--muted)]">Webhook URL (optional)</label>
            <Input value={draft.webhook_url} onChange={(e) => setDraft((d) => ({ ...d, webhook_url: e.target.value }))} placeholder="https://store.com/webhook" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-[var(--muted)]">Daily limit (INR)</label>
            <Input type="number" value={draft.daily_limit_inr} onChange={(e) => setDraft((d) => ({ ...d, daily_limit_inr: e.target.value }))} />
          </div>
        </div>
      </Modal>

      <Modal
        open={!!created}
        onClose={() => setCreated(null)}
        size="md"
        title="Merchant created"
        subtitle={created?.business_name ? `${created.business_name} · save these credentials now` : 'Save these credentials now'}
        footer={<Button onClick={() => setCreated(null)}>Done</Button>}
      >
        <div className="space-y-4">
          <p className="text-sm text-amber-400">The API secret is shown only once. Copy it before closing.</p>
          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted)]">API Key</label>
            <code className="block truncate rounded bg-[var(--hover)] px-3 py-2 font-mono text-xs text-[var(--muted)]">{created?.api_key || '—'}</code>
          </div>
          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted)]">API Secret</label>
            <code className="block truncate rounded bg-[var(--hover)] px-3 py-2 font-mono text-xs text-[var(--muted)]">{created?.api_secret || '—'}</code>
          </div>
        </div>
      </Modal>
    </div>
  );
}
