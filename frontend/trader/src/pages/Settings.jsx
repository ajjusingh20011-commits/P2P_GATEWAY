import { useEffect, useState } from 'react';
import { Card, Badge, Button, Select, PageHeader } from '../components/ui';
import { IconWallet } from '../components/icons';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../services/api';
import { toast } from '../components/Toaster';

function Section({ title, description, children }) {
  return (
    <Card className="p-5">
      <div className="mb-4">
        <h2 className="font-semibold text-white">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-gray-400">{description}</p>}
      </div>
      {children}
    </Card>
  );
}

// Two-Factor Authentication panel: enable (QR + verify + backup codes) / disable.
function TwoFactorSection() {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  // Enable flow.
  const [setup, setSetup] = useState(null); // { qr_code, secret }
  const [enableCode, setEnableCode] = useState('');
  const [backupCodes, setBackupCodes] = useState(null);

  // Disable flow.
  const [disableCode, setDisableCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');

  const loadStatus = async () => {
    setLoading(true);
    try {
      const res = await authApi.twoFAStatus();
      setEnabled(!!res.data?.data?.two_fa_enabled);
    } catch (_) {
      setEnabled(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const startSetup = async () => {
    setBusy(true);
    try {
      const res = await authApi.twoFASetup();
      setSetup(res.data.data);
      setEnableCode('');
      setBackupCodes(null);
    } catch (err) {
      toast(err.response?.data?.message || 'Could not start 2FA setup.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const verifySetup = async () => {
    setBusy(true);
    try {
      const res = await authApi.twoFAVerifySetup(enableCode.trim());
      setBackupCodes(res.data?.data?.backup_codes || []);
      setSetup(null);
      setEnableCode('');
      setEnabled(true);
      toast('Two-factor authentication enabled.', 'success');
    } catch (err) {
      toast(err.response?.data?.message || 'Invalid code. Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancelSetup = () => {
    setSetup(null);
    setEnableCode('');
  };

  const disable = async () => {
    setBusy(true);
    try {
      await authApi.twoFADisable(disableCode.trim(), disablePassword);
      setEnabled(false);
      setDisableCode('');
      setDisablePassword('');
      toast('Two-factor authentication disabled.', 'success');
    } catch (err) {
      toast(err.response?.data?.message || 'Could not disable 2FA.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const copyCodes = () => {
    if (!backupCodes) return;
    navigator.clipboard?.writeText(backupCodes.join('\n'));
    toast('Backup codes copied.', 'success');
  };

  const inputCls =
    'w-full rounded-lg border border-gray-700 bg-gray-800 px-3.5 py-2.5 text-sm text-gray-100 placeholder-gray-500 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500';

  return (
    <Section title="Two-Factor Authentication" description="Extra security for your account">
      <div className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-950 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-gray-100">
            2FA {loading ? '…' : enabled ? 'enabled' : 'disabled'}
          </p>
          <p className="text-xs text-gray-500">Authenticator app (TOTP)</p>
        </div>
        <Badge color={enabled ? 'green' : 'gray'}>{loading ? '…' : enabled ? 'ON' : 'OFF'}</Badge>
      </div>

      {/* One-time backup codes shown right after enabling. */}
      {backupCodes && (
        <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-emerald-300">Save your backup codes</p>
            <Button variant="ghost" onClick={copyCodes}>Copy</Button>
          </div>
          <p className="mb-3 text-xs text-gray-400">
            Store these somewhere safe. Each code can be used once if you lose your device.
          </p>
          <ul className="grid grid-cols-2 gap-2">
            {backupCodes.map((c) => (
              <li key={c} className="rounded-md border border-gray-800 bg-gray-950 px-3 py-1.5 text-center font-mono text-sm text-gray-200">
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Disabled state: offer to enable. */}
      {!loading && !enabled && !setup && !backupCodes && (
        <div className="mt-4">
          <Button onClick={startSetup} disabled={busy}>
            {busy ? 'Please wait…' : 'Enable 2FA'}
          </Button>
        </div>
      )}

      {/* Setup in progress: QR + secret + verify. */}
      {setup && (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-gray-300">
            Scan this QR code with your authenticator app, then enter the 6-digit code to confirm.
          </p>
          {setup.qr_code && (
            <img
              src={setup.qr_code}
              alt="2FA QR code"
              className="h-44 w-44 rounded-lg border border-gray-800 bg-white p-2"
            />
          )}
          {setup.secret && (
            <div>
              <label className="mb-1.5 block text-xs text-gray-400">Manual entry key</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 font-mono text-sm text-gray-300">
                  {setup.secret}
                </code>
                <Button variant="ghost" onClick={() => navigator.clipboard?.writeText(setup.secret)}>
                  Copy
                </Button>
              </div>
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">Verification code</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={enableCode}
              onChange={(e) => setEnableCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              className={inputCls}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={verifySetup} disabled={busy || enableCode.length < 6}>
              {busy ? 'Verifying…' : 'Verify & Enable'}
            </Button>
            <Button variant="ghost" onClick={cancelSetup} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Enabled state: offer to disable. */}
      {!loading && enabled && !backupCodes && (
        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">Authenticator code</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              placeholder="Enter your password"
              className={inputCls}
            />
          </div>
          <Button
            variant="danger"
            onClick={disable}
            disabled={busy || disableCode.length < 6 || !disablePassword}
          >
            {busy ? 'Disabling…' : 'Disable 2FA'}
          </Button>
        </div>
      )}
    </Section>
  );
}

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
];
const TIMEZONES = [
  { value: 'gmt+0530', label: 'GMT+05:30 (India)' },
  { value: 'gmt+0000', label: 'GMT+00:00 (UTC)' },
  { value: 'gmt+0400', label: 'GMT+04:00 (Gulf)' },
];

export default function Settings() {
  const { user } = useAuth();
  const [language, setLanguage] = useState('en');
  const [timezone, setTimezone] = useState('gmt+0530');
  const depositAddress = 'TXk9...demoTRC20walletAddress...8fQ2';

  return (
    <div>
      <PageHeader title="Settings" subtitle="Account preferences and security" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Deposit address */}
        <Section title="Deposit Address" description="Your USDT (TRC20) wallet">
          <div className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-950 px-4 py-3">
            <IconWallet className="h-5 w-5 text-emerald-400" />
            <span className="flex-1 truncate font-mono text-sm text-gray-300">{depositAddress}</span>
            <Badge color="green">TRC20</Badge>
            <Button variant="ghost" onClick={() => navigator.clipboard?.writeText(depositAddress)}>
              Copy
            </Button>
          </div>
        </Section>

        {/* Preferences */}
        <Section title="Preferences" description="Language and timezone">
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm text-gray-400">Language</label>
              <Select value={language} onChange={setLanguage} options={LANGUAGES} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-gray-400">Timezone</label>
              <Select value={timezone} onChange={setTimezone} options={TIMEZONES} />
            </div>
          </div>
        </Section>

        {/* Account */}
        <Section title="Account" description="Login and password">
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm text-gray-400">Email</label>
              <input
                readOnly
                value={user?.email || 'trader@p2p.com'}
                className="w-full cursor-not-allowed rounded-lg border border-gray-800 bg-gray-950 px-3.5 py-2.5 text-sm text-gray-400"
              />
            </div>
            <Button variant="ghost">Change password</Button>
          </div>
        </Section>

        {/* Security / 2FA */}
        <TwoFactorSection />

        {/* Telegram bots */}
        <Section title="Telegram Bots" description="Connect automation and alert bots">
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-950 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-100">PayIn Bot</p>
                <p className="text-xs text-gray-500">Automation confirmations</p>
              </div>
              <Button variant="ghost">Connect</Button>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-950 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-100">Notification Bot</p>
                <p className="text-xs text-gray-500">Real-time alerts</p>
              </div>
              <Button variant="ghost">Open link</Button>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
