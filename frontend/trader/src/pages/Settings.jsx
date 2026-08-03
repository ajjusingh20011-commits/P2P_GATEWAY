import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { UserRound, ShieldCheck, Wallet, Sun, ToggleLeft, ToggleRight } from 'lucide-react';
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
// Reference's compact .settingRow — a plain space-between line under a
// bottom border, no card-within-card chrome (used for Change password and
// Dark mode, which don't need the boxed treatment 2FA's richer state does).
const plainRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '13px 0',
  borderBottom: '1px solid var(--cardborder)',
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
// Real, working, backed by authApi's /auth/2fa/* routes — the only genuinely
// interactive section on this page. The reference collapses this to a single
// "Enabled" status row inside the Security card; a real trader still needs
// the actual setup/disable flow, so the full interactive state lives here,
// just restyled onto the reference's row/field language.
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
    <div style={plainRowStyle}>
      <div style={{ flex: 1 }}>
        <p style={{ color: 'var(--text)', fontSize: 13, fontWeight: 700, margin: 0 }}>Two-factor authentication</p>
        <p style={{ color: 'var(--muted)', fontSize: 11, margin: '3px 0 0' }}>
          {loading ? 'Checking status…' : enabled ? 'Authenticator app enabled' : 'Not enabled'}
        </p>

        {/* One-time backup codes shown right after enabling. */}
        {backupCodes && (
          <div className="mt-3 rounded-lg p-4" style={{ border: '1px solid rgba(34,197,94,.3)', background: 'rgba(34,197,94,.08)' }}>
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

        {/* Setup in progress: QR + secret + verify. */}
        {setup && (
          <div className="mt-3 space-y-4">
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
          <div className="mt-3 space-y-4">
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
      </div>

      {!loading && !enabled && !setup && !backupCodes && (
        <Button onClick={startSetup} disabled={busy}>
          {busy ? 'Please wait…' : 'Enable 2FA'}
        </Button>
      )}
      {!loading && enabled && (
        <Badge color="green">Enabled</Badge>
      )}
    </div>
  );
}

const TIMEZONES = [
  { value: 'gmt+0530', label: 'GMT+05:30 (India)' },
  { value: 'gmt+0000', label: 'GMT+00:00 (UTC)' },
  { value: 'gmt+0400', label: 'GMT+04:00 (Gulf)' },
];

const comingSoon = <Badge color="gray">Coming soon</Badge>;

export default function Settings() {
  const { user } = useAuth();
  const { theme, setTheme } = useOutletContext();
  const isLight = theme === 'light';
  const [timezone, setTimezone] = useState('gmt+0530');

  return (
    <div>
      <PageHeader eyebrow="ACCOUNT" title="Settings" info="Security, preferences and payout settlement configuration." />

      {/* 4-card grid: Profile, Security, Settlement wallet, Appearance. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Profile — email is real (from the authenticated session); no
            display-name field or profile-update endpoint exists on the
            backend at all, so that field and the save action stay disabled
            and clearly labeled rather than pretending to save anything. */}
        <Section title="Profile" description="Your trader identity" badge={comingSoon} icon={UserRound} accent="#8b5cf6">
          <div className="space-y-4">
            <div>
              <label style={labelStyle}>Display name</label>
              <input
                readOnly
                disabled
                placeholder="Not available yet"
                className="cursor-not-allowed"
                style={{ ...inputStyle, background: 'var(--hover)', color: 'var(--muted)' }}
              />
            </div>
            <div>
              <label style={labelStyle}>Email address</label>
              <input
                readOnly
                value={user?.email || 'trader@p2p.com'}
                className="cursor-not-allowed"
                style={{ ...inputStyle, background: 'var(--hover)', color: 'var(--muted)' }}
              />
            </div>
            <Button variant="ghost" disabled>Save profile</Button>
          </div>
        </Section>

        {/* Security — 2FA (real) + password change (no backend route) in one card. */}
        <Section title="Security" description="Protect account access" icon={ShieldCheck} accent="#22c55e">
          <TwoFactorSection />
          <div style={{ ...plainRowStyle, borderBottom: 'none', paddingBottom: 0 }}>
            <div>
              <p style={{ color: 'var(--text)', fontSize: 13, fontWeight: 700, margin: 0 }}>Change password</p>
              <p style={{ color: 'var(--muted)', fontSize: 11, margin: '3px 0 0' }}>No self-service reset yet — contact support</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" disabled>Update</Button>
              {comingSoon}
            </div>
          </div>
        </Section>

        {/* Settlement wallet — no per-trader deposit-address field exists on
            the backend yet, so this stays an honest "not configured" state
            rather than the reference's example (verified) TRC20 address. */}
        <Section title="Settlement wallet" description="USDT receiving address" badge={<Badge color="gray">Not configured</Badge>} icon={Wallet} accent="#f59e0b">
          <div style={rowStyle}>
            <IconWallet className="h-5 w-5 flex-shrink-0" style={{ color: 'var(--muted)' }} />
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
              No deposit wallet is configured for your account yet. Contact support to have one set up.
            </p>
          </div>
        </Section>

        {/* Appearance — dark mode is real (same state the header's toggle
            uses, shared via TraderLayout's Outlet context); timezone has no
            backend effect today. */}
        <Section title="Appearance" description="Choose a comfortable interface" icon={Sun} accent="#f59e0b">
          <div style={{ ...plainRowStyle, borderBottom: 'none' }}>
            <div>
              <p style={{ color: 'var(--text)', fontSize: 13, fontWeight: 700, margin: 0 }}>Dark mode</p>
              <p style={{ color: 'var(--muted)', fontSize: 11, margin: '3px 0 0' }}>Apply across the trader panel</p>
            </div>
            <button
              onClick={() => setTheme(isLight ? 'dark' : 'light')}
              aria-label="Toggle dark mode"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: isLight ? 'var(--subtle)' : 'var(--accent)', display: 'flex' }}
            >
              {isLight ? <ToggleLeft size={30} /> : <ToggleRight size={30} />}
            </button>
          </div>
          <div className="mt-1">
            <label style={labelStyle}>Timezone</label>
            <Select value={timezone} onChange={setTimezone} options={TIMEZONES} disabled />
          </div>
        </Section>
      </div>
    </div>
  );
}
