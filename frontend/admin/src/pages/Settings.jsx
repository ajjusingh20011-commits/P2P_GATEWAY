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

export default function Settings() {
  const [fee, setFee] = useState('0.6');
  const [commission, setCommission] = useState('0.4');
  const [expiry, setExpiry] = useState('15');
  const [rateSource, setRateSource] = useState('binance');
  const [maintenance, setMaintenance] = useState(false);
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [telegram, setTelegram] = useState({ payin: '', notify: '' });
  const [saved, setSaved] = useState(false);

  const [ips, setIps] = useState(['203.0.113.7', '198.51.100.24']);
  const [newIp, setNewIp] = useState('');

  // Rate & revenue settings (real backend).
  const [rates, setRates] = useState({ base_exchange_rate: '100', admin_default_margin: '5', trader_default_margin: '4', platform_revenue_usdt: '0' });
  const [savingRates, setSavingRates] = useState(false);
  useEffect(() => {
    adminApi.getSettings()
      .then((data) => {
        const s = data?.settings || {};
        setRates((r) => ({
          base_exchange_rate: s.base_exchange_rate ?? r.base_exchange_rate,
          admin_default_margin: s.admin_default_margin ?? r.admin_default_margin,
          trader_default_margin: s.trader_default_margin ?? r.trader_default_margin,
          platform_revenue_usdt: s.platform_revenue_usdt ?? r.platform_revenue_usdt,
        }));
      })
      .catch(() => {});
  }, []);

  const saveRates = async () => {
    setSavingRates(true);
    try {
      await adminApi.updateSettings({
        base_exchange_rate: rates.base_exchange_rate,
        admin_default_margin: rates.admin_default_margin,
        trader_default_margin: rates.trader_default_margin,
      });
      toast('Rate settings saved', 'success');
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to save rate settings', 'error');
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

  const save = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Platform configuration and security"
        actions={
          <div className="flex items-center gap-3">
            {saved && <span className="text-xs text-emerald-400">✓ Saved</span>}
            <Button onClick={save}>Save changes</Button>
          </div>
        }
      />

      {maintenance && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <IconShield className="h-5 w-5 flex-shrink-0" />
          Maintenance mode is ON — the public gateway is currently rejecting new orders.
        </div>
      )}

      {/* Rate & revenue (real backend) */}
      <Card className="mb-6 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">Rate &amp; Revenue</h3>
            <p className="text-xs text-gray-500">Base exchange rate, default margins, and accumulated platform revenue</p>
          </div>
          <Button onClick={saveRates} disabled={savingRates}>{savingRates ? 'Saving…' : 'Save rates'}</Button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">Base exchange rate (INR/USDT)</label>
            <Input type="number" step="0.01" value={rates.base_exchange_rate} onChange={(e) => setRates((r) => ({ ...r, base_exchange_rate: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">Admin default margin (%)</label>
            <Input type="number" step="0.01" value={rates.admin_default_margin} onChange={(e) => setRates((r) => ({ ...r, admin_default_margin: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">Trader default margin (%)</label>
            <Input type="number" step="0.01" value={rates.trader_default_margin} onChange={(e) => setRates((r) => ({ ...r, trader_default_margin: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">Platform revenue (USDT)</label>
            <div className="flex h-[42px] items-center rounded-lg border border-gray-800 bg-gray-950 px-3 font-semibold text-amber-400">
              {Number(rates.platform_revenue_usdt || 0).toFixed(8)}
            </div>
            <p className="mt-1 text-[11px] text-gray-600">Read-only · accumulates on each confirmed order</p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Fees & commissions */}
        <Section title="Fees & Commissions" description="Platform economics">
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm text-gray-400">Platform fee (%)</label>
              <Input type="number" step="0.1" value={fee} onChange={(e) => setFee(e.target.value)} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-gray-400">Default trader commission (%)</label>
              <Input type="number" step="0.1" value={commission} onChange={(e) => setCommission(e.target.value)} />
            </div>
          </div>
        </Section>

        {/* Orders & rates */}
        <Section title="Orders & Exchange Rate" description="Order lifecycle and pricing source">
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm text-gray-400">Order expiry time (minutes)</label>
              <Input type="number" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-gray-400">Exchange rate source</label>
              <Select value={rateSource} onChange={setRateSource} options={RATE_SOURCES} />
            </div>
          </div>
        </Section>

        {/* Telegram bots */}
        <Section title="Telegram Bots" description="Automation & alert bot tokens">
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm text-gray-400">PayIn Bot token</label>
              <Input value={telegram.payin} onChange={(e) => setTelegram((t) => ({ ...t, payin: e.target.value }))} placeholder="123456:ABC-DEF…" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-gray-400">Notification Bot token</label>
              <Input value={telegram.notify} onChange={(e) => setTelegram((t) => ({ ...t, notify: e.target.value }))} placeholder="123456:ABC-DEF…" />
            </div>
          </div>
        </Section>

        {/* Notifications & maintenance */}
        <Section title="Notifications & Mode" description="Alerts and platform availability">
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-950 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-100">Email notifications</p>
                <p className="text-xs text-gray-500">Send admin alert emails</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge color={emailAlerts ? 'green' : 'gray'}>{emailAlerts ? 'ON' : 'OFF'}</Badge>
                <Toggle checked={emailAlerts} onChange={setEmailAlerts} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-950 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-100">Maintenance mode</p>
                <p className="text-xs text-gray-500">Reject new orders platform-wide</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge color={maintenance ? 'red' : 'gray'}>{maintenance ? 'ON' : 'OFF'}</Badge>
                <Toggle checked={maintenance} onChange={setMaintenance} />
              </div>
            </div>
          </div>
        </Section>

        {/* IP whitelist */}
        <Section title="IP Whitelist" description="Restrict admin console access" className="lg:col-span-2">
          <div className="flex gap-2">
            <Input value={newIp} onChange={(e) => setNewIp(e.target.value)} placeholder="Add IP address, e.g. 203.0.113.7" onKeyDown={(e) => e.key === 'Enter' && addIp()} className="flex-1" />
            <Button onClick={addIp}><IconPlus className="h-4 w-4" /> Add</Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {ips.length === 0 && <p className="text-sm text-gray-500">No IPs whitelisted — access is open.</p>}
            {ips.map((ip) => (
              <span key={ip} className="inline-flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-950 px-3 py-1.5 font-mono text-sm text-gray-200">
                {ip}
                <button onClick={() => removeIp(ip)} className="text-gray-500 hover:text-red-400" aria-label={`Remove ${ip}`}>
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
