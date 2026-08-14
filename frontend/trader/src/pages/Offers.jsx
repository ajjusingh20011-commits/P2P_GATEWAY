import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layers3, Wifi, BadgeCheck, Check, CheckCircle2, KeyRound, ExternalLink } from 'lucide-react';
import { Card, Badge, Button, Toggle, SearchInput, Select, PageHeader, Modal, BankBadge, LivenessBadge } from '../components/ui';
import { LivePoolSection } from '../components/DashboardSections';
import {
  IconPlus, IconEdit, IconTrash, IconChevron, IconRobot, IconWarning, IconDots, IconLock, IconGlobe, IconPhone,
} from '../components/icons';
import { ACCOUNT_TYPES } from '../utils/mock';
import { ACCOUNT_STATE, STATE_META, accountState, isLive } from '../utils/accountState';
import { traderApi } from '../services/api';
import { toast } from '../components/Toaster';
import DevicePicker, { useDevices, deviceLabel } from '../components/DevicePicker';
import ConfirmModal from '../components/ConfirmModal';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  saveWebAccount, getAccounts, toggleAccount, updateAccount, connectAccount, verifyOTP, deleteAccount,
  getDevices, getAccountStatus, getNgoSocketToken, NGO_SOCKET_ORIGIN,
} from '../lib/ngoApi';

// A device counts as "live" for the readiness gate only within this window —
// same ~4s heartbeat interval + slack used by the Smartphones page's online
// dot (ngo-backend/src/routes/apk.js).
const DEVICE_ONLINE_WINDOW_MS = 15 * 1000;
// Same polling cadence as the Smartphones page's own online dot.
const LIVE_ICON_POLL_MS = 15 * 1000;

// ---------------------------------------------------------------------------
// Bank catalog for the "Select Bank" step. Each maps to a valid account_type.
// Only gpay | phonepe | paytm | bharat_pe | airtel are accepted by the API;
// every non-wallet bank defaults to `gpay`.
// ---------------------------------------------------------------------------
const BANKS = [
  { name: 'GPay Business', type: 'gpay', color: 'sky' },
  { name: 'PhonePe Business', type: 'phonepe', color: 'violet' },
  { name: 'Paytm Business', type: 'paytm', color: 'sky' },
  { name: 'Airtel Payments Bank', type: 'airtel', color: 'red' },
  { name: 'BharatPe Business', type: 'bharat_pe', color: 'amber' },
  { name: 'AU Bank', type: 'gpay', color: 'amber' },
  { name: 'Axis Bank', type: 'gpay', color: 'red' },
  { name: 'Bandhan Bank', type: 'gpay', color: 'red' },
  { name: 'Bank of Baroda', type: 'gpay', color: 'amber' },
  { name: 'Bank of India', type: 'gpay', color: 'sky' },
  { name: 'Canara Bank', type: 'gpay', color: 'amber' },
  { name: 'HDFC Bank', type: 'gpay', color: 'sky' },
  { name: 'ICICI Bank', type: 'gpay', color: 'amber' },
  { name: 'IDFC First Bank', type: 'gpay', color: 'violet' },
  { name: 'IndusInd Bank', type: 'gpay', color: 'red' },
  { name: 'Kotak Mahindra Bank', type: 'gpay', color: 'red' },
  { name: 'PNB', type: 'gpay', color: 'violet' },
  { name: 'SBI', type: 'gpay', color: 'sky' },
  { name: 'Yes Bank', type: 'gpay', color: 'sky' },
];

// Empty string → undefined so Joi defaults apply; a value → Number.
const num = (v) => (v === '' || v == null ? undefined : Number(v));

// Pull the exact backend error message out of an axios error.
const apiError = (e) =>
  e?.response?.data?.message ||
  e?.response?.data?.error ||
  e?.message ||
  'Request failed';

// UPI is valid for step-2 purposes once it contains an "@".
const upiHasAt = (v = '') => v.includes('@') && v.trim().length > 0;

// ---------------------------------------------------------------------------
// Modal shell — the shared ui.jsx Modal now renders every dialog on this page
// (Add/Edit). This is a pure wrapper swap: no OTP/liveness/save logic lives
// in this component, so migrating it touches no state machine.
// ---------------------------------------------------------------------------
function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>{label}</span>
      {children}
      {hint}
    </label>
  );
}

const inputStyle = {
  width: '100%',
  borderRadius: 8,
  border: '1px solid var(--input-border)',
  background: 'var(--input-bg)',
  padding: '8px 12px',
  fontSize: 14,
  color: 'var(--text)',
  outline: 'none',
};
const inputStyleInvalid = { ...inputStyle, border: '1px solid #ef4444' };
const inputStyleValid = { ...inputStyle, border: '1px solid #22c55e' };

// ---------------------------------------------------------------------------
// Collapsible per-window limit section (Fix 3). OFF by default.
// ---------------------------------------------------------------------------
function LimitWindow({ title, on, onToggle, amount, onAmount, ops, onOps, showDate, date, onDate, currentPeriod }) {
  return (
    <div className="rounded-lg" style={{ border: '1px solid var(--cardborder)' }}>
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-sm" style={{ color: 'var(--text)' }}>{title}</span>
        <Toggle checked={on} onChange={onToggle} />
      </div>
      {on && (
        <div className="space-y-3 p-3" style={{ borderTop: '1px solid var(--cardborder)' }}>
          {showDate && (
            <Field label="Start date">
              <input type="date" style={inputStyle} value={date} onChange={(e) => onDate(e.target.value)} />
            </Field>
          )}
          <Field label="Disable upon reaching amount (INR)">
            <input type="number" min="0" style={inputStyle} value={amount} onChange={(e) => onAmount(e.target.value)} placeholder="e.g. 100000" />
          </Field>
          <Field label="Disable after N operations">
            <input type="number" min="0" style={inputStyle} value={ops} onChange={(e) => onOps(e.target.value)} placeholder="e.g. 200" />
          </Field>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Current period: {Number(currentPeriod || 0).toFixed(2)} INR</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared limit form state (used by both Add step-3 and Edit).
// ---------------------------------------------------------------------------
const emptyLimits = () => ({
  is_active_detail: true,
  min_amount: '',
  max_amount: '',
  // per-window amount caps
  monthly_limit: '',
  weekly_limit: '',
  daily_limit_amount: '',
  hourly_limit_amount: '',
  // per-window operation counts
  max_per_month: '',
  max_per_week: '',
  max_per_day: '',
  max_per_hour: '',
  monthly_start_date: '',
});

const WINDOWS = [
  { key: 'month', title: 'For a month', amt: 'monthly_limit', ops: 'max_per_month', date: true },
  { key: 'week', title: 'For a week', amt: 'weekly_limit', ops: 'max_per_week', date: false },
  { key: 'day', title: 'For a day', amt: 'daily_limit_amount', ops: 'max_per_day', date: false },
  { key: 'hour', title: 'For an hour', amt: 'hourly_limit_amount', ops: 'max_per_hour', date: false },
];

// Build the POST/PUT body. `caps` gates which windows are persisted.
function buildBody(form, account_type, caps, extra = {}) {
  const body = {
    account_type,
    is_active_detail: !!form.is_active_detail,
    min_amount: num(form.min_amount),
    max_amount: num(form.max_amount),
    ...extra,
  };
  for (const w of WINDOWS) {
    if (caps[w.key]) {
      body[w.amt] = num(form[w.amt]) ?? null;
      body[w.ops] = num(form[w.ops]);
      if (w.date) body.monthly_start_date = form.monthly_start_date || null;
    } else {
      body[w.amt] = null; // toggle off ⇒ no cap for this window
    }
  }
  return body;
}

// Adapt an NGO account (from ngoApi, camelCase fields) into the same
// snake_case shape EditModal/LimitsForm already understand, tagged with
// `__ngo` so save() knows to hit the NGO backend instead of traderApi.
function ngoAccountToEditable(a) {
  return {
    __ngo: true,
    __platform: a.platform,
    __mirrorId: a.gatewayPaymentDetailId ?? null,
    _id: a._id,
    account_name: a.displayName || '',
    upi_id: a.upiId || '',
    organization_name: a.organizationName || '',
    bank_name: '',
    is_active_detail: a.status === 'live',
    min_amount: a.minAmount ?? '',
    max_amount: a.maxAmount ?? '',
    monthly_limit: a.monthlyLimit ?? null,
    weekly_limit: a.weeklyLimit ?? null,
    daily_limit_amount: a.dailyLimitAmount ?? null,
    hourly_limit_amount: a.hourlyLimitAmount ?? null,
    max_per_month: a.maxPerMonth ?? '',
    max_per_week: a.maxPerWeek ?? '',
    max_per_day: a.maxPerDay ?? '',
    max_per_hour: a.maxPerHour ?? '',
    monthly_start_date: a.monthlyStartDate ? String(a.monthlyStartDate).slice(0, 10) : '',
  };
}

// Reverse of the above: translate a buildBody() payload into the NGO
// backend's camelCase PATCH shape.
function toNgoUpdateBody(body) {
  return {
    displayName: body.account_name,
    upiId: body.upi_id,
    organizationName: body.organization_name,
    status: body.is_active_detail ? 'live' : 'paused',
    minAmount: body.min_amount,
    maxAmount: body.max_amount,
    monthlyLimit: body.monthly_limit,
    weeklyLimit: body.weekly_limit,
    dailyLimitAmount: body.daily_limit_amount,
    hourlyLimitAmount: body.hourly_limit_amount,
    maxPerMonth: body.max_per_month,
    maxPerWeek: body.max_per_week,
    maxPerDay: body.max_per_day,
    maxPerHour: body.max_per_hour,
    monthlyStartDate: body.monthly_start_date,
  };
}

// Renders the shared "Setting Limits" body (min/max + 4 windows + activity).
function LimitsForm({ form, set, caps, setCaps, usage }) {
  // Each window's own real total from computeWindowUsage — previously all
  // four pointed at daily_amount_total, so "For a month"/"For a week"/"For
  // an hour" all showed the day's figure instead of their own.
  const period = {
    month: usage?.monthly_amount_total || 0,
    week: usage?.weekly_amount_total || 0,
    day: usage?.daily_amount_total || 0,
    hour: usage?.hourly_amount_total || 0,
  };
  return (
    <div className="space-y-3">
      {WINDOWS.map((w) => (
        <LimitWindow
          key={w.key}
          title={w.title}
          on={caps[w.key]}
          onToggle={() => setCaps((c) => ({ ...c, [w.key]: !c[w.key] }))}
          amount={form[w.amt]}
          onAmount={(v) => set(w.amt, v)}
          ops={form[w.ops]}
          onOps={(v) => set(w.ops, v)}
          showDate={w.date}
          date={form.monthly_start_date}
          onDate={(v) => set('monthly_start_date', v)}
          currentPeriod={period[w.key]}
        />
      ))}

      <div className="grid grid-cols-2 gap-3 pt-1">
        <Field label="Minimum amount per transaction">
          <input type="number" min="0" style={inputStyle} value={form.min_amount} onChange={(e) => set('min_amount', e.target.value)} placeholder="100" />
        </Field>
        <Field label="Maximum amount per transaction">
          <input type="number" min="0" style={inputStyle} value={form.max_amount} onChange={(e) => set('max_amount', e.target.value)} placeholder="100000" />
        </Field>
      </div>

      <div className="flex items-center justify-between rounded-lg px-3 py-2.5" style={{ border: '1px solid var(--cardborder)' }}>
        <div>
          <p className="text-sm" style={{ color: 'var(--text)' }}>Activity of details</p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Detail participates in transactions when ON</p>
        </div>
        <Toggle checked={form.is_active_detail} onChange={(v) => set('is_active_detail', v)} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ADD ACCOUNT modal — a tabbed shell wrapping two connection types.
//
//   Tab 1 "APK Connection" (default) → the original 3-step wizard, UNCHANGED
//                                       (Select Bank → Details+Limits → Connect),
//                                       posting to the trader backend via traderApi.
//   Tab 2 "Web Login"                → a single form that saves to the NGO
//                                       gateway backend (port 3000) through the
//                                       src/lib/ngoApi.js helper, which handles
//                                       its own NGO login + token caching (so it
//                                       does not depend on the trader session).
// ---------------------------------------------------------------------------

// Platform options for the Web Login tab. `value` matches the NGO backend enum
// (paytm | phonepe | bharatpe | gpay | amazonpay | other).
const WEB_PLATFORMS = [
  { label: 'Paytm Business', value: 'paytm' },
  { label: 'PhonePe Business', value: 'phonepe' },
  { label: 'BharatPe', value: 'bharatpe' },
  { label: 'Amazon Pay Business', value: 'amazonpay' },
];

// ---------------------------------------------------------------------------
// Routing bridge: the order-routing engine only ever reads the gateway's own
// `payment_details` table — it has no awareness of NGO/web-login accounts
// (a separate backend + database). So a web account is mirrored into
// `payment_details` on save/toggle, tagged via `gatewayPaymentDetailId` on
// the NGO account so later edits update the same row instead of duplicating.
// This is pure addition: routingEngine/orderController/checkout are untouched
// — they just see one more ordinary payment_details row.
// ---------------------------------------------------------------------------

// NGO platform → the gateway's fixed account_type enum. Unmapped platforms
// fall back to 'gpay', mirroring the "every non-wallet bank defaults to gpay"
// convention already used for the APK bank catalog above.
const NGO_PLATFORM_TO_ACCOUNT_TYPE = {
  paytm: 'paytm',
  phonepe: 'phonepe',
  gpay: 'gpay',
  bharatpe: 'bharat_pe',
};
const ngoAccountTypeFor = (platform) => NGO_PLATFORM_TO_ACCOUNT_TYPE[platform] || 'gpay';

// Create or update the mirrored payment_details row for one NGO account.
// Best-effort: callers should catch failures rather than let them block the
// NGO account's own (already-working) save/toggle.
async function syncNgoAccountToPaymentDetail(account) {
  const upiId = account.upiId || '';
  if (!upiHasAt(upiId)) return null; // gateway requires a valid "name@bank" UPI id

  const mirrorBody = {
    account_name: account.displayName || 'Untitled',
    upi_id: upiId,
    organization_name: account.organizationName || '',
    is_active_detail: account.status != null ? account.status === 'live' : undefined,
    min_amount: account.minAmount,
    max_amount: account.maxAmount,
    monthly_limit: account.monthlyLimit,
    weekly_limit: account.weeklyLimit,
    daily_limit_amount: account.dailyLimitAmount,
    hourly_limit_amount: account.hourlyLimitAmount,
    max_per_month: account.maxPerMonth,
    max_per_week: account.maxPerWeek,
    max_per_day: account.maxPerDay,
    max_per_hour: account.maxPerHour,
    // Not a real payment_details column — the backend strips this before
    // validation/DB write. It only tells the UPI cross-check "this NGO
    // account is the one being mirrored, don't reject it as its own
    // duplicate" (see traderController.js's assertUpiAvailable).
    ngo_account_id: account._id,
  };
  Object.keys(mirrorBody).forEach((k) => mirrorBody[k] === undefined && delete mirrorBody[k]);

  if (account.gatewayPaymentDetailId) {
    await traderApi.updatePaymentDetail(account.gatewayPaymentDetailId, mirrorBody);
    return account.gatewayPaymentDetailId;
  }

  const res = await traderApi.addPaymentDetail({
    ...mirrorBody,
    account_type: ngoAccountTypeFor(account.platform),
  });
  const newId = res?.data?.data?.payment_detail?.id;
  if (newId) await updateAccount(account._id, { gatewayPaymentDetailId: newId });
  return newId;
}

// ---------------------------------------------------------------------------
// APK CONNECTION tab — the original 3-step wizard, kept intact. Only its outer
// <Modal> wrapper was lifted out (the shared tabbed shell renders it now); all
// step logic, validation and the trader-backend save are byte-for-byte the same.
// ---------------------------------------------------------------------------
function ApkWizardBody({ presetBank, onClose, onSaved }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(presetBank ? 2 : 1);
  const [bank, setBank] = useState(presetBank || null);
  const [bankQuery, setBankQuery] = useState('');
  const [deviceQuery, setDeviceQuery] = useState('');
  const [form, setForm] = useState(() => ({
    ...emptyLimits(),
    account_name: '',
    upi_id: '',
    organization_name: '',
    bank_name: presetBank?.name || '',
    ngo_device_id: '',
  }));
  const [saving, setSaving] = useState(false);
  const [caps, setCaps] = useState({ month: false, week: false, day: false, hour: false });

  // Real paired devices (ngo-backend Mongo Device, via the same
  // getDevices() the Smartphones page uses) — Fix 1: this dropdown used to
  // be a static "No devices" placeholder pointed at an unrelated, dead
  // MySQL Smartphone model with no data source at all.
  const [ngoDevices, setNgoDevices] = useState([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setDevicesLoading(true);
    getDevices()
      .then((list) => { if (!cancelled) setNgoDevices(list || []); })
      .catch((e) => { console.error('Failed to load devices:', e); if (!cancelled) setNgoDevices([]); })
      .finally(() => { if (!cancelled) setDevicesLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const filteredBanks = useMemo(() => {
    const q = bankQuery.trim().toLowerCase();
    return q ? BANKS.filter((b) => b.name.toLowerCase().includes(q)) : BANKS;
  }, [bankQuery]);

  // The picker is a flat, unfiltered scroll of every paired device. Fine at
  // two or three, unusable at six or seven. Search by name or model, and put
  // online devices first — a trader is nearly always reaching for one that is
  // actually up, and those were previously buried in registration order.
  const deviceLabel = (dev) => dev.deviceName || dev.deviceModel || 'Unnamed device';
  const filteredDevices = useMemo(() => {
    const q = deviceQuery.trim().toLowerCase();
    const matched = q
      ? ngoDevices.filter((d) => `${d.deviceName || ''} ${d.deviceModel || ''}`.toLowerCase().includes(q))
      : ngoDevices;
    return [...matched].sort((a, b) => (b.online === true) - (a.online === true));
  }, [ngoDevices, deviceQuery]);

  // A secondary line repeating the same value on every row is pure noise —
  // it costs a line of height per device and distinguishes nothing. Only
  // surface the model when it actually varies between devices.
  const modelVaries = useMemo(() => {
    const models = new Set(ngoDevices.map((d) => (d.deviceModel || '').trim()).filter(Boolean));
    return models.size > 1;
  }, [ngoDevices]);

  // Below this the list is short enough to scan directly; a search box would
  // just be another thing to skip past.
  const showDeviceSearch = ngoDevices.length > 3;

  const pickBank = (b) => {
    setBank(b);
    setForm((f) => ({ ...f, bank_name: b.name }));
    setStep(2);
  };

  // Fix 2 — step-2 field validity.
  const nameValid = form.account_name.trim().length >= 2;
  const upiValid = upiHasAt(form.upi_id);
  const upiInvalid = form.upi_id.length > 0 && !upiValid;
  const orgValid = form.organization_name.trim().length > 0;
  // BUG-28: a device is REQUIRED, not optional. An APK account exists to have
  // payments detected by a paired phone; saving one without a device produced
  // exactly the "added but never linked" accounts that then sat in the pool
  // unable to confirm anything. As mandatory as the UPI ID.
  const deviceValid = !!form.ngo_device_id;
  const step2Valid = nameValid && upiValid && orgValid && deviceValid;

  const save = async () => {
    setSaving(true);
    try {
      await traderApi.addPaymentDetail(
        buildBody(form, bank?.type || 'gpay', caps, {
          account_name: form.account_name,
          upi_id: form.upi_id,
          bank_name: form.bank_name || bank?.name || '',
          organization_name: form.organization_name,
          ngo_device_id: form.ngo_device_id || null,
        })
      );
      toast('Payment detail added', 'success');
      await onSaved();
      onClose();
    } catch (e) {
      toast(apiError(e), 'error'); // Fix 1 — surface the exact backend message
    } finally {
      setSaving(false);
    }
  };

  const STEP_LABELS = { 1: 'Bank', 2: 'Account & device', 3: 'Limits' };

  return (
    <>
      {/* step indicator — numbered circles connected by a line, matching
          MaxPayDesign's wizardProgress; 3 steps (not the design's 4) since
          the real flow deliberately keeps device-selection and account-info
          on one step rather than splitting them further. */}
      <div className="relative mb-5 grid grid-cols-3">
        <div className="absolute left-[16%] right-[16%] top-[14px] h-px" style={{ background: 'var(--cardborder)' }} />
        {[1, 2, 3].map((s) => (
          <div key={s} className="relative z-[1] text-center">
            <span
              className="mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold"
              style={s <= step
                ? { background: 'var(--accent)', color: '#fff' }
                : { background: 'var(--hover)', border: '1px solid var(--cardborder)', color: 'var(--muted)' }}
            >
              {s < step ? <Check className="h-3.5 w-3.5" /> : s}
            </span>
            <span className="mt-1.5 block text-[11px]" style={{ color: s === step ? 'var(--text)' : 'var(--muted)' }}>{STEP_LABELS[s]}</span>
          </div>
        ))}
      </div>

      {step === 1 && (
        <div>
          <p className="mb-3 text-sm font-medium" style={{ color: 'var(--text)' }}>Select bank or UPI type</p>
          <SearchInput value={bankQuery} onChange={setBankQuery} placeholder="Search bank…" />
          <div className="tf-scroll mt-3 grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1">
            {filteredBanks.map((b) => (
              <button
                key={b.name}
                onClick={() => pickBank(b)}
                className="tf-row-hover flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition"
                style={{ border: bank?.name === b.name ? '1px solid rgba(34,197,94,.5)' : '1px solid var(--cardborder)', background: bank?.name === b.name ? 'rgba(34,197,94,.06)' : 'transparent' }}
              >
                <BankBadge type={b.type} label={b.name} size={32} />
                <span className="min-w-0 flex-1 truncate text-sm" style={{ color: 'var(--text)' }}>{b.name}</span>
                {bank?.name === b.name && <CheckCircle2 className="h-4 w-4 flex-shrink-0" style={{ color: '#22c55e' }} />}
              </button>
            ))}
            {filteredBanks.length === 0 && (
              <p className="col-span-2 py-4 text-center text-sm" style={{ color: 'var(--muted)' }}>No banks match “{bankQuery}”.</p>
            )}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div>
            <p className="mb-1 text-sm font-medium" style={{ color: 'var(--text)' }}>
              Select a paired smartphone <span style={{ color: '#ef4444' }}>*</span>
            </p>
            <p className="mb-3 text-xs" style={{ color: 'var(--muted)' }}>The APK on this device will detect payment notifications.</p>
            {showDeviceSearch && !devicesLoading && (
              <div className="mb-2">
                <SearchInput
                  value={deviceQuery}
                  onChange={setDeviceQuery}
                  placeholder={`Search ${ngoDevices.length} devices by name…`}
                />
              </div>
            )}
            {/* Capped height so a long device list scrolls inside the step
                instead of pushing the form's own fields off the modal. */}
            <div className="space-y-1.5" style={showDeviceSearch ? { maxHeight: 260, overflowY: 'auto' } : undefined}>
              {devicesLoading && (
                <p className="text-xs" style={{ color: 'var(--muted)' }}>Loading devices…</p>
              )}
              {!devicesLoading && filteredDevices.map((dev) => {
                const selected = form.ngo_device_id === String(dev.id);
                return (
                  <button
                    key={dev.id}
                    type="button"
                    onClick={() => set('ngo_device_id', String(dev.id))}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition"
                    style={{ border: selected ? '1px solid rgba(34,197,94,.5)' : '1px solid var(--cardborder)', background: selected ? 'rgba(34,197,94,.06)' : 'transparent' }}
                  >
                    <span
                      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
                      style={dev.online ? { background: 'rgba(34,197,94,.14)', color: '#22c55e' } : { background: 'rgba(239,68,68,.14)', color: '#ef4444' }}
                    >
                      <IconPhone className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      {/* The device NAME is what the trader is choosing by, so
                          it carries the weight; everything else is secondary
                          and deliberately smaller and muted. */}
                      <p className="truncate text-sm font-semibold" style={{ color: 'var(--text)' }}>{deviceLabel(dev)}</p>
                      <p className="truncate text-[11px]" style={{ color: dev.online ? '#22c55e' : 'var(--subtle)' }}>
                        {dev.online ? 'Online' : 'Offline'}
                        {/* Only when it actually distinguishes one row from another. */}
                        {modelVaries && dev.deviceModel ? ` · ${dev.deviceModel}` : ''}
                      </p>
                    </div>
                    {selected && <Check className="h-4 w-4 flex-shrink-0" style={{ color: '#22c55e' }} />}
                  </button>
                );
              })}
              {!devicesLoading && ngoDevices.length > 0 && filteredDevices.length === 0 && (
                <p className="py-3 text-center text-xs" style={{ color: 'var(--muted)' }}>
                  No devices match “{deviceQuery}”.
                </p>
              )}
              {!devicesLoading && ngoDevices.length === 0 && (
                <p className="rounded-lg px-3 py-2.5 text-xs" style={{ border: '1px dashed rgba(239,68,68,.4)', color: '#ef4444' }}>
                  No paired devices yet. An APK account cannot detect payments without one —
                  pair a smartphone first, then come back and select it here.
                </p>
              )}
            </div>
            {!devicesLoading && ngoDevices.length > 0 && !deviceValid && (
              <p className="mt-2 text-xs font-medium" style={{ color: '#ef4444' }}>
                Select a device to continue — this account can&rsquo;t detect payments without one.
              </p>
            )}
            <button
              type="button"
              onClick={() => navigate('/smartphones')}
              className="mt-2 flex items-center gap-1.5 text-xs font-semibold"
              style={{ color: 'var(--accent)' }}
            >
              <IconPlus className="h-3.5 w-3.5" /> Pair a smartphone first <ExternalLink className="h-3 w-3" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3" style={{ borderTop: '1px solid var(--cardborder)', paddingTop: 14 }}>
            <div className="col-span-2">
              <Field label="Title / Name">
                <input
                  style={form.account_name.length > 0 && !nameValid ? inputStyleInvalid : inputStyle}
                  value={form.account_name}
                  onChange={(e) => set('account_name', e.target.value)}
                  placeholder="e.g. Rahul Sharma"
                />
                {form.account_name.length > 0 && !nameValid && (
                  <span className="mt-1 block text-xs" style={{ color: '#ef4444' }}>Name must be at least 2 characters</span>
                )}
              </Field>
            </div>

            <div className="col-span-2">
              <Field label="UPI ID">
                <div className="relative">
                  <input
                    style={{ ...(upiInvalid ? inputStyleInvalid : upiValid ? inputStyleValid : inputStyle), paddingRight: 36 }}
                    value={form.upi_id}
                    onChange={(e) => set('upi_id', e.target.value)}
                    placeholder="name@bank"
                  />
                  {upiValid && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: '#22c55e' }} aria-hidden>✓</span>
                  )}
                </div>
                <span className="mt-1 block text-xs" style={{ color: upiInvalid ? '#ef4444' : 'var(--muted)' }}>
                  Enter valid UPI ID (example: name@bank)
                </span>
              </Field>
            </div>

            <div className="col-span-2">
              <Field label="Organization name">
                <input
                  style={inputStyle}
                  value={form.organization_name}
                  onChange={(e) => set('organization_name', e.target.value)}
                  placeholder="e.g. Sharma Enterprises"
                />
              </Field>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Set routing limits</p>
            <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: 'var(--hover)', color: 'var(--muted)' }}>Optional</span>
          </div>
          <p className="mb-3 text-xs" style={{ color: 'var(--muted)' }}>All limits are optional — leave a section off to skip it. These can be changed from Edit later.</p>
          <LimitsForm form={form} set={set} caps={caps} setCaps={setCaps} usage={null} />
        </>
      )}

      {/* footer nav */}
      <div className="mt-5 flex items-center justify-between">
        <Button variant="ghost" onClick={() => (step === 1 || (step === 2 && presetBank) ? onClose() : setStep((s) => s - 1))}>
          {step === 1 || (step === 2 && presetBank) ? 'Cancel' : 'Back'}
        </Button>

        {step === 1 && (
          <Button onClick={() => setStep(2)} disabled={!bank}>Next</Button>
        )}

        {step === 2 && (
          <Button onClick={() => step2Valid && setStep(3)} disabled={!step2Valid}>Next</Button>
        )}

        {step === 3 && (
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add details'}</Button>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// WEB LOGIN tab — a new single form posting to the NGO gateway backend.
// ---------------------------------------------------------------------------
const emptyWebForm = () => ({
  platform: '',
  upiId: '',
  displayName: '',
  loginEmail: '',
  loginPassword: '',
  loginPhone: '',
});

function WebLoginForm({ onClose, onSaved }) {
  const [form, setForm] = useState(emptyWebForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [otpStep, setOtpStep] = useState(false);
  const [otpValue, setOtpValue] = useState('');
  const [connectingId, setConnectingId] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // The success screen auto-advances after a short window (unchanged real
  // behavior); "Finish" lets the trader skip the wait. Both paths funnel
  // through here so onClose/onSaved never fire twice.
  const closeTimerRef = useRef(null);
  const finishedRef = useRef(false);
  const finishNow = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    onClose();
    onSaved();
  };

  async function handleWebLoginSave() {
    setError('');
    setSuccess('');
    // Client-side validation before hitting the NGO backend.
    if (!form.platform) return setError('Please select a platform.');
    if (!form.upiId.trim()) return setError('UPI ID is required.');
    if (!form.displayName.trim()) return setError('Display name is required.');
    if (!form.loginEmail.trim()) return setError('Login email is required.');
    if (!form.loginPassword) return setError('Login password is required.');
    if (!form.loginPhone.trim()) return setError('Phone number is required.');

    setLoading(true);
    try {
      // ngoApi handles its own NGO login + token caching, then POSTs to
      // http://localhost:3000/api/ngo/accounts.
      const response = await saveWebAccount({
        platform: form.platform,
        upiId: form.upiId.trim(),
        displayName: form.displayName.trim(),
        loginEmail: form.loginEmail.trim(),
        loginPassword: form.loginPassword,
        loginPhone: form.loginPhone.trim(),
      });

      // After save succeeds, call connectAccount with the account _id
      const accountId = response.data?._id;

      // Make this account routable (see syncNgoAccountToPaymentDetail above)
      // as soon as it exists — independent of the connect/OTP steps below,
      // and best-effort so a sync hiccup never blocks the save the user is
      // actually waiting on.
      if (accountId) {
        syncNgoAccountToPaymentDetail({
          _id: accountId,
          platform: form.platform,
          upiId: form.upiId.trim(),
          displayName: form.displayName.trim(),
          status: 'live',
        }).catch((e) => {
          console.error('NGO account saved, but routing sync failed:', e);
          toast('Account saved, but it may not be visible to order routing yet. Check back or try Edit → Save again.', 'warning');
        });
      }

      if (accountId) {
        setConnectingId(accountId);
        await startConnect(accountId);
      } else {
        setSuccess('Account connected successfully!');
        toast('Payment detail added', 'success');
        window.dispatchEvent(new Event('ngo-account-added'));
        closeTimerRef.current = setTimeout(finishNow, 1500);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function startConnect(accountId) {
    setConnecting(true);
    try {
      const connectResponse = await connectAccount(accountId);

      if (connectResponse.data?.needsOTP || connectResponse.needsOTP) {
        setOtpStep(true);
        setError('');
      } else {
        setSuccess('Connected Successfully!');
        toast('Account connected successfully', 'success');
        window.dispatchEvent(new Event('ngo-account-added'));
        closeTimerRef.current = setTimeout(finishNow, 2000);
      }
    } catch (err) {
      setError(err.message || 'Failed to connect account');
    } finally {
      setConnecting(false);
    }
  }

  async function handleVerifyOTP() {
    if (otpValue.length !== 6) {
      setError('Please enter a 6-digit OTP');
      return;
    }

    setConnecting(true);
    setError('');
    try {
      await verifyOTP(connectingId, otpValue);

      setSuccess('Connected Successfully!');
      toast('Account verified successfully', 'success');
      window.dispatchEvent(new Event('ngo-account-added'));
      closeTimerRef.current = setTimeout(finishNow, 2000);
    } catch (err) {
      setError(err.message || 'Invalid OTP. Please try again.');
      setOtpValue('');
    } finally {
      setConnecting(false);
    }
  }

  async function handleResendOTP() {
    setConnecting(true);
    setError('');
    try {
      await connectAccount(connectingId);
      setOtpValue('');
      toast('OTP resent to your registered mobile number', 'success');
    } catch (err) {
      setError(err.message || 'Failed to resend OTP');
    } finally {
      setConnecting(false);
    }
  }

  // Freeze inputs while saving and during the brief success window.
  const busy = loading || !!success || connecting;
  const platformLabelFor = (v) => WEB_PLATFORMS.find((p) => p.value === v)?.label || 'the provider';

  // Real connecting screen — covers the two genuine async phases (saving the
  // account, then starting the provider session) rather than a fabricated
  // multi-step checklist; we only have two real signals, not a granular
  // "account created / session starting / waiting for provider" sequence.
  if (!otpStep && !success && (loading || connecting)) {
    return (
      <div className="px-2 py-8 text-center">
        <span
          className="mx-auto block h-14 w-14 animate-spin rounded-full"
          style={{ border: '4px solid var(--hover)', borderTopColor: 'var(--accent)' }}
        />
        <h3 className="mt-4 text-base font-semibold" style={{ color: 'var(--text)' }}>
          {loading ? 'Creating the account…' : `Starting a secure session with ${platformLabelFor(form.platform)}…`}
        </h3>
        <p className="mx-auto mt-1 max-w-xs text-xs" style={{ color: 'var(--muted)' }}>
          {loading ? 'Saving the account before starting the provider session.' : 'Checking whether a verification code is required.'}
        </p>
      </div>
    );
  }

  // OTP Input Step
  if (otpStep) {
    return (
      <div>
        <div className="space-y-4 py-2 text-center">
          <span
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-full"
            style={{ background: 'rgba(245,158,11,.14)', color: '#f59e0b' }}
          >
            <KeyRound className="h-6 w-6" />
          </span>
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text)' }}>Enter the OTP</h3>
            <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
              {connecting ? 'Verifying…' : 'We sent a verification code to the phone registered with this account.'}
            </p>
          </div>

          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={otpValue}
            onChange={(e) => setOtpValue(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            disabled={connecting}
            className="mx-auto block w-[220px] rounded-lg text-center text-xl font-semibold tracking-[.35em] outline-none"
            style={{ height: 52, border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text)' }}
          />

          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-left text-sm text-red-200">
              {error}
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-col gap-3">
          <Button onClick={handleVerifyOTP} disabled={busy || otpValue.length !== 6}>
            {connecting ? 'Verifying...' : 'Verify and continue'}
          </Button>

          <button
            onClick={handleResendOTP}
            disabled={connecting}
            className="text-sm font-medium disabled:opacity-50"
            style={{ color: '#22c55e' }}
          >
            Resend OTP
          </button>
        </div>

        <div className="mt-3 flex items-center justify-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
          <IconLock className="h-3.5 w-3.5" style={{ color: '#22c55e' }} />
          <span>256-bit encrypted</span>
        </div>
      </div>
    );
  }

  // Success screen
  if (success) {
    return (
      <div className="py-2 text-center">
        <span
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-full"
          style={{ background: 'rgba(34,197,94,.14)', color: '#22c55e' }}
        >
          <Check className="h-7 w-7" />
        </span>
        <h3 className="mt-4 text-base font-semibold" style={{ color: 'var(--text)' }}>Account is live</h3>
        <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>{success}</p>

        <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg p-3 text-left" style={{ border: '1px solid var(--cardborder)' }}>
          <div>
            <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--muted)' }}>UPI ID</p>
            <p className="truncate text-sm font-medium" style={{ color: 'var(--text)' }}>{form.upiId || '—'}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Connection</p>
            <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Web Login</p>
          </div>
        </div>

        <Button className="mt-4 w-full" onClick={finishNow}>Finish</Button>
      </div>
    );
  }

  // Original form step
  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Field label="Platform">
            <select style={inputStyle} value={form.platform} disabled={busy} onChange={(e) => set('platform', e.target.value)}>
              <option value="">Select platform…</option>
              {WEB_PLATFORMS.map((p) => (
                <option key={p.label} value={p.value}>{p.label}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="UPI ID">
          <input
            style={inputStyle}
            value={form.upiId}
            disabled={busy}
            onChange={(e) => set('upiId', e.target.value)}
            placeholder="9988776655@paytm"
          />
        </Field>

        <Field label="Display Name">
          <input
            style={inputStyle}
            value={form.displayName}
            disabled={busy}
            onChange={(e) => set('displayName', e.target.value)}
            placeholder="e.g. Bright Future Paytm"
          />
        </Field>

        <Field label="Login Email">
          <input
            type="email"
            style={inputStyle}
            value={form.loginEmail}
            disabled={busy}
            onChange={(e) => set('loginEmail', e.target.value)}
            placeholder="ngo@paytm.com"
          />
        </Field>

        <Field label="Phone Number">
          <input
            style={inputStyle}
            value={form.loginPhone}
            disabled={busy}
            onChange={(e) => set('loginPhone', e.target.value)}
            placeholder="9988776655"
          />
        </Field>

        <div className="col-span-2">
          <Field label="Login Password">
            <input
              type="password"
              style={inputStyle}
              value={form.loginPassword}
              disabled={busy}
              onChange={(e) => set('loginPassword', e.target.value)}
              placeholder="••••••••"
            />
          </Field>
        </div>

        {error && (
          <div className="col-span-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-start gap-2.5 rounded-lg p-3" style={{ background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.25)' }}>
        <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: '#3b82f6' }} />
        <div>
          <p className="text-xs font-semibold" style={{ color: 'var(--text)' }}>Credentials start a real provider session</p>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>They're used once to log into {platformLabelFor(form.platform)} on your behalf and aren't shown again in this UI.</p>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={handleWebLoginSave} disabled={busy}>Save &amp; connect</Button>
      </div>

      <div className="mt-3 flex items-center justify-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
        <IconLock className="h-3.5 w-3.5" style={{ color: '#22c55e' }} />
        <span>256-bit encrypted</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabbed shell: title stays "Add Payment Detail"; tab bar sits above the body.
// APK Connection is the default/active tab.
// ---------------------------------------------------------------------------
function AddAccountModal({ presetBank, onClose, onSaved }) {
  const [tab, setTab] = useState('apk'); // 'apk' | 'web'

  return (
    <Modal open title="Add Payment Detail" subtitle="Choose how MaxPay will verify incoming payment data." onClose={onClose} width={680}>
      {/* Card-style connection tabs: icon tile + name + subtitle, tinted
          border/background on the active tab (matches MaxPayDesign's
          connectTabs) — was a plain icon-on-top underline strip before. */}
      <div className="mb-4 grid grid-cols-2 gap-2.5">
        {[
          { key: 'apk', label: 'APK Connection', sub: 'Use a paired Android phone', Icon: IconRobot, tint: '#22c55e' },
          { key: 'web', label: 'Web Login', sub: 'Secure provider session', Icon: IconGlobe, tint: '#f43f5e' },
        ].map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="flex items-center gap-2.5 rounded-xl p-3 text-left transition"
              style={active
                ? { border: `1px solid ${t.tint}80`, background: `${t.tint}14`, boxShadow: `0 0 0 3px ${t.tint}1f` }
                : { border: '1px solid var(--cardborder)', background: 'transparent' }}
            >
              <t.Icon style={{ width: 28, height: 28, color: t.tint, flexShrink: 0 }} />
              <div className="min-w-0">
                <p className="text-sm font-semibold" style={{ color: active ? t.tint : 'var(--text)' }}>{t.label}</p>
                <p className="truncate text-xs" style={{ color: 'var(--muted)' }}>{t.sub}</p>
              </div>
            </button>
          );
        })}
      </div>

      {tab === 'apk' ? (
        <ApkWizardBody presetBank={presetBank} onClose={onClose} onSaved={onSaved} />
      ) : (
        <WebLoginForm onClose={onClose} onSaved={onSaved} />
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// EDIT modal
// ---------------------------------------------------------------------------
function EditModal({ detail, onClose, onSaved, onDeleted, deviceLiveMap = {} }) {
  const navigate = useNavigate();
  const [form, setForm] = useState(() => ({
    ...emptyLimits(),
    account_name: detail.account_name ?? '',
    upi_id: detail.upi_id ?? '',
    organization_name: detail.organization_name ?? '',
    bank_name: detail.bank_name ?? '',
    smartphone_id: detail.smartphone_id ?? '',
    is_active_detail: detail.is_active_detail ?? true,
    min_amount: detail.min_amount ?? '',
    max_amount: detail.max_amount ?? '',
    monthly_limit: detail.monthly_limit ?? '',
    weekly_limit: detail.weekly_limit ?? '',
    daily_limit_amount: detail.daily_limit_amount ?? '',
    hourly_limit_amount: detail.hourly_limit_amount ?? '',
    max_per_month: detail.max_per_month ?? '',
    max_per_week: detail.max_per_week ?? '',
    max_per_day: detail.max_per_day ?? '',
    max_per_hour: detail.max_per_hour ?? '',
    monthly_start_date: detail.monthly_start_date ? String(detail.monthly_start_date).slice(0, 10) : '',
  }));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // BUG-A: the linked phone was editable only through the row-level "Link a
  // device" banner, which appears solely while the account is disconnected or
  // was never linked. A working APK account therefore had no way to move to a
  // different phone at all — the trader had to delete it and add it again,
  // losing its history and score. Same picker and same real device list the
  // Add wizard and LinkDeviceModal use, so there is one control for this.
  const { devices, loading: devicesLoading } = useDevices();
  const [deviceId, setDeviceId] = useState(detail.ngo_device_id ? String(detail.ngo_device_id) : '');
  const [changingDevice, setChangingDevice] = useState(false);
  // Pre-open a window if it already has an amount cap set.
  const [caps, setCaps] = useState({
    month: detail.monthly_limit != null,
    week: detail.weekly_limit != null,
    day: detail.daily_limit_amount != null,
    hour: detail.hourly_limit_amount != null,
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const nameValid = form.account_name.trim().length >= 2;
  const upiValid = upiHasAt(form.upi_id);
  // Same real heartbeat liveness the row list shows (deviceLiveMap, polled
  // every 15s) — NGO accounts skip this because the edit action itself is
  // only reachable while the account is live (gated at the row level).
  const liveState = !detail.__ngo && detail.ngo_device_id ? (deviceLiveMap[detail.ngo_device_id] ? 'active' : 'dead') : null;

  const save = async () => {
    if (!nameValid || !upiValid) {
      toast('Enter a valid name and UPI ID (must contain "@")', 'error');
      return;
    }
    setSaving(true);
    try {
      const body = buildBody(form, detail.account_type, caps, {
        account_name: form.account_name,
        upi_id: form.upi_id,
        bank_name: form.bank_name || '',
        organization_name: form.organization_name,
      });
      let syncFailed = false;
      let movedTo = null;
      if (detail.__ngo) {
        await updateAccount(detail._id, toNgoUpdateBody(body));
        try {
          await syncNgoAccountToPaymentDetail({
            _id: detail._id,
            platform: detail.__platform,
            gatewayPaymentDetailId: detail.__mirrorId,
            upiId: form.upi_id,
            displayName: form.account_name,
            organizationName: form.organization_name,
            status: form.is_active_detail ? 'live' : 'paused',
            minAmount: body.min_amount,
            maxAmount: body.max_amount,
            monthlyLimit: body.monthly_limit,
            weeklyLimit: body.weekly_limit,
            dailyLimitAmount: body.daily_limit_amount,
            hourlyLimitAmount: body.hourly_limit_amount,
            maxPerMonth: body.max_per_month,
            maxPerWeek: body.max_per_week,
            maxPerDay: body.max_per_day,
            maxPerHour: body.max_per_hour,
          });
        } catch (syncErr) {
          // The NGO account itself saved fine — don't fail the whole edit
          // over a routing-sync hiccup, just surface it separately (the
          // trader still needs to know routing may not reflect this change).
          console.error('NGO account saved, but routing sync failed:', syncErr);
          syncFailed = true;
        }
      } else {
        // Only sent when it actually changed: `ngo_device_id` is what routing
        // and settlement scope to (see matchingEngineV2), so re-writing it on
        // every unrelated edit would be a silent no-op at best.
        const deviceChanged = String(deviceId || '') !== String(detail.ngo_device_id || '');
        await traderApi.updatePaymentDetail(detail.id, deviceChanged ? { ...body, ngo_device_id: deviceId || null } : body);
        if (deviceChanged && deviceId) movedTo = devices.find((d) => String(d.id) === String(deviceId)) || null;
      }
      if (syncFailed) {
        toast('Details saved, but order routing may not reflect these changes yet. Check back or save again.', 'warning');
      } else if (movedTo) {
        // Same wording LinkDeviceModal uses, for the same reason: linking an
        // offline phone saves fine but changes nothing about routing until it
        // comes back, and silently succeeding reads as "it's working now".
        toast(
          movedTo.online
            ? `Saved — now paired to ${deviceLabel(movedTo)}, which should start receiving orders shortly`
            : `Saved — now paired to ${deviceLabel(movedTo)}. It is offline right now, so orders will not route until it comes back online.`,
          movedTo.online ? 'success' : 'info'
        );
      } else {
        toast('Payment detail updated', 'success');
      }
      await onSaved();
      onClose();
    } catch (e) {
      toast(apiError(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = () => setConfirmDelete(true);

  const confirmRemove = async () => {
    try {
      await traderApi.deletePaymentDetail(detail.id);
      toast('Payment detail deleted', 'success');
      await onDeleted();
      onClose();
    } catch (e) {
      toast(apiError(e), 'error');
      setConfirmDelete(false);
    }
  };

  return (
    <>
    <Modal open title="Edit Payment Detail" onClose={onClose} width={560}>
      {/* identity + real connection state — same data the row list shows,
          just surfaced here too so an edit never opens "blind" to whether
          the account is actually live right now. */}
      <div className="mb-4 flex items-center justify-between gap-3 rounded-lg p-3" style={{ border: '1px solid var(--cardborder)', background: 'var(--hover)' }}>
        <div className="flex min-w-0 items-center gap-3">
          <BankBadge type={detail.__ngo ? detail.__platform : detail.account_type} label={form.account_name || 'Untitled'} size={40} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium" style={{ color: 'var(--text)' }}>{form.account_name || 'Untitled'}</p>
            <p className="truncate text-xs" style={{ color: 'var(--muted)' }}>
              {detail.__ngo ? platformLabel(detail.__platform) : methodMeta(detail.account_type).label}
              {' · '}{(detail.__ngo || connType(detail) === 'web') ? 'Web Login' : 'APK'} connection
            </p>
          </div>
        </div>
        {detail.__ngo ? (
          <Badge color="green">Live</Badge>
        ) : (
          // Same real connection state the row list and Live pool show, so
          // opening an account to edit it never disagrees with the list.
          <span
            title={STATE_META[accountState(detail)].title}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
            style={{ background: `${STATE_META[accountState(detail)].hex}22`, color: STATE_META[accountState(detail)].hex }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATE_META[accountState(detail)].hex, flexShrink: 0 }} />
            {STATE_META[accountState(detail)].label}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Display name">
          <input style={inputStyle} value={form.account_name} onChange={(e) => set('account_name', e.target.value)} />
        </Field>
        <Field label="Organization name">
          <input style={inputStyle} value={form.organization_name} onChange={(e) => set('organization_name', e.target.value)} />
        </Field>
        <div className="col-span-2">
          <Field label="UPI ID">
            <input
              style={form.upi_id.length > 0 && !upiValid ? inputStyleInvalid : upiValid ? inputStyleValid : inputStyle}
              value={form.upi_id}
              onChange={(e) => set('upi_id', e.target.value)}
            />
            <span className="mt-1 block text-xs" style={{ color: 'var(--muted)' }}>Must contain “@” (example: name@bank)</span>
          </Field>
        </div>
      </div>

      {/* Paired smartphone. APK accounts only — a Web Login account is a
          browser session on our side and has no device to move. */}
      {!detail.__ngo && connType(detail) !== 'web' && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Paired smartphone</p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                The APK on this phone detects payments arriving on this UPI.
              </p>
            </div>
            {!changingDevice && (
              <button
                type="button"
                onClick={() => setChangingDevice(true)}
                className="whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium"
                style={{ border: '1px solid var(--cardborder)', color: 'var(--text)' }}
              >
                {deviceId ? 'Change device' : 'Link a device'}
              </button>
            )}
          </div>

          {!changingDevice ? (
            <div className="flex items-center gap-2.5 rounded-lg px-3 py-2.5" style={{ border: '1px solid var(--cardborder)' }}>
              <span
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
                style={liveState === 'active'
                  ? { background: 'rgba(34,197,94,.14)', color: '#22c55e' }
                  : { background: 'rgba(239,68,68,.14)', color: '#ef4444' }}
              >
                <IconPhone className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                {/* The device list is the only place a device's NAME lives, so
                    until it loads there is nothing truthful to show but the
                    fact that one is linked. */}
                <p className="truncate text-sm font-semibold" style={{ color: 'var(--text)' }}>
                  {deviceId
                    ? (devices.find((d) => String(d.id) === String(deviceId))
                      ? deviceLabel(devices.find((d) => String(d.id) === String(deviceId)))
                      : (devicesLoading ? 'Loading…' : 'Linked device'))
                    : 'No device linked'}
                </p>
                <p className="truncate text-[11px]" style={{ color: 'var(--subtle)' }}>
                  {deviceId
                    ? (liveState === 'active' ? 'Online' : 'Not responding — orders will not route here')
                    : 'This account cannot detect payments until a phone is linked.'}
                </p>
              </div>
            </div>
          ) : (
            <>
              <DevicePicker
                devices={devices}
                loading={devicesLoading}
                selectedId={deviceId}
                onSelect={setDeviceId}
                onPairNew={() => navigate('/smartphones')}
                emptyMessage="No paired devices yet — pair a smartphone first, then link it here."
                maxHeight={200}
              />
              <div className="mt-2 flex items-center justify-between">
                <p className="text-xs" style={{ color: 'var(--muted)' }}>Applied when you save.</p>
                <button
                  type="button"
                  onClick={() => { setDeviceId(detail.ngo_device_id ? String(detail.ngo_device_id) : ''); setChangingDevice(false); }}
                  className="rounded-md px-2.5 py-1 text-xs font-medium"
                  style={{ border: '1px solid var(--cardborder)', color: 'var(--muted)' }}
                >
                  Keep current device
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="mb-2 mt-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Routing limits</p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Independent hourly, daily, weekly and monthly caps — configure only what you need.</p>
        </div>
        <BadgeCheck className="h-[18px] w-[18px] flex-shrink-0" style={{ color: 'var(--muted)' }} />
      </div>
      <LimitsForm form={form} set={set} caps={caps} setCaps={setCaps} usage={detail.usage} />

      {/* NGO/web accounts do have a real delete endpoint, but it's exposed
          from the trash icon on their row in AccountsColumn instead of here
          — this modal's delete only covers trader-native details. */}
      {!detail.__ngo && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg p-3" style={{ border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.05)' }}>
          <div className="flex items-center gap-2.5">
            <IconTrash className="h-4 w-4 flex-shrink-0" style={{ color: '#ef4444' }} />
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Delete payment detail</p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>Removes it from routing and your inventory.</p>
            </div>
          </div>
          <button
            onClick={remove}
            className="whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium"
            style={{ border: '1px solid rgba(239,68,68,.4)', color: '#ef4444' }}
          >
            Delete
          </button>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </Modal>
    <ConfirmModal
      open={confirmDelete}
      title="Delete this payment detail?"
      description="Delete this payment detail? This cannot be undone."
      confirmLabel="Delete"
      tone="danger"
      onConfirm={confirmRemove}
      onClose={() => setConfirmDelete(false)}
    />
    </>
  );
}

// ---------------------------------------------------------------------------
// Small helpers for the two-column layout
// ---------------------------------------------------------------------------
function methodMeta(type) {
  const m = ACCOUNT_TYPES[type] || { label: type, color: 'gray' };
  return m;
}

// Limit indicator dot: grey (new/no usage) · yellow (≥70% of daily count) · green (healthy) · red (exhausted).
function limitDot(d) {
  const used = d.usage?.used_today ?? 0;
  const cap = Number(d.max_per_day) || 0;
  if (!cap || used === 0) return { cls: 'bg-gray-500', title: 'No usage today' };
  const ratio = used / cap;
  if (ratio >= 1) return { cls: 'bg-red-500', title: 'Daily limit exhausted' };
  if (ratio >= 0.7) return { cls: 'bg-amber-500', title: 'Approaching daily limit' };
  return { cls: 'bg-emerald-500', title: 'Healthy' };
}

const isExhausted = (d) => {
  const cap = Number(d.max_per_day) || 0;
  return cap > 0 && (d.usage?.used_today ?? 0) >= cap;
};
// Active for the trader but not participating in offers (admin flag off).
const notLinked = (d) => !!d.is_active_detail && d.is_active === false;

// Connection type of a payment detail. A MySQL payment_details row has no
// connectionType column at all, so reading d.connectionType was permanently
// undefined and every account resolved to 'apk' — which is why a disconnected
// Web Login account was told to "link a device". Resolve it the way the rest
// of the app does: an account is web when a Web Login Account owns the same
// UPI. Matched on upi_id because Account.gatewayPaymentDetailId is dangling in
// real data (see mirroredDetailIds).
function resolveConnType(d, ngoAccounts = []) {
  if (!d) return 'apk';
  if (d.__ngo || d.connectionType === 'web') return 'web';
  const upi = String(d.upi_id || '').trim().toLowerCase();
  if (!upi) return 'apk';
  const owner = ngoAccounts.find((a) => String(a.upiId || '').trim().toLowerCase() === upi);
  return owner && owner.connectionType === 'web' ? 'web' : 'apk';
}

/** The Web Login account that owns this payment detail's UPI, if any. */
const webOwnerOf = (d, ngoAccounts = []) => ngoAccounts.find(
  (a) => String(a.upiId || '').trim().toLowerCase() === String(d?.upi_id || '').trim().toLowerCase()
);

// Kept for the few call sites that only have the row (no ngoAccounts in
// scope); those are display-only and default to APK, which is correct for a
// trader-native detail.
const connType = (d) => (d && (d.__ngo || d.connectionType === 'web') ? 'web' : 'apk');

// A Web Login account is mirrored into MySQL payment_details for the routing
// engine, so the SAME real account exists on both sides. Returns the ids of
// the payment_details rows that are those shadow copies, so nothing counts or
// renders one account twice.
//
// Matched primarily on upi_id: Account.gatewayPaymentDetailId is the intended
// back-reference but is dangling in real data (it holds ids of payment_details
// rows that no longer exist), which silently defeated the id-only matching
// this replaced. gatewayPaymentDetailId is still honoured as a second pass so
// a mirror whose UPI was later edited on one side is still caught.
function mirroredDetailIds(details = [], ngoAccounts = []) {
  const byUpi = new Map(
    details.filter((d) => d.upi_id).map((d) => [String(d.upi_id).trim().toLowerCase(), String(d.id)])
  );
  const ids = new Set();
  for (const a of ngoAccounts) {
    const viaUpi = a.upiId ? byUpi.get(String(a.upiId).trim().toLowerCase()) : undefined;
    if (viaUpi !== undefined) ids.add(viaUpi);
    else if (a.gatewayPaymentDetailId) ids.add(String(a.gatewayPaymentDetailId));
  }
  return ids;
}

// Distinct real accounts across both sides — the number the header must show.
// `predicate` optionally narrows it to a subset (e.g. only the live ones).
function distinctAccounts(details = [], ngoAccounts = [], detailPredicate = () => true, ngoPredicate = () => true) {
  const mirrored = mirroredDetailIds(details, ngoAccounts);
  const natives = details.filter((d) => !mirrored.has(String(d.id)) && detailPredicate(d));
  return natives.length + ngoAccounts.filter(ngoPredicate).length;
}


// Small badge: android robot (teal) for APK, globe (coral) for Web Login.
function ConnTypeIcon({ type, size = 24 }) {
  const isWeb = type === 'web';
  const Icon = isWeb ? IconGlobe : IconRobot;
  return (
    <span
      className={isWeb ? 'text-rose-400' : 'text-emerald-400'}
      title={isWeb ? 'Web Login connection' : 'APK connection'}
    >
      <Icon style={{ width: size, height: size }} />
    </span>
  );
}

const fmtINR = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '₹0';
  return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
};

// Any configured AMOUNT cap — not the always-present count caps (max_per_*),
// which carry non-null defaults even when the trader never touched them.
// Mirrors the same "!= null" convention EditModal already uses to decide
// whether a limit window's toggle starts "on". Accepts either a trader-native
// detail (snake_case) or an NGO account (camelCase).
function configuredCaps(d) {
  return [
    { key: 'hourly', label: 'Hourly', cap: d.hourly_limit_amount ?? d.hourlyLimitAmount, used: d.usage?.hourly_amount_total },
    { key: 'daily', label: 'Daily', cap: d.daily_limit_amount ?? d.dailyLimitAmount, used: d.usage?.daily_amount_total },
    { key: 'weekly', label: 'Weekly', cap: d.weekly_limit ?? d.weeklyLimit, used: d.usage?.weekly_amount_total },
    { key: 'monthly', label: 'Monthly', cap: d.monthly_limit ?? d.monthlyLimit, used: d.usage?.monthly_amount_total },
  ].filter((w) => w.cap != null);
}

// Small pill: grey/none when no amount cap is configured, a distinct color
// when at least one is. Hover/tap shows cap vs real used-amount for every
// configured window (traderController.listPaymentDetails now computes real
// hour/day/week/month totals via the same computeWindowUsage() the routing
// engine enforces against — see usageWindows.js). NGO/web accounts have no
// `usage` object at all (ngo-backend doesn't track spend), so they still get
// an honest caveat instead of a fabricated number.
function LimitBadge({ d }) {
  const caps = configuredCaps(d);
  if (caps.length === 0) {
    return <span className="inline-block h-2 w-2 rounded-full bg-gray-600" title="No limits configured" />;
  }
  const lines = caps.map((w) => (
    w.used != null
      ? `${w.label} cap ${fmtINR(w.cap)} · ${fmtINR(w.used)} used`
      : `${w.label} cap ${fmtINR(w.cap)} (usage not tracked for this account)`
  ));
  return <span className="inline-block h-2 w-2 rounded-full bg-sky-400" title={lines.join('\n')} />;
}

const platformNames = {
  paytm: 'Paytm Business',
  phonepe: 'PhonePe Business',
  gpay: 'GPay Business',
  bharatpe: 'BharatPe Business',
  amazonpay: 'Amazon Pay Business',
  other: 'Other UPI',
};

// Mask an NGO UPI id the same way maskUpi handles trader UPIs.
const platformLabel = (p) => platformNames[p] || p || 'UPI';

// Canonical provider registry — reconciles account_type (MySQL,
// trader-native payment_details, e.g. saved via the APK wizard) and
// platform (Mongo, ngo-backend Account, saved via Web Login) values for
// the SAME real-world provider, so the two can be grouped into one card
// instead of the two separate, never-joined lists this used to be. The
// two storage schemas keep their own raw values as-is (MySQL's
// account_type is a fixed ENUM, not worth a migration just for display
// grouping) — only this merged view needs one shared key.
//
// BharatPe is the one real mismatch found: MySQL stores 'bharat_pe',
// Mongo stores 'bharatpe'. BankBadge (ui.jsx) already aliases both to
// the identical visual, so either canonical spelling renders the same —
// 'bharat_pe' is picked here since that's the side that can't be
// changed without a DB migration.
const PLATFORM_TO_CANONICAL = { bharatpe: 'bharat_pe' };
const canonicalProviderKey = (raw) => PLATFORM_TO_CANONICAL[raw] || raw || 'other';
const canonicalProviderLabel = (key) => ACCOUNT_TYPES[key]?.label || platformNames[key] || key || 'UPI';

// Visual treatment per NGO Account.status. 'paused' used to be ambiguous —
// manual pause, a genuine OTP request, and a dead session all wrote the same
// status value — statusReason now disambiguates it, so the label (and the
// OTP box's visibility, see showingOtp above) reflects the real cause.
// `color` matches the shared Badge component's palette — rendered via
// <Badge color={meta.color}>{meta.label}</Badge> everywhere this is used,
// instead of a hand-rolled span, so "gray" already resolves through Badge's
// own token-aware BADGE_HEX map rather than a hardcoded dark-mode class.
const NGO_STATUS_META = {
  live: { label: 'Live', color: 'green' },
  pending: { label: 'Connecting…', color: 'amber' },
  failed: { label: 'Connection failed', color: 'red' },
};
const PAUSED_REASON_META = {
  manual_pause: { label: 'Paused', color: 'gray' },
  otp_required: { label: 'Waiting for OTP', color: 'amber' },
  session_expired: { label: 'Session expired', color: 'red' },
};
const ngoStatusMeta = (status, statusReason) => {
  if (status === 'paused') {
    return PAUSED_REASON_META[statusReason] || { label: 'Paused', color: 'gray' };
  }
  return NGO_STATUS_META[status] || { label: status || 'Unknown', color: 'gray' };
};

// ---------------------------------------------------------------------------
// Accounts — provider-grouped, collapsible (matches MaxPayDesign's
// "All payment accounts" inventory panel structurally: one list, grouped by
// provider, bulk controls in the group header, individual controls inside
// the expand). Folds what used to be two side-by-side columns (a coarse
// "Offers" bulk-toggle view and a separate flat "Details" row list) into one
// — the two were rendering the same `details` array twice. Every handler
// below is unchanged from those two components, only relocated.
// ---------------------------------------------------------------------------
/**
 * Link a paired device to an EXISTING payment detail, in place.
 *
 * BUG-27: the previous "Link a device" action navigated to the Smartphones
 * page, which lists devices but offers no way to attach one to the account the
 * trader was looking at — a dead end with no route back. This reuses the same
 * picker the Add Payment Detail wizard uses and writes ngo_device_id straight
 * onto this detail, so the fix happens where the problem is reported.
 */
function LinkDeviceModal({ detail, onClose, onLinked }) {
  const navigate = useNavigate();
  const { devices, loading } = useDevices();
  const [selected, setSelected] = useState(detail?.ngo_device_id ? String(detail.ngo_device_id) : '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await traderApi.updatePaymentDetail(detail.id, { ngo_device_id: selected });
      const dev = devices.find((x) => String(x.id) === String(selected));
      toast(
        dev && dev.online
          ? `Linked to ${deviceLabel(dev)} — it should start receiving orders shortly`
          : `Linked to ${dev ? deviceLabel(dev) : 'the device'}. It is offline right now, so orders will not route until it comes back online.`,
        dev && dev.online ? 'success' : 'info'
      );
      await onLinked();
      onClose();
    } catch (e) {
      toast(apiError(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open title="Link a device" onClose={onClose} width={460}
      subtitle={`${detail.account_name || 'Untitled'} · ${detail.upi_id || ''}`}>
      <p className="mb-3 text-xs" style={{ color: 'var(--muted)' }}>
        The APK on the selected phone detects payments arriving on this UPI. Orders
        are only routed here while that device is genuinely online.
      </p>
      <DevicePicker
        devices={devices}
        loading={loading}
        selectedId={selected}
        onSelect={setSelected}
        onPairNew={() => navigate('/smartphones')}
        emptyMessage="No paired devices yet — pair a smartphone first, then link it here."
      />
      <div className="mt-5 flex items-center justify-between">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={!selected || saving}>
          {saving ? 'Linking…' : 'Link device'}
        </Button>
      </div>
    </Modal>
  );
}

function AccountsColumn({
  details, onToggle, onBulkToggle, onLink, onEdit, onAdd,
  ngoAccounts = [], onToggleNGO, onDeleteNGO, onRetryNGO,
  otpValues, onOtpChange, onSubmitOtp, otpBusyId,
  linkBlocked = {}, linkChecking = null, onReconnect, onLinkDevice, ngoToggleBusyId,
  deviceLiveMap = {}, ngoAliveMap = {}, deviceNames = {},
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all'); // all | active | inactive
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [menu, setMenu] = useState(null);

  const unlinkedCount = useMemo(() => details.filter(notLinked).length, [details]);

  const filteredDetails = useMemo(() => {
    const q = query.trim().toLowerCase();
    return details.filter((d) => {
      if (filter === 'active' && !d.is_active_detail) return false;
      if (filter === 'inactive' && d.is_active_detail) return false;
      if (onlyUnlinked && !notLinked(d)) return false;
      if (!q) return true;
      return (d.account_name || '').toLowerCase().includes(q) || (d.upi_id || '').toLowerCase().includes(q);
    });
  }, [details, query, filter, onlyUnlinked]);

  // Exclude Web Login mirror rows from the native side of the merged grouping
  // below so the same real account isn't rendered twice — once as its own ngo
  // Account, once as its payment_details shadow copy. See mirroredDetailIds
  // for why this can't key on gatewayPaymentDetailId alone.
  const mirrored = useMemo(() => mirroredDetailIds(details, ngoAccounts), [details, ngoAccounts]);

  // ONE grouping, keyed by canonical provider — merges trader-native
  // payment_details rows (account_type) and ngo Account rows (platform)
  // into a single card per real-world provider. These used to be two
  // separate, never-joined lists (`groups`/`ngoGroups`), so the same
  // provider (e.g. Paytm) rendered as two cards whenever accounts existed
  // on both sides — see canonicalProviderKey's comment for why a raw
  // string comparison wasn't enough (BharatPe's mismatched spelling).
  const providerGroups = useMemo(() => {
    const nativeItems = filteredDetails.filter((d) => !mirrored.has(String(d.id)));

    const q = query.trim().toLowerCase();
    const ngoItems = ngoAccounts.filter((a) => {
      if (onlyUnlinked) return false;
      if (filter === 'active' && a.status !== 'live') return false;
      if (filter === 'inactive' && a.status === 'live') return false;
      if (!q) return true;
      return (a.displayName || '').toLowerCase().includes(q) || (a.upiId || '').toLowerCase().includes(q);
    });

    const map = {};
    const bucket = (key) => (map[key] = map[key] || { key, label: canonicalProviderLabel(key), nativeItems: [], ngoItems: [] });
    for (const d of nativeItems) bucket(canonicalProviderKey(d.account_type)).nativeItems.push(d);
    for (const a of ngoItems) bucket(canonicalProviderKey(a.platform)).ngoItems.push(a);

    return Object.values(map).map((g) => ({ ...g, mapKey: `provider-${g.key}` }));
  }, [filteredDetails, mirrored, ngoAccounts, query, filter, onlyUnlinked]);

  // Groups are OPEN by default (real traders have a handful of accounts, not
  // MaxPayDesign's 230) — `expanded[key] === false` is the only closed state.
  const isOpen = (key) => expanded[key] !== false;
  const toggleOpen = (key) => setExpanded((x) => ({ ...x, [key]: !isOpen(key) }));

  // A search/filter is active whenever it could hide a group's contents by
  // leaving it collapsed. Force-open any group with a real match so a live
  // search never silently hides results inside a closed card.
  const filterActive = query.trim() !== '' || filter !== 'all' || onlyUnlinked;
  useEffect(() => {
    if (!filterActive) return;
    setExpanded((cur) => {
      let changed = false;
      const next = { ...cur };
      for (const g of providerGroups) {
        if ((g.nativeItems.length + g.ngoItems.length) > 0 && next[g.mapKey] === false) { next[g.mapKey] = true; changed = true; }
      }
      return changed ? next : cur;
    });
  }, [filterActive, providerGroups]);

  const renderDetailRow = (d) => {
    const dot = limitDot(d);
    const exhausted = isExhausted(d);
    const unlinked = notLinked(d);
    const highlight = exhausted || unlinked;
    // Real connection state, shared with the Live pool and the dashboard
    // counts (utils/accountState.js). This used to key off deviceLiveMap,
    // which only ever knew about accounts that had an ngo_device_id — so an
    // account with no connection at all rendered a neutral robot icon rather
    // than saying it was not connected.
    const state = accountState(d);
    const meta = STATE_META[state];
    const kind = resolveConnType(d, ngoAccounts);
    const webOwner = webOwnerOf(d, ngoAccounts);
    return (
      <div
        key={d.id}
        className="rounded-lg px-3 py-2.5"
        style={highlight
          ? { border: '1px solid rgba(245,158,11,.4)', background: 'rgba(245,158,11,.05)' }
          : { border: '1px solid var(--cardborder)', background: 'var(--hover)' }}
      >
        <div className="flex items-center gap-3">
          {/* ON/OFF toggle (red off / green on) */}
          <Toggle checked={!!d.is_active_detail} onChange={() => onToggle(d)} />

          {/* Real connection state: Live / Reconnect needed / Manual / Not
              connected / Off. "Off" stays visually calm — it's a normal
              trader choice, not a fault. */}
          <span
            title={meta.title}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: `${meta.hex}22`, color: meta.hex }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.hex, flexShrink: 0 }} />
            {meta.label}
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" style={{ color: 'var(--text)' }}>{d.account_name || 'Untitled'}</p>
            <p className="truncate text-xs" style={{ color: 'var(--muted)' }}>
              {d.upi_id}
              {/* The actual thing this account is connected through — the
                  paired phone by name, or the web session. Previously only a
                  generic type icon was shown, so "paired to a device that no
                  longer exists" was indistinguishable from "properly paired". */}
              <span style={{ opacity: 0.75 }}>
                {' · '}
                {connType(d) === 'web'
                  ? 'Web Login session'
                  : (d.ngo_device_id && deviceNames[d.ngo_device_id]) || 'Not linked'}
              </span>
            </p>
          </div>

          {/* connection-type icon (apk=android/teal · web=globe/coral) */}
          <ConnTypeIcon type={connType(d)} size={24} />

          {/* limit badge (any amount cap configured) */}
          <LimitBadge d={d} />

          {/* limit dot + Day label */}
          <div className="flex flex-col items-center" title={dot.title}>
            <span className={`h-2.5 w-2.5 rounded-full ${dot.cls}`} />
            <span className="mt-0.5 text-[10px]" style={{ color: 'var(--muted)' }}>Day</span>
          </div>

          <button onClick={() => onEdit(d)} className="tf-hbtn" style={{ width: 30, height: 30 }} aria-label="Edit detail">
            <IconEdit className="h-4 w-4" />
          </button>
        </div>

        {/* inline warning + action */}
        {highlight && (
          <div className="mt-2 space-y-1.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span style={{ color: '#fcd34d' }}>
                {exhausted ? 'Limit exhausted' : 'Not receiving orders'}
              </span>
              {exhausted ? (
                <button onClick={() => onEdit(d)} className="rounded-md px-2 py-0.5 font-medium" style={{ border: '1px solid rgba(245,158,11,.4)', color: '#fcd34d' }}>
                  Update limit
                </button>
              ) : (
                <button
                  onClick={() => onLink(d)}
                  disabled={linkChecking === d.id}
                  className="whitespace-nowrap rounded-md px-2 py-0.5 font-medium disabled:opacity-50"
                  style={{ border: '1px solid rgba(245,158,11,.4)', color: '#fcd34d' }}
                >
                  {linkChecking === d.id ? 'Checking…' : 'Link'}
                </button>
              )}
            </div>
            {/* Readiness gate: the last Link attempt found no live
                data source (device heartbeat / web session), so
                the link was blocked instead of silently proceeding. */}
            {!exhausted && linkBlocked[d.id] && (
              <div className="flex items-center justify-between gap-2 rounded-md px-2 py-1" style={{ border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.1)' }}>
                <span style={{ color: '#fca5a5' }}>{linkBlocked[d.id].message}</span>
                <button
                  onClick={() => onReconnect(linkBlocked[d.id])}
                  className="whitespace-nowrap rounded-md px-2 py-0.5 font-medium"
                  style={{ border: '1px solid rgba(239,68,68,.4)', color: '#fca5a5' }}
                >
                  {linkBlocked[d.id].actionLabel}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Connection-state recovery. Distinct from the `highlight` block
            above (which is about limits and the admin linkage flag) — this is
            purely about whether anything is actually connected, and offers the
            one action that fixes it. Deliberately NOT a second toggle: the
            trader's intent is already expressed by the switch on this row. */}
        {(state === ACCOUNT_STATE.RECONNECT || state === ACCOUNT_STATE.NEVER) && (
          <div
            className="mt-2 flex items-center justify-between gap-2 rounded-md px-2 py-1 text-xs"
            style={{ border: `1px solid ${meta.hex}55`, background: `${meta.hex}14` }}
          >
            {/* Wording follows how this account is ACTUALLY set up. A web
                account was never told to "link a device", and an APK one is
                never pointed at a Web Login it doesn't have. */}
            <span style={{ color: meta.hex }}>
              {kind === 'web'
                ? `Session disconnected — reconnect your ${platformLabel(webOwner?.platform) || 'provider'} login.`
                : state === ACCOUNT_STATE.RECONNECT
                  ? 'Device not responding — reconnect the paired phone.'
                  : 'Not connected — link a device.'}
            </span>
            <button
              onClick={() => (kind === 'web'
                ? onReconnect({ kind: 'web', account: webOwner || null })
                : onLinkDevice(d))}
              className="whitespace-nowrap rounded-md px-2 py-0.5 font-medium"
              style={{ border: `1px solid ${meta.hex}88`, color: meta.hex }}
            >
              {kind === 'web' ? 'Reconnect' : (state === ACCOUNT_STATE.RECONNECT ? 'Change device' : 'Link a device')}
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderNgoRow = (a) => {
    const live = a.status === 'live';
    // `a.status` is a CACHED field in Mongo that the 60s monitor loop updates,
    // so it lags reality by up to a minute — and a Web Login account whose
    // browser session has died can sit at 'live' indefinitely. The Live pool
    // table on this same page reads the real mirrored connection_alive, so
    // the two disagreed: one said Live, the other said Reconnect needed, for
    // the same account at the same moment.
    //
    // Resolve against the same evidence the Live pool uses — the mirrored
    // payment_details row's connection_alive — falling back to the direct
    // SessionStore poll. Only the "claims live but isn't" case is overridden;
    // pending / failed / OTP-required keep their existing meta and flows.
    const mirror = details.find(
      (d) => String(d.upi_id || '').trim().toLowerCase() === String(a.upiId || '').trim().toLowerCase()
    );
    const reallyDead = mirror
      ? mirror.connection_alive === false
      : ngoAliveMap[a._id] === false;
    const meta = live && reallyDead
      ? { label: STATE_META[ACCOUNT_STATE.RECONNECT].label, color: 'amber' }
      : ngoStatusMeta(a.status, a.statusReason);
    // 'paused' alone is ambiguous — manual pause, a genuine OTP
    // request, and a dead session all set the same status value
    // (see statusReason, added specifically to disambiguate).
    // Only show the OTP box when it's actually an OTP request.
    const showingOtp = a.status === 'paused' && a.statusReason === 'otp_required';
    const otpVal = otpValues[a._id] || '';
    const otpBusy = otpBusyId === a._id;
    return (
      <div key={a._id} className="rounded-lg px-3 py-2.5" style={{ border: '1px solid var(--cardborder)', background: 'var(--hover)' }}>
        <div className="flex items-center gap-3">
          <span title={live ? undefined : 'Turning this on attempts to reconnect'}>
            <Toggle checked={live} disabled={ngoToggleBusyId === a._id} onChange={() => onToggleNGO(a)} />
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" style={{ color: 'var(--text)' }}>{a.displayName || 'Untitled'}</p>
            <p className="truncate text-xs" style={{ color: 'var(--muted)' }}>{a.upiId}</p>
          </div>

          {/* connection-type icon (apk=android/teal · web=globe/coral) */}
          <ConnTypeIcon type={a.connectionType === 'web' ? 'web' : 'apk'} size={24} />

          {/* limit badge (any amount cap configured) */}
          <LimitBadge d={a} />

          {/* connection-status badge: pending/paused/failed/live */}
          <Badge color={meta.color}>{meta.label}</Badge>

          {/* The small red dot that used to sit here signalled exactly this
              condition, but next to a badge still reading "Live" — so the row
              contradicted itself. The badge above now carries the real state,
              and the banner below carries the action. */}

          <span title={live ? undefined : 'Available once connected'}>
            <button
              onClick={() => onEdit(ngoAccountToEditable(a))}
              disabled={!live}
              className="tf-hbtn disabled:cursor-not-allowed disabled:opacity-40"
              style={{ width: 30, height: 30 }}
              aria-label="Edit detail"
            >
              <IconEdit className="h-4 w-4" />
            </button>
          </span>

          {a.status === 'failed' && (
            <button
              onClick={() => onRetryNGO(a)}
              disabled={otpBusy}
              className="whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium disabled:opacity-50"
              style={{ border: '1px solid rgba(239,68,68,.4)', color: '#fca5a5' }}
            >
              Retry
            </button>
          )}

          <button
            onClick={() => onDeleteNGO(a)}
            className="tf-hbtn"
            style={{ width: 30, height: 30, color: '#ef4444' }}
            aria-label="Delete account"
          >
            <IconTrash className="h-4 w-4" />
          </button>
        </div>

        {showingOtp && (
          <div className="mt-2 flex items-center gap-2 pt-2" style={{ borderTop: '1px solid var(--cardborder)' }}>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={otpVal}
              onChange={(e) => onOtpChange(a._id, e.target.value.replace(/\D/g, ''))}
              placeholder="6-digit OTP"
              disabled={otpBusy}
              className="w-28 rounded-md px-2 py-1 text-center text-sm tracking-widest outline-none"
              style={{ border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text)' }}
            />
            <button
              onClick={() => onSubmitOtp(a._id)}
              disabled={otpBusy || otpVal.length !== 6}
              className="rounded-md px-2 py-1 text-xs font-medium disabled:opacity-50"
              style={{ border: '1px solid rgba(34,197,94,.4)', color: '#6ee7b7' }}
            >
              Verify
            </button>
          </div>
        )}

        {/* Same inline recovery the trader-native rows get, so a dead web
            session is actionable from where it's reported. */}
        {live && reallyDead && (
          <div
            className="mt-2 flex items-center justify-between gap-2 rounded-md px-2 py-1 text-xs"
            style={{ border: '1px solid rgba(245,158,11,.35)', background: 'rgba(245,158,11,.12)' }}
          >
            {/* BUG-26: a Web Login row talks about its session, never about
                devices. This is the row a mirrored web account actually
                renders as, so the wording has to be right here too. */}
            <span style={{ color: '#f59e0b' }}>
              Session disconnected — reconnect your {platformLabel(a.platform)} login.
            </span>
            <button
              onClick={() => onReconnect({ kind: 'web', account: a })}
              className="whitespace-nowrap rounded-md px-2 py-0.5 font-medium"
              style={{ border: '1px solid rgba(245,158,11,.6)', color: '#f59e0b' }}
            >
              Reconnect
            </button>
          </div>
        )}
      </div>
    );
  };

  const noResults = providerGroups.length === 0;

  return (
    <Card className="flex flex-col">
      <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--cardborder)' }}>
        <div>
          <div className="flex items-center gap-2">
            <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: 0 }}>All Payment Accounts</h2>
            <Badge color="gray">{distinctAccounts(details, ngoAccounts)}</Badge>
          </div>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>Grouped by provider for fast management</p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={filter}
            onChange={(v) => { setFilter(v); setOnlyUnlinked(false); }}
            options={[
              { value: 'all', label: 'All' },
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
            className="w-28"
          />
          <button onClick={() => onAdd(null)} className="tf-hbtn" aria-label="Add detail">
            <IconPlus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="p-4">
        <SearchInput value={query} onChange={setQuery} placeholder="Search account or UPI…" />

        {unlinkedCount > 0 && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg p-3" style={{ border: '1px solid rgba(245,158,11,.3)', background: 'rgba(245,158,11,.1)' }}>
            <div className="flex items-center gap-2 text-sm" style={{ color: '#fcd34d' }}>
              <IconWarning className="h-4 w-4 flex-shrink-0" />
              <span>You have active payment details that are not participating in transactions.</span>
            </div>
            <button
              onClick={() => setOnlyUnlinked((v) => !v)}
              className="rounded-md px-2.5 py-1 text-xs font-medium"
              style={{ border: '1px solid rgba(245,158,11,.4)', color: '#fcd34d' }}
            >
              {onlyUnlinked ? 'Show all' : 'Show'}
            </button>
          </div>
        )}

        <div className="mt-4 space-y-3">
          {providerGroups.map((g) => {
            const open = isOpen(g.mapKey);
            const activeCount = g.nativeItems.filter((d) => d.is_active_detail).length;
            const liveCount = g.ngoItems.filter((a) => a.status === 'live').length;
            const totalCount = g.nativeItems.length + g.ngoItems.length;
            const totalActiveLike = activeCount + liveCount;
            return (
              <div key={g.mapKey} className="rounded-lg" style={{ border: '1px solid var(--cardborder)', background: 'var(--hover)' }}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleOpen(g.mapKey)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleOpen(g.mapKey); } }}
                  className="flex w-full cursor-pointer items-center gap-3 p-3 text-left"
                >
                  <BankBadge type={g.key} label={g.label} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{g.label}</p>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>{totalCount} account{totalCount === 1 ? '' : 's'} · {totalActiveLike} active</p>
                  </div>
                  {/* The group-level Toggle that used to sit here is gone.
                      Two real defects, either one disqualifying:

                      1. Its checked state was `some(is_active_detail)`, so in
                         any mixed group it rendered ON and a click could only
                         ever turn everything OFF — there was no way to
                         bulk-enable a partially-enabled group at all.
                      2. More seriously, it wrote is_active_detail directly and
                         bypassed linkIfLive, the readiness check the per-row
                         toggle runs before admitting an account. That is
                         exactly the "enters the pool without a confirmed live
                         connection" path the liveness work exists to close.

                      Per-account toggles cover the same ground and enforce the
                      check, so this is a removal rather than a rewrite. */}
                  {g.nativeItems.length > 0 && (
                    <div className="relative" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => setMenu(menu === g.mapKey ? null : g.mapKey)}
                        className="tf-hbtn"
                        style={{ width: 28, height: 28, display: 'flex' }}
                        aria-label="Group menu"
                      >
                        <IconDots className="h-4 w-4" />
                      </button>
                      {menu === g.mapKey && (
                        <div
                          className="absolute right-0 z-10 mt-1 w-40 rounded-lg py-1"
                          style={{ border: '1px solid var(--cardborder)', background: 'var(--card)', boxShadow: 'var(--shadow)' }}
                        >
                          {/* "Enable all" removed for the same reason as the
                              group toggle: bulk-enabling skips the per-account
                              liveness check. "Disable all" stays — turning
                              accounts OFF can never admit an unconnected
                              account, so it bypasses no safety gate. */}
                          <button
                            onClick={() => { onBulkToggle(g.nativeItems, false); setMenu(null); }}
                            className="tf-row-hover block w-full px-3 py-1.5 text-left text-xs"
                            style={{ color: 'var(--text)' }}
                          >
                            Disable all
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  <IconChevron className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--muted)', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
                </div>

                {open && (
                  <div className="space-y-2 px-3 pb-3">
                    {g.nativeItems.map(renderDetailRow)}
                    {g.ngoItems.map(renderNgoRow)}
                    <button
                      onClick={() => onAdd(BANKS.find((b) => b.type === g.key) || null)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium"
                      style={{ border: '1px dashed var(--cardborder)', color: 'var(--muted)' }}
                    >
                      <IconPlus className="h-3.5 w-3.5" /> Add to {g.label}
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {noResults && (
            <p className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>
              {details.length === 0 && ngoAccounts.length === 0 ? 'No payment accounts yet — add one to start receiving payments.' : 'No accounts match your filter.'}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function Offers() {
  const navigate = useNavigate();
  const [details, setDetails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [presetBank, setPresetBank] = useState(null);
  const [editing, setEditing] = useState(null);
  const [ngoAccounts, setNgoAccounts] = useState([]);
  const [ngoLoading, setNgoLoading] = useState(false);
  // Refs so the polling/socket effects below (deliberately mounted once,
  // empty dep array) always see current state without re-subscribing.
  const detailsRef = useRef(details);
  useEffect(() => { detailsRef.current = details; }, [details]);
  const ngoAccountsRef = useRef(ngoAccounts);
  useEffect(() => { ngoAccountsRef.current = ngoAccounts; }, [ngoAccounts]);

  const load = async () => {
    try {
      const res = await traderApi.paymentDetails();
      const next = res?.data?.data?.payment_details || [];
      announceDeadTransitions(detailsRef.current, next);
      setDetails(next);
    } catch (e) {
      // A transient fetch failure must not blank the list — that would look
      // identical to "the trader has no accounts".
      setDetails((prev) => (prev.length ? prev : []));
    } finally {
      setLoading(false);
    }
  };

  // A connection dropping is the exact failure the routing-liveness work
  // exists to catch, so it can't be left to a badge quietly changing colour
  // on a page the trader may not be looking at. Fires once per account, on
  // the transition into dead — not on every poll while it stays dead.
  const announceDeadTransitions = (prev, next) => {
    if (!prev || !prev.length) return; // first load is not a transition
    const was = new Map(prev.map((d) => [d.id, d]));
    for (const d of next) {
      const before = was.get(d.id);
      if (!before) continue;
      const wentDead = before.connection_alive === true && d.connection_alive === false;
      // Only worth telling them about if the account is switched on: a dead
      // connection on an account they deliberately turned off is not news.
      if (wentDead && d.is_active_detail) {
        toast(`${d.account_name || d.upi_id} lost its connection — no orders are being routed to it`, 'error');
      }
    }
  };

  // Poll on the same cadence the backend mirrors liveness at
  // (jobs/connectionLiveness.js, 15s). Without this, connection_alive changed
  // in the database and nothing on this page ever noticed: the badge, the
  // counts and the Live pool all kept rendering whatever was true at page
  // load, which is how a dead account could keep showing "Live".
  useEffect(() => {
    load();
    const id = setInterval(load, LIVE_ICON_POLL_MS);
    return () => clearInterval(id);
  }, []);

  // Real today's-volume figure for the Live Pool card's summary strip — same
  // /trader/dashboard field (today_volume_inr) Dashboard.jsx's own
  // LivePoolSection instance already reads. Nothing else from that endpoint
  // is needed here, so only this one field is kept.
  const [todayVolumeInr, setTodayVolumeInr] = useState(0);
  useEffect(() => {
    traderApi.dashboard()
      .then((res) => setTodayVolumeInr(res?.data?.data?.today_volume_inr ?? 0))
      .catch(() => {});
  }, []);

  // NGO accounts come from the NGO backend (port 3000) via ngoApi. If that
  // server is unreachable, we degrade gracefully to an empty list.
  const loadNGOAccounts = async () => {
    setNgoLoading(true);
    try {
      const data = await getAccounts();
      setNgoAccounts(data || []);
      // Backfill: accounts saved before the routing-sync bridge existed have
      // no mirror yet. Create one now, in the background, so they become
      // assignable to orders without requiring the trader to re-open/edit
      // them. Self-limiting — once linked, gatewayPaymentDetailId is set and
      // this filter skips them on the next load.
      (data || [])
        .filter((a) => !a.gatewayPaymentDetailId)
        .forEach((a) => {
          syncNgoAccountToPaymentDetail(a).catch((e) => console.error('Backfill sync failed for', a._id, e));
        });
    } catch (e) {
      console.log('NGO load error:', e.message);
      setNgoAccounts([]);
    } finally {
      setNgoLoading(false);
    }
  };

  useEffect(() => {
    loadNGOAccounts();
    // The Web Login modal fires this after a successful save.
    window.addEventListener('ngo-account-added', loadNGOAccounts);
    return () => window.removeEventListener('ngo-account-added', loadNGOAccounts);
  }, []);

  // Poll while any account is still settling (pending = scraper session
  // starting, paused = awaiting OTP) so the trader sees it flip to
  // live/failed without a manual refresh. Stops once nothing is in flight.
  const hasPendingNgoAccounts = useMemo(
    () => ngoAccounts.some((a) => a.status === 'pending' || a.status === 'paused'),
    [ngoAccounts]
  );
  useEffect(() => {
    if (!hasPendingNgoAccounts) return undefined;
    const id = setInterval(loadNGOAccounts, 5000);
    return () => clearInterval(id);
  }, [hasPendingNgoAccounts]);

  // ---------------------------------------------------------------------
  // Item 5: real device liveness for the APK "robot" icon — same source
  // and ~15s online window the Smartphones page's own dot uses, polled
  // continuously so the icon (and the auto-unlink below) track a device
  // going offline in real time, not just at page load / Link click.
  // Item 4 (APK half): reuses this exact poll to detect a linked, active
  // device going offline and auto-flips is_active back to false.
  // ---------------------------------------------------------------------
  const [deviceLiveMap, setDeviceLiveMap] = useState({});
  // Real device NAMES, from the same poll — so a row can name the phone it's
  // actually paired to instead of just showing a generic connection-type icon.
  const [deviceNameMap, setDeviceNameMap] = useState({});
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      let list;
      try {
        list = await getDevices();
      } catch (e) {
        return; // transient fetch failure — keep the last-known map
      }
      if (cancelled) return;
      const names = {};
      (list || []).forEach((dev) => {
        // Trader-assigned name, else the hardware model. A device reporting
        // neither is left out entirely so the row says "Not linked" rather
        // than inventing a label for it.
        const n = (dev.deviceName || dev.deviceModel || '').trim();
        if (n) names[dev.id] = n;
      });
      setDeviceNameMap(names);
      const map = {};
      (list || []).forEach((dev) => { map[dev.id] = !!dev.online; });
      setDeviceLiveMap((prev) => {
        Object.keys(prev).forEach((devId) => {
          if (prev[devId] && !map[devId]) {
            detailsRef.current
              .filter((d) => d.ngo_device_id === devId && d.is_active)
              .forEach((d) => {
                patch(d, { is_active: false });
                toast(`${d.account_name || d.upi_id} went offline — unlinked from its Offer`, 'error');
              });
          }
        });
        return map;
      });
    };
    poll();
    const id = setInterval(poll, LIVE_ICON_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);


  // ---------------------------------------------------------------------
  // Item 5 (web half): real SessionStore.isSessionAlive for accounts the DB
  // currently says are 'live' — catches the case where the session died but
  // the periodic monitor (webScraper.js, 60s cadence) hasn't caught up yet.
  // ---------------------------------------------------------------------
  const [ngoAliveMap, setNgoAliveMap] = useState({});
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const liveWebAccounts = ngoAccountsRef.current.filter((a) => a.status === 'live' && a.connectionType === 'web');
      if (liveWebAccounts.length === 0) return;
      const entries = await Promise.all(liveWebAccounts.map(async (a) => {
        try {
          const res = await getAccountStatus(a._id);
          return [a._id, !!res.isAlive];
        } catch (e) {
          return [a._id, null]; // unknown — don't assume offline on a fetch error
        }
      }));
      if (cancelled) return;
      setNgoAliveMap((prev) => {
        const next = { ...prev };
        entries.forEach(([id, alive]) => { if (alive !== null) next[id] = alive; });
        return next;
      });
    };
    poll();
    const id = setInterval(poll, LIVE_ICON_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // A Web Login account whose cached Mongo status still says 'live' but whose
  // real session is gone. Same evidence renderNgoRow resolves the badge with:
  // the mirrored payment_details row's connection_alive first (that is what
  // the Live pool reads), the direct SessionStore poll as a fallback.
  const ngoReallyDead = useCallback((a) => {
    if (a.status !== 'live') return false;
    const mirror = details.find(
      (d) => String(d.upi_id || '').trim().toLowerCase() === String(a.upiId || '').trim().toLowerCase()
    );
    return mirror ? mirror.connection_alive === false : ngoAliveMap[a._id] === false;
  }, [details, ngoAliveMap]);

  // Counted once per real account: mirror rows are excluded from the native
  // side so an account that exists on both sides can't inflate the figure.
  const needsAttentionCount = useMemo(() => {
    const mirrored = mirroredDetailIds(details, ngoAccounts);
    const native = details.filter(
      (d) => !mirrored.has(String(d.id))
        && (notLinked(d) || accountState(d) === ACCOUNT_STATE.RECONNECT)
    ).length;
    const ngo = ngoAccounts.filter(
      (a) => a.status === 'failed'
        || (a.status === 'paused' && a.statusReason === 'otp_required')
        || ngoReallyDead(a)
    ).length;
    return native + ngo;
  }, [details, ngoAccounts, ngoReallyDead]);

  // Item 4 (web half): auto-unlink on a REAL session-death push — the
  // existing account-status socket event webScraper.js already emits when
  // its monitor gives up (after item 3's auto-reconnect attempt fails), not
  // a new detection mechanism. Joins via a verified service token (see
  // ngoApi.js's getNgoSocketToken) — ngo-backend places this socket in this
  // real trader's own room server-side, not a client-supplied ngoId.
  useEffect(() => {
    let socket;
    let cancelled = false;

    getNgoSocketToken().then((serviceToken) => {
      if (cancelled) return;
      socket = io(NGO_SOCKET_ORIGIN, { auth: { serviceToken } });
      socket.on('account-status', ({ accountId, status }) => {
        if (status !== 'session_expired') return;
        const account = ngoAccountsRef.current.find((a) => a._id === accountId);
        loadNGOAccounts();
        if (account?.gatewayPaymentDetailId) {
          traderApi
            .updatePaymentDetail(account.gatewayPaymentDetailId, { is_active: false })
            .catch((e) => console.error('Auto-unlink sync failed:', e));
          toast(`${account.displayName || account.upiId || 'Account'} session expired — unlinked from its Offer`, 'error');
        }
      });
    }).catch((e) => console.error('Could not start account-status socket:', e.message));

    return () => {
      cancelled = true;
      socket?.disconnect();
    };
  }, []);

  // Busy-disables an NGO account's toggle while a request is in flight — the
  // toggle no longer requires status==='live' to be clickable (turning ON is
  // now itself the reconnect action), so this replaces the old disabled={!live}
  // guard to still stop a double-click firing two concurrent reconnects.
  const [ngoToggleBusyId, setNgoToggleBusyId] = useState(null);

  // Turning OFF: unconditional. The backend's /toggle route now really closes
  // the live session (SessionStore.removeSession), not just a status flip.
  // Turning ON: the backend attempts a real cookie-first reconnect for a
  // web-login account with no live session (initiateLogin) as part of the
  // same request — this IS the linking action now (item 4): the mirrored
  // payment_detail's is_active only gets set true if the account actually
  // reached 'live', never optimistically.
  const toggleNGO = async (account) => {
    const turningOn = account.status !== 'live';
    const newStatus = turningOn ? 'live' : 'paused';
    setNgoToggleBusyId(account._id);
    if (!turningOn) {
      setNgoAccounts((list) => list.map((a) => (a._id === account._id ? { ...a, status: 'paused', statusReason: 'manual_pause' } : a)));
    }
    try {
      const { account: fresh, reconnect } = await toggleAccount(account._id, newStatus);
      setNgoAccounts((list) => list.map((a) => (a._id === account._id ? fresh : a)));

      if (account.gatewayPaymentDetailId) {
        const reallyLive = fresh.status === 'live';
        traderApi
          .updatePaymentDetail(account.gatewayPaymentDetailId, {
            is_active_detail: turningOn ? true : false,
            is_active: turningOn ? reallyLive : false,
          })
          .catch((e) => console.error('Routing sync failed:', e));
      }

      if (turningOn && fresh.status !== 'live') {
        if (fresh.statusReason === 'otp_required') {
          toast('OTP required — check the phone linked to this account', 'info');
        } else if (reconnect && reconnect.success === false) {
          toast(reconnect.message || 'Reconnect failed — try again', 'error');
        }
      }
    } catch (e) {
      toast(e.message, 'error');
      loadNGOAccounts();
    } finally {
      setNgoToggleBusyId(null);
    }
  };

  const [deleteNgoTarget, setDeleteNgoTarget] = useState(null);
  const [deletingNgo, setDeletingNgo] = useState(false);
  const deleteNGO = (account) => setDeleteNgoTarget(account);

  const confirmDeleteNGO = async () => {
    const account = deleteNgoTarget;
    if (!account) return;
    setDeletingNgo(true);
    try {
      await deleteAccount(account._id);
      setNgoAccounts((list) => list.filter((a) => a._id !== account._id));
      toast('Account deleted', 'success');
      setDeleteNgoTarget(null);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setDeletingNgo(false);
    }
  };

  // Retry ('failed' status) — re-triggers the same connectAccount() call used
  // on initial save, no delete/re-create needed. Per-account OTP entry, keyed
  // by accountId so more than one account "waiting for OTP" doesn't collide.
  const [otpValues, setOtpValues] = useState({});
  const [otpBusyId, setOtpBusyId] = useState(null);

  const retryConnectNGO = async (account) => {
    setOtpBusyId(account._id);
    try {
      const result = await connectAccount(account._id);
      if (result.needsOTP || result.data?.needsOTP) {
        toast('OTP required — check the phone linked to this account', 'info');
      } else {
        toast(result.message || 'Reconnected', 'success');
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setOtpBusyId(null);
      loadNGOAccounts();
    }
  };

  const submitNGOOtp = async (accountId) => {
    const otp = (otpValues[accountId] || '').trim();
    if (otp.length !== 6) { toast('Enter the 6-digit OTP', 'error'); return; }
    setOtpBusyId(accountId);
    try {
      await verifyOTP(accountId, otp);
      toast('Connected successfully', 'success');
      setOtpValues((v) => ({ ...v, [accountId]: '' }));
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setOtpBusyId(null);
      loadNGOAccounts();
    }
  };

  // Optimistic patch used by toggles / link. Reverts every field the call
  // touched (not just one) back to its pre-patch value if the request fails
  // — matters now that toggle-on can patch is_active_detail AND is_active
  // together in one call.
  const patch = async (d, body) => {
    setDetails((list) => list.map((x) => (x.id === d.id ? { ...x, ...body } : x)));
    try {
      await traderApi.updatePaymentDetail(d.id, body);
    } catch (e) {
      const revert = {};
      Object.keys(body).forEach((k) => { revert[k] = d[k]; });
      setDetails((list) => list.map((x) => (x.id === d.id ? { ...x, ...revert } : x)));
      toast(apiError(e), 'error');
    }
  };

  const linkDetail = (d) => patch(d, { is_active: true });

  // Readiness gate: before actually linking, verify the detail has a real,
  // currently-live data source — an APK device heartbeating within the last
  // ~15s, or (for a web-login mirror) a genuinely alive scraper session, not
  // just the Mongo status field. Checked fresh on every attempt rather than
  // from cached state, since liveness is inherently time-sensitive.
  const [linkBlocked, setLinkBlocked] = useState({});
  const [linkChecking, setLinkChecking] = useState(null);

  const checkDetailLiveness = async (d) => {
    const mirrorAccount = ngoAccounts.find((a) => a.gatewayPaymentDetailId === d.id);
    if (mirrorAccount) {
      try {
        const res = await getAccountStatus(mirrorAccount._id);
        return { live: !!res.isAlive, kind: 'web', account: mirrorAccount };
      } catch (e) {
        return { live: false, kind: 'web', account: mirrorAccount };
      }
    }
    if (d.ngo_device_id) {
      try {
        const devices = await getDevices();
        const device = devices.find((dev) => dev.id === d.ngo_device_id);
        const live = !!device && device.lastSeen
          && Date.now() - new Date(device.lastSeen).getTime() <= DEVICE_ONLINE_WINDOW_MS;
        return { live, kind: 'apk', device };
      } catch (e) {
        return { live: false, kind: 'apk', device: null };
      }
    }
    // Never linked to any real device or web session — nothing to check
    // liveness against, so there's no live data source by definition.
    return { live: false, kind: 'apk', device: null };
  };

  // Shared by the manual "Link" retry button AND toggle-on (item 4): checks
  // real liveness, links (is_active:true) if live, otherwise records why for
  // the inline blocked-message UI. `extra` lets toggle-on fold
  // is_active_detail into the same PUT instead of a second round trip.
  const linkIfLive = async (d, extra = {}) => {
    setLinkChecking(d.id);
    try {
      const check = await checkDetailLiveness(d);
      if (!check.live) {
        const message = check.kind === 'web'
          ? "Not receiving data — the web-login session isn't connected."
          : 'Not receiving data — no recent heartbeat from the paired device.';
        const actionLabel = check.kind === 'web' ? 'Reconnect account' : 'Go to Smartphones';
        setLinkBlocked((b) => ({ ...b, [d.id]: { message, actionLabel, kind: check.kind, account: check.account } }));
        if (Object.keys(extra).length) await patch(d, extra);
        return false;
      }
      setLinkBlocked((b) => {
        if (!(d.id in b)) return b;
        const n = { ...b };
        delete n[d.id];
        return n;
      });
      await patch(d, { is_active: true, ...extra });
      return true;
    } finally {
      setLinkChecking(null);
    }
  };

  const attemptLink = (d) => linkIfLive(d);

  // Toggle-off is unconditional. Toggle-on now IS the linking action: flip
  // is_active_detail and, in the same request, set is_active:true only if a
  // real liveness check passes — otherwise is_active_detail still turns on
  // but is_active stays false, with the same inline "reconnect" message the
  // manual Link button already shows.
  const toggleDetail = (d) => {
    if (d.is_active_detail) return patch(d, { is_active_detail: false });
    return linkIfLive(d, { is_active_detail: true });
  };

  // Web-login: jump straight into the existing per-row OTP/reconnect flow.
  // APK: there's no "reconnect" action on this page at all — send the
  // trader to the Smartphones pairing flow, the real reconnect surface.
  // BUG-27: linking happens in place, on the row that reported the problem.
  const [linkingDetail, setLinkingDetail] = useState(null);

  const reconnectFromBlock = (blocked) => {
    if (blocked.kind === 'web' && blocked.account) {
      retryConnectNGO(blocked.account);
    } else {
      navigate('/smartphones');
    }
  };

  const bulkToggle = async (items, value) => {
    setDetails((list) => list.map((x) => (items.some((i) => i.id === x.id) ? { ...x, is_active_detail: value } : x)));
    try {
      await Promise.all(items.map((i) => traderApi.updatePaymentDetail(i.id, { is_active_detail: value })));
    } catch (e) {
      toast(apiError(e), 'error');
      load();
    }
  };

  // A bank preset (from a per-bank "+") jumps the APK wizard straight to step 2.
  const openAdd = (bank) => { setPresetBank(bank); setAdding(true); };

  return (
    <>
    <div>
      <PageHeader
        title="Payment details"
        info="Manage all UPI accounts, connections, limits and routing eligibility."
        actions={
          <Button onClick={() => openAdd(null)}>
            <IconPlus className="h-4 w-4" />
            Add Payment Detail
          </Button>
        }
      />

      {/* Real 5-tile summary strip — every figure derived from `details`/
          `ngoAccounts` below, nothing fabricated (matches the design's
          paymentSummaryCards row; "Manual accounts" has no real backend
          concept here so it's replaced with a real "Needs attention" count). */}
      <div className="tf-summary5">
        <div>
          <span className="tf-summary5-icon"><Layers3 size={18} /></span>
          <small>Total UPI accounts</small>
          <strong>{distinctAccounts(details, ngoAccounts)}</strong>
          <em>All connected accounts</em>
        </div>
        <div>
          <span className="tf-summary5-icon" style={{ background: 'rgba(34,197,94,.14)', color: '#22c55e' }}><Wifi size={18} /></span>
          <small>Live pool</small>
          <strong>{distinctAccounts(details, ngoAccounts, isLive, (a) => a.status === 'live')}</strong>
          <em>Connection confirmed alive</em>
        </div>
        <div>
          <span className="tf-summary5-icon" style={{ background: 'rgba(34,197,94,.14)', color: '#22c55e' }}><IconRobot className="h-[18px] w-[18px]" /></span>
          <small>APK connected</small>
          <strong>{details.filter((d) => connType(d) === 'apk' && d.ngo_device_id).length}</strong>
          <em>Paired to a smartphone</em>
        </div>
        <div>
          <span className="tf-summary5-icon" style={{ background: 'rgba(59,130,246,.14)', color: '#3b82f6' }}><IconGlobe className="h-[18px] w-[18px]" /></span>
          <small>Web login accounts</small>
          <strong>{ngoAccounts.length}</strong>
          <em>Provider sessions</em>
        </div>
        <div>
          <span className="tf-summary5-icon" style={{ background: 'rgba(245,158,11,.14)', color: '#f59e0b' }}><IconWarning className="h-[18px] w-[18px]" /></span>
          <small>Needs attention</small>
          {/* A switched-on account whose connection has died belongs here:
              the trader wants orders on it and none are being routed, which
              is precisely "needs attention". It was previously counted
              nowhere, so a dead connection had no presence in the summary. */}
          <strong>{needsAttentionCount}</strong>
          <em>Unlinked, disconnected, failed or waiting for OTP</em>
        </div>
      </div>

      {loading ? (
        <p className="py-16 text-center text-sm" style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : (
        <>
          {/* Live Pool — reused as-is from Dashboard.jsx's own instance (same
              real details/deactivate mutation), matching the design's Live
              Pool table section on this page too. */}
          <div className="mb-6">
            <LivePoolSection details={details} todayVolumeInr={todayVolumeInr} onChanged={load} />
          </div>

          <AccountsColumn
            details={details}
            onToggle={toggleDetail}
            onBulkToggle={bulkToggle}
            onLink={attemptLink}
            linkBlocked={linkBlocked}
            linkChecking={linkChecking}
            onReconnect={reconnectFromBlock}
            onLinkDevice={(d) => setLinkingDetail(d)}
            onEdit={setEditing}
            onAdd={openAdd}
            ngoAccounts={ngoAccounts}
            onToggleNGO={toggleNGO}
            ngoToggleBusyId={ngoToggleBusyId}
            onDeleteNGO={deleteNGO}
            onRetryNGO={retryConnectNGO}
            otpValues={otpValues}
            onOtpChange={(id, v) => setOtpValues((m) => ({ ...m, [id]: v }))}
            onSubmitOtp={submitNGOOtp}
            otpBusyId={otpBusyId}
            deviceLiveMap={deviceLiveMap}
            deviceNames={deviceNameMap}
            ngoAliveMap={ngoAliveMap}
          />
        </>
      )}

      {adding && (
        <AddAccountModal
          presetBank={presetBank}
          onClose={() => { setAdding(false); setPresetBank(null); }}
          onSaved={load}
        />
      )}
      {editing && (
        <EditModal
          detail={editing}
          onClose={() => setEditing(null)}
          // `editing` may be a trader detail or an NGO/web account — refresh
          // both lists so whichever one changed shows the update.
          onSaved={() => Promise.all([load(), loadNGOAccounts()])}
          onDeleted={load}
          deviceLiveMap={deviceLiveMap}
        />
      )}
      {linkingDetail && (
        <LinkDeviceModal
          detail={linkingDetail}
          onClose={() => setLinkingDetail(null)}
          // Reload details AND re-run the liveness poll: linking a device
          // changes connection_alive on the next backend sync, and the row
          // should stop saying "Not connected" as soon as it does.
          onLinked={load}
        />
      )}
    </div>
    <ConfirmModal
      open={!!deleteNgoTarget}
      title="Delete this account?"
      description={deleteNgoTarget ? `Delete ${deleteNgoTarget.displayName || 'this account'}? This cannot be undone.` : ''}
      confirmLabel="Delete"
      tone="danger"
      busy={deletingNgo}
      onConfirm={confirmDeleteNGO}
      onClose={() => setDeleteNgoTarget(null)}
    />
    </>
  );
}
