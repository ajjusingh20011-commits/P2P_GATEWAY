import { useEffect, useState } from 'react';
import { UserRound, ShieldCheck, Wallet, Globe2, Send } from 'lucide-react';
import { Card, Badge, Button, Select, PageHeader } from '../components/ui';
import { IconWallet } from '../components/icons';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../services/api';
import { toast } from '../components/Toaster';

function hexA(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const labelStyle = { display: 'block', color: 'var(--muted)', fontSize: 13, marginBottom: 6 };
const inputStyle = {
  width: '100%',
  borderRadius: 10,
  border: '1px solid var(--input-border)',
  background: 'var(--input-bg)',
  padding: '10px 14px',
  fontSize: 13,
  color: 'var(--text)',
  outline: 'none',
};
const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  borderRadius: 10,
  border: '1px solid var(--cardborder)',
  background: 'var(--hover)',
  padding: '12px 16px',
};

function Section({ title, description, badge, icon: Icon, accent = '#4f46e5', children }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          {Icon && (
            <span
              style={{
                width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center',
                justifyContent: 'center', flexShrink: 0, background: hexA(accent, 0.14), color: accent,
              }}
            >
              <Icon size={17} />
            </span>
          )}
          <div>
            <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 15, margin: 0 }}>{title}</h2>
            {description && <p style={{ color: 'var(--muted)', fontSize: 13, margin: '3px 0 0' }}>{description}</p>}
          </div>
        </div>
        {badge}
      </div>
      {children}
    </Card>
  );
}

// Two-Factor Authentication panel: enable (QR + verify + backup codes) / disable.
// Real, working, backed by authApi's /auth/2fa/* routes — the only section on
// this page that isn't a "coming soon" placeholder.
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

  return (
    <Section title="Two-Factor Authentication" description="Extra security for your account" icon={ShieldCheck} accent="#22c55e">
      <div style={rowStyle}>
        <div>
          <p style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600, margin: 0 }}>
            2FA {loading ? '…' : enabled ? 'enabled' : 'disabled'}
          </p>
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '3px 0 0' }}>Authenticator app (TOTP)</p>
        </div>
        <Badge color={enabled ? 'green' : 'gray'}>{loading ? '…' : enabled ? 'ON' : 'OFF'}</Badge>
      </div>

      {/* One-time backup codes shown right after enabling. */}
      {backupCodes && (
        <div className="mt-4 rounded-lg p-4" style={{ border: '1px solid rgba(34,197,94,.3)', background: 'rgba(34,197,94,.08)' }}>
          <div className="mb-2 flex items-center justify-between">
            <p style={{ color: '#22c55e', fontSize: 13, fontWeight: 600, margin: 0 }}>Save your backup codes</p>
            <Button variant="ghost" onClick={copyCodes}>Copy</Button>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 12px' }}>
            Store these somewhere safe. Each code can be used once if you lose your device.
          </p>
          <ul className="grid grid-cols-2 gap-2">
            {backupCodes.map((c) => (
              <li
                key={c}
                className="rounded-md px-3 py-1.5 text-center font-mono text-sm"
                style={{ border: '1px solid var(--cardborder)', background: 'var(--hover)', color: 'var(--text)' }}
              >
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
          <p style={{ color: 'var(--text)', fontSize: 13, margin: 0 }}>
            Scan this QR code with your authenticator app, then enter the 6-digit code to confirm.
          </p>
          {setup.qr_code && (
            <img
              src={setup.qr_code}
              alt="2FA QR code"
              className="h-44 w-44 rounded-lg bg-white p-2"
              style={{ border: '1px solid var(--cardborder)' }}
            />
          )}
          {setup.secret && (
            <div>
              <label style={labelStyle}>Manual entry key</label>
              <div className="flex items-center gap-2">
                <code
                  className="flex-1 truncate rounded-lg px-3 py-2 font-mono text-sm"
                  style={{ border: '1px solid var(--cardborder)', background: 'var(--hover)', color: 'var(--text)' }}
                >
                  {setup.secret}
                </code>
                <Button variant="ghost" onClick={() => navigator.clipboard?.writeText(setup.secret)}>
                  Copy
                </Button>
              </div>
            </div>
          )}
          <div>
            <label style={labelStyle}>Verification code</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={enableCode}
              onChange={(e) => setEnableCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              style={inputStyle}
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
            <label style={labelStyle}>Authenticator code</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              autoComplete="current-password"
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              placeholder="Enter your password"
              style={inputStyle}
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

const comingSoon = <Badge color="gray">Coming soon</Badge>;

export default function Settings() {
  const { user } = useAuth();
  const [language, setLanguage] = useState('en');
  const [timezone, setTimezone] = useState('gmt+0530');

  return (
    <div>
      <PageHeader title="Settings" subtitle="Account preferences and security" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Deposit address — no per-trader wallet endpoint exists yet. */}
        <Section title="Deposit Address" description="Your USDT (TRC20) wallet" badge={<Badge color="gray">Not configured</Badge>} icon={Wallet} accent="#f59e0b">
          <div style={rowStyle}>
            <IconWallet className="h-5 w-5 flex-shrink-0" style={{ color: 'var(--muted)' }} />
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
              No deposit wallet is configured for your account yet. Contact support to have one set up.
            </p>
          </div>
        </Section>

        {/* Preferences — neither field has a backend effect today. */}
        <Section title="Preferences" description="Language and timezone" badge={comingSoon} icon={Globe2} accent="#3b82f6">
          <div className="space-y-4">
            <div>
              <label style={labelStyle}>Language</label>
              <Select value={language} onChange={setLanguage} options={LANGUAGES} disabled />
            </div>
            <div>
              <label style={labelStyle}>Timezone</label>
              <Select value={timezone} onChange={setTimezone} options={TIMEZONES} disabled />
            </div>
          </div>
        </Section>

        {/* Account — email display is real (from the authenticated session);
            password change has no backend route, so only that part is marked. */}
        <Section title="Account" description="Login and password" icon={UserRound} accent="#8b5cf6">
          <div className="space-y-4">
            <div>
              <label style={labelStyle}>Email</label>
              <input
                readOnly
                value={user?.email || 'trader@p2p.com'}
                className="cursor-not-allowed"
                style={{ ...inputStyle, background: 'var(--hover)', color: 'var(--muted)' }}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" disabled>Change password</Button>
              {comingSoon}
            </div>
          </div>
        </Section>

        {/* Security / 2FA — the one real, working section on this page. */}
        <TwoFactorSection />

        {/* Telegram bots — no connect endpoint exists; telegram_chat_id is an
            admin-set field the outbound alert service reads, not something a
            trader can self-link today. */}
        <Section title="Telegram Bots" description="Connect automation and alert bots" badge={comingSoon} icon={Send} accent="#14b8c4">
          <div className="space-y-3">
            <div style={rowStyle}>
              <div>
                <p style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600, margin: 0 }}>PayIn Bot</p>
                <p style={{ color: 'var(--muted)', fontSize: 11, margin: '3px 0 0' }}>Automation confirmations</p>
              </div>
              <Button variant="ghost" disabled>Connect</Button>
            </div>
            <div style={rowStyle}>
              <div>
                <p style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600, margin: 0 }}>Notification Bot</p>
                <p style={{ color: 'var(--muted)', fontSize: 11, margin: '3px 0 0' }}>Real-time alerts</p>
              </div>
              <Button variant="ghost" disabled>Open link</Button>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
