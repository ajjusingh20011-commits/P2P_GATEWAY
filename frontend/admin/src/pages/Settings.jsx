import { useEffect, useState } from 'react';
import { Card, Badge, Button, Select, Toggle, Input, Section, PageHeader } from '../components/ui';
import { IconPlus, IconX, IconShield } from '../components/icons';
import { adminApi } from '../services/api';
import { toast } from '../components/toast';

const RATE_SOURCES = [
  { value: 'binance', label: 'Binance P2P' },
  { value: 'wazirx', label: 'WazirX' },
  { value: 'manual', label: 'Manual override' },
];

// Settings actually persisted by PUT /admin/settings (see adminController.js's
// `allowed` whitelist): base_exchange_rate, exchange_rate_mode,
// admin_default_margin, trader_default_margin, payout_expiry_minutes,
// order_expiry_minutes, platform_name, min/max_order_amount. Everything else
// on this page (Telegram bot tokens, email-alert toggle, maintenance mode,
// IP whitelist) has no backend support at all — those sections are clearly
// marked Preview below rather than saved by a page-wide button that used to
// claim success for all of it, including a "Maintenance mode is ON" banner
// that would have misled an admin into believing the platform's real
// behavior had changed when nothing was persisted.
//
// Fee-model correction: despite its name, `admin_default_margin` is NOT a
// separate "admin's cut" alongside trader_margin — that per-trader concept
// (trader.model.js's `admin_margin` column) is genuinely dead, never read by
// any settlement code. `admin_default_margin` is really the platform-wide
// FALLBACK for a merchant's own `payin_fee_percent` (rateService.js:108),
// used only when a specific merchant hasn't set their own fee — the live
// mirror of `trader_default_margin` being the fallback for `trader_margin`
// (rateService.js:107). Labeled below as "Default merchant pay-in fee" to
// reflect what it actually does rather than the misleading legacy name.
export default function Settings() {
  const [telegram, setTelegram] = useState({ payin: '', notify: '' });
  const [maintenance, setMaintenance] = useState(false);
  const [emailAlerts, setEmailAlerts] = useState(true);

  const [ips, setIps] = useState(['203.0.113.7', '198.51.100.24']);
  const [newIp, setNewIp] = useState('');

  // Rate, revenue & order settings — all real, all backed by PUT /admin/settings.
  const [rates, setRates] = useState({
    platform_name: 'MaxPay',
    base_exchange_rate: '100',
    exchange_rate_mode: 'binance',
    admin_default_margin: '5',
    trader_default_margin: '4',
    payout_expiry_minutes: '15',
    order_expiry_minutes: '15',
    min_order_amount: '100',
    max_order_amount: '100000',
    platform_revenue_usdt: '0',
  });
  const [savingRates, setSavingRates] = useState(false);
  useEffect(() => {
    adminApi.getSettings()
      .then((data) => {
        const s = data?.settings || {};
        setRates((r) => ({
          platform_name: s.platform_name ?? r.platform_name,
          base_exchange_rate: s.base_exchange_rate ?? r.base_exchange_rate,
          exchange_rate_mode: s.exchange_rate_mode ?? r.exchange_rate_mode,
          admin_default_margin: s.admin_default_margin ?? r.admin_default_margin,
          trader_default_margin: s.trader_default_margin ?? r.trader_default_margin,
          payout_expiry_minutes: s.payout_expiry_minutes ?? r.payout_expiry_minutes,
          order_expiry_minutes: s.order_expiry_minutes ?? r.order_expiry_minutes,
          min_order_amount: s.min_order_amount ?? r.min_order_amount,
          max_order_amount: s.max_order_amount ?? r.max_order_amount,
          platform_revenue_usdt: s.platform_revenue_usdt ?? r.platform_revenue_usdt,
        }));
      })
      .catch(() => {});
  }, []);

  const saveRates = async () => {
    setSavingRates(true);
    try {
      await adminApi.updateSettings({
        platform_name: rates.platform_name,
        base_exchange_rate: rates.base_exchange_rate,
        exchange_rate_mode: rates.exchange_rate_mode,
        admin_default_margin: rates.admin_default_margin,
        trader_default_margin: rates.trader_default_margin,
        payout_expiry_minutes: rates.payout_expiry_minutes,
        order_expiry_minutes: rates.order_expiry_minutes,
        min_order_amount: rates.min_order_amount,
        max_order_amount: rates.max_order_amount,
      });
      toast('Rate & order settings saved', 'success');
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to save settings', 'error');
    } finally {
      setSavingRates(false);
    }
  };

  const addIp = () => {
    const v = newIp.trim();
    if (v && !ips.includes(v)) setIps((l) => [...l, v]);
    setNewIp('');
  };
  const removeIp = (ip) => setIps((l) => l.filter((x) => x !== ip));

  return (
    <div>
      <PageHeader title="Settings" subtitle="Platform configuration and security" />

      {/* Rate, revenue & order settings (real backend) */}
      <Card className="mb-6 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text)]">Rate, Revenue &amp; Orders</h3>
            <p className="text-xs text-[var(--muted)]">Exchange rate, default margins, order/payout timers, and accumulated platform revenue</p>
          </div>
          <Button onClick={saveRates} disabled={savingRates}>{savingRates ? 'Saving…' : 'Save changes'}</Button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-sm text-[var(--muted)]">Platform name</label>
            <Input value={rates.platform_name} onChange={(e) => setRates((r) => ({ ...r, platform_name: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-[var(--muted)]">Base exchange rate (INR/USDT)</label>
            <Input type="number" step="0.01" value={rates.base_exchange_rate} onChange={(e) => setRates((r) => ({ ...r, base_exchange_rate: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-[var(--muted)]">Exchange rate source</label>
            <Select value={rates.exchange_rate_mode} onChange={(v) => setRates((r) => ({ ...r, exchange_rate_mode: v }))} options={RATE_SOURCES} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-[var(--muted)]">Default merchant pay-in fee (%)</label>
            <Input type="number" step="0.01" value={rates.admin_default_margin} onChange={(e) => setRates((r) => ({ ...r, admin_default_margin: e.target.value }))} />
            <p className="mt-1 text-[11px] text-[var(--muted)]">Fallback for merchant.payin_fee_percent when a merchant has no fee of their own set (Merchants → Edit Fees overrides this per merchant).</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-[var(--muted)]">Default trader margin (%)</label>
            <Input type="number" step="0.01" value={rates.trader_default_margin} onChange={(e) => setRates((r) => ({ ...r, trader_default_margin: e.target.value }))} />
            <p className="mt-1 text-[11px] text-[var(--muted)]">Fallback for trader.trader_margin when a trader has no margin of their own set (Traders → Edit Commercial overrides this per trader).</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-[var(--muted)]">Order expiry time (minutes)</label>
            <Input type="number" min="1" value={rates.order_expiry_minutes} onChange={(e) => setRates((r) => ({ ...r, order_expiry_minutes: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-[var(--muted)]">Payout accept timer (minutes)</label>
            <Input type="number" step="1" min="1" value={rates.payout_expiry_minutes} onChange={(e) => setRates((r) => ({ ...r, payout_expiry_minutes: e.target.value }))} />
            <p className="mt-1 text-[11px] text-[var(--muted)]">Time a trader has to transfer after accepting a payout</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-[var(--muted)]">Minimum order amount (₹)</label>
            <Input type="number" min="0" value={rates.min_order_amount} onChange={(e) => setRates((r) => ({ ...r, min_order_amount: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-[var(--muted)]">Maximum order amount (₹)</label>
            <Input type="number" min="0" value={rates.max_order_amount} onChange={(e) => setRates((r) => ({ ...r, max_order_amount: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-[var(--muted)]">Platform revenue (USDT)</label>
            <div className="flex h-[42px] items-center rounded-lg border border-[var(--cardborder)] bg-[var(--hover)] px-3 font-semibold text-amber-400">
              {Number(rates.platform_revenue_usdt || 0).toFixed(8)}
            </div>
            <p className="mt-1 text-[11px] text-[var(--muted)]">Read-only · accumulates on each settled order and payout</p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Telegram bots — preview */}
        <Section title="Telegram Bots" description="Automation & alert bot tokens">
          <div className="mb-3"><Badge color="gray">Preview — not saved</Badge></div>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm text-[var(--muted)]">PayIn Bot token</label>
              <Input value={telegram.payin} onChange={(e) => setTelegram((t) => ({ ...t, payin: e.target.value }))} placeholder="123456:ABC-DEF…" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-[var(--muted)]">Notification Bot token</label>
              <Input value={telegram.notify} onChange={(e) => setTelegram((t) => ({ ...t, notify: e.target.value }))} placeholder="123456:ABC-DEF…" />
            </div>
          </div>
        </Section>

        {/* Notifications & maintenance — preview */}
        <Section title="Notifications & Mode" description="Alerts and platform availability">
          <div className="mb-3"><Badge color="gray">Preview — toggles below have no effect yet</Badge></div>
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-[var(--cardborder)] bg-[var(--hover)] px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[var(--text)]">Email notifications</p>
                <p className="text-xs text-[var(--muted)]">Send admin alert emails</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge color={emailAlerts ? 'green' : 'gray'}>{emailAlerts ? 'ON' : 'OFF'}</Badge>
                <Toggle checked={emailAlerts} onChange={setEmailAlerts} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-[var(--cardborder)] bg-[var(--hover)] px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[var(--text)]">Maintenance mode</p>
                <p className="text-xs text-[var(--muted)]">Reject new orders platform-wide</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge color={maintenance ? 'red' : 'gray'}>{maintenance ? 'ON' : 'OFF'}</Badge>
                <Toggle checked={maintenance} onChange={setMaintenance} />
              </div>
            </div>
            {maintenance && (
              <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                <IconShield className="h-5 w-5 flex-shrink-0" />
                Preview only — this toggle isn't wired to the live gateway. The public checkout is NOT actually rejecting orders.
              </div>
            )}
          </div>
        </Section>

        {/* IP whitelist — preview */}
        <Section title="IP Whitelist" description="Restrict admin console access" className="lg:col-span-2">
          <div className="mb-3"><Badge color="gray">Preview — not enforced yet</Badge></div>
          <div className="flex gap-2">
            <Input value={newIp} onChange={(e) => setNewIp(e.target.value)} placeholder="Add IP address, e.g. 203.0.113.7" onKeyDown={(e) => e.key === 'Enter' && addIp()} className="flex-1" />
            <Button onClick={addIp}><IconPlus className="h-4 w-4" /> Add</Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {ips.length === 0 && <p className="text-sm text-[var(--muted)]">No IPs whitelisted — access is open.</p>}
            {ips.map((ip) => (
              <span key={ip} className="inline-flex items-center gap-2 rounded-lg border border-[var(--cardborder)] bg-[var(--hover)] px-3 py-1.5 font-mono text-sm text-[var(--text)]">
                {ip}
                <button onClick={() => removeIp(ip)} className="text-[var(--muted)] hover:text-red-400" aria-label={`Remove ${ip}`}>
                  <IconX className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
