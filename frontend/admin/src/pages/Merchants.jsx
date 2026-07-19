import { useEffect, useMemo, useState } from 'react';
import { Card, Badge, Button, SearchInput, Select, Pagination, PageHeader, Modal, Field, Input, InlineLoader } from '../components/ui';
import { IconPlus, IconDots, IconKey, IconEye } from '../components/icons';
import { merchants as seedMerchants, orders, ACCOUNT_TYPES, inr, usdt, pct, maskKey } from '../utils/mock';
import { useApi } from '../hooks/useApi';
import { adminApi } from '../services/api';
import { toast } from '../components/toast';

// Random strong password generator (used by the auto-generate button).
function genPassword(len = 16) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  const arr = new Uint32Array(len);
  (window.crypto || window.msCrypto).getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join('');
}

// Map a backend merchant record onto the table/modal shape.
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
    totalVolumeInr: 0,
    revenueUsdt: 0,
    status: m.is_active === false || m.user?.status === 'suspended' ? 'suspended' : 'active',
    createdAt: '—',
  };
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
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-gray-950 px-2 py-1.5 font-mono text-xs text-gray-300">
          {show ? value : maskKey(value)}
        </code>
        <button onClick={() => setShow((v) => !v)} className="rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white" aria-label={show ? 'Hide' : 'Show'}>
          <IconEye className="h-4 w-4" />
        </button>
        <button onClick={() => navigator.clipboard?.writeText(value)} className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-white">
          Copy
        </button>
      </div>
    </div>
  );
}

function RowMenu({ merchant, onView, onToggleStatus, onRegen }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex justify-end">
      <button onClick={() => setOpen((v) => !v)} aria-label="Actions" className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-200">
        <IconDots className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-20 w-48 rounded-lg border border-gray-800 bg-gray-900 py-1 text-sm shadow-xl">
            {[
              { label: 'View details', fn: () => onView(merchant) },
              { label: 'Edit', fn: () => {} },
              { label: merchant.status === 'active' ? 'Deactivate' : 'Activate', fn: () => onToggleStatus(merchant.id) },
              { label: 'Regenerate API key', fn: () => onRegen(merchant.id) },
              { label: 'Set commission', fn: () => {} },
            ].map((a) => (
              <button key={a.label} onClick={() => { a.fn(); setOpen(false); }} className="block w-full px-4 py-2 text-left text-gray-300 hover:bg-gray-800 hover:text-white">
                {a.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MerchantModal({ merchant, onClose, onRegen }) {
  if (!merchant) return null;
  const history = orders.filter((o) => o.merchantId === merchant.id).slice(0, 6);
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
          <Button variant="ghost" onClick={() => onRegen(merchant.id)}>Regenerate key</Button>
          <Button>Set commission</Button>
        </>
      }
    >
      <div className="space-y-6">
        <section>
          <h3 className="mb-3 text-sm font-semibold text-white">Business Information</h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Status"><Badge color={merchant.status === 'active' ? 'green' : 'red'}>{merchant.status}</Badge></Field>
            <Field label="Balance">{usdt(merchant.balanceUsdt)}</Field>
            <Field label="Commission">{pct(merchant.commissionRate)}</Field>
            <Field label="Created">{merchant.createdAt}</Field>
            <Field label="Total volume">{inr(merchant.totalVolumeInr)}</Field>
            <Field label="Revenue generated" ><span className="text-emerald-400">{usdt(merchant.revenueUsdt)}</span></Field>
          </div>
        </section>

        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white"><IconKey className="h-4 w-4 text-gray-400" /> API Credentials</h3>
          <div className="space-y-3 rounded-lg border border-gray-800 bg-gray-950 p-4">
            <Secret label="API Key" value={merchant.apiKey} />
            <Secret label="API Secret" value={merchant.apiSecret} />
            <Field label="Webhook URL" mono>{merchant.webhookUrl}</Field>
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-white">Recent Transactions</h3>
          <div className="overflow-hidden rounded-lg border border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-950 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr><th className="px-3 py-2">Order</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Method</th><th className="px-3 py-2">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {history.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-500">No transactions</td></tr>}
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

// Edit ONLY the fee percentages (dedicated PUT /merchants/:id/fees).
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
      await adminApi.updateMerchantFees(merchant.id, {
        payin_fee_percent: Number(payin) || 0,
        payout_fee_percent: Number(payout) || 0,
      });
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
    <Modal
      open={!!merchant}
      onClose={onClose}
      size="md"
      title="Edit Fees"
      subtitle={merchant.businessName}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save fees'}</Button></>}
    >
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1.5 block text-sm text-gray-400">PayIn Fee (%)</label>
          <Input type="number" step="0.01" min="0" value={payin} onChange={(e) => setPayin(e.target.value)} placeholder="5.00" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-gray-400">Payout Fee (%)</label>
          <Input type="number" step="0.01" min="0" value={payout} onChange={(e) => setPayout(e.target.value)} placeholder="2.00" />
        </div>
      </div>
    </Modal>
  );
}

export default function Merchants() {
  const [list, setList] = useState(seedMerchants);
  const [filters, setFilters] = useState({ status: 'all', q: '' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ businessName: '', email: '', password: '', payin_fee_percent: '5.00', payout_fee_percent: '2.00', webhook_url: '', daily_limit_inr: '1000000' });
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null); // returned { api_key, api_secret }
  const [feesFor, setFeesFor] = useState(null);

  // Load merchants from the backend; mock seed is the fallback.
  const { data: apiData, loading, refetch } = useApi(() => adminApi.listMerchants(), { fallback: null });
  useEffect(() => {
    if (apiData?.merchants) setList(apiData.merchants.map(mapMerchant));
  }, [apiData]);

  const set = (k) => (v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };

  const toggleStatus = (id) =>
    setList((l) => l.map((m) => (m.id === id ? { ...m, status: m.status === 'active' ? 'suspended' : 'active' } : m)));

  const regen = (id) =>
    setList((l) => l.map((m) => (m.id === id ? { ...m, apiKey: `pk_live_${Math.abs(id * 7919 % 1e9).toString(36)}regenkey${id.toString(36)}` } : m)));

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

  const localAdd = () => {
    const id = (list.length ? Math.max(...list.map((m) => m.id)) : 5000) + 1;
    const apiKey = `pk_live_new${id.toString(36)}`;
    const apiSecret = `sk_live_new${id.toString(36)}`;
    setList((l) => [
      { id, businessName: draft.businessName, email: draft.email || `payments@${draft.businessName.toLowerCase().replace(/\s+/g, '')}.com`, apiKey, apiSecret, webhookUrl: '', balanceUsdt: 0, commissionRate: Number(draft.commissionRate) || 2.0, totalVolumeInr: 0, revenueUsdt: 0, status: 'active', createdAt: '2026-07-01' },
      ...l,
    ]);
    return { id, api_key: apiKey, api_secret: apiSecret };
  };

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
      // createMerchantFull returns { merchant, credentials, api_key, api_secret }.
      setCreated({ business_name: data?.merchant?.business_name || draft.businessName, api_key: data?.api_key, api_secret: data?.api_secret });
      toast('Merchant created', 'success');
      refetch();
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
        actions={
          <>
            {loading && <InlineLoader />}
            <Button onClick={() => setShowAdd(true)}><IconPlus className="h-4 w-4" /> Add Merchant</Button>
          </>
        }
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
              <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Business</th>
                <th className="px-4 py-3 font-medium">API Key</th>
                <th className="px-4 py-3 font-medium">Balance USDT</th>
                <th className="px-4 py-3 font-medium">PayIn %</th>
                <th className="px-4 py-3 font-medium">Payout %</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {pageRows.map((m) => (
                <tr key={m.id} className="cursor-pointer text-gray-200 hover:bg-gray-800/40" onClick={() => setSelected(m)}>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">#{m.id}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-100">{m.businessName}</div>
                    <div className="text-xs text-gray-500">{m.email}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{maskKey(m.apiKey)}</td>
                  <td className="px-4 py-3 font-medium text-emerald-400">{usdt(m.balanceUsdt)}</td>
                  <td className="px-4 py-3">{pct(m.payinFeePercent)}</td>
                  <td className="px-4 py-3">{pct(m.payoutFeePercent)}</td>
                  <td className="px-4 py-3"><Badge color={m.status === 'active' ? 'green' : 'red'}>{m.status}</Badge></td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setFeesFor(m)}>Edit Fees</Button>
                      <RowMenu merchant={m} onView={setSelected} onToggleStatus={toggleStatus} onRegen={regen} />
                    </div>
                  </td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr><td colSpan={8} className="py-10 text-center text-sm text-gray-500">No merchants match your filters</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-gray-800">
          <Pagination page={page} perPage={PER_PAGE} total={filtered.length} onPage={setPage} />
        </div>
      </Card>

      <MerchantModal merchant={selectedLive} onClose={() => setSelected(null)} onRegen={regen} />
      <EditFeesModal merchant={feesFor} onClose={() => setFeesFor(null)} onSaved={refetch} />

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
            <label className="mb-1.5 block text-sm text-gray-400">Business name</label>
            <Input value={draft.businessName} onChange={(e) => setDraft((d) => ({ ...d, businessName: e.target.value }))} placeholder="e.g. Nova Retail" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">Email</label>
            <Input value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} placeholder="payments@example.com" />
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
              <label className="mb-1.5 block text-sm text-gray-400">PayIn Fee (%)</label>
              <Input type="number" step="0.01" value={draft.payin_fee_percent} onChange={(e) => setDraft((d) => ({ ...d, payin_fee_percent: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-gray-400">Payout Fee (%)</label>
              <Input type="number" step="0.01" value={draft.payout_fee_percent} onChange={(e) => setDraft((d) => ({ ...d, payout_fee_percent: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">Webhook URL (optional)</label>
            <Input value={draft.webhook_url} onChange={(e) => setDraft((d) => ({ ...d, webhook_url: e.target.value }))} placeholder="https://store.com/webhook" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">Daily limit (INR)</label>
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
            <label className="mb-1.5 block text-xs uppercase tracking-wide text-gray-500">API Key</label>
            <code className="block truncate rounded bg-gray-950 px-3 py-2 font-mono text-xs text-gray-300">{created?.api_key || '—'}</code>
          </div>
          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-wide text-gray-500">API Secret</label>
            <code className="block truncate rounded bg-gray-950 px-3 py-2 font-mono text-xs text-gray-300">{created?.api_secret || '—'}</code>
          </div>
        </div>
      </Modal>
    </div>
  );
}
