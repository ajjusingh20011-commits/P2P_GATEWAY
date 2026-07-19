import { useEffect, useMemo, useState } from 'react';
import { Card, Badge, Button, Toggle, SearchInput, Select, PageHeader } from '../components/ui';
import {
  IconPlus, IconEdit, IconTrash, IconX, IconChevron, IconRobot, IconWarning, IconDots, IconDetails, IconLock, IconGlobe,
} from '../components/icons';
import { maskUpi, ACCOUNT_TYPES } from '../utils/mock';
import { traderApi } from '../services/api';
import { toast } from '../components/Toaster';
import { saveWebAccount, getAccounts, toggleAccount, updateAccount, connectAccount, verifyOTP } from '../lib/ngoApi';

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

const CIRCLE = {
  sky: 'bg-sky-500/20 text-sky-300',
  violet: 'bg-violet-500/20 text-violet-300',
  amber: 'bg-amber-500/20 text-amber-300',
  red: 'bg-red-500/20 text-red-300',
  green: 'bg-emerald-500/20 text-emerald-300',
  gray: 'bg-gray-700/40 text-gray-300',
};

const initials = (name = '') =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

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
// Modal shell
// ---------------------------------------------------------------------------
function Modal({ title, onClose, children, headerRight }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-gray-800 bg-gray-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-800 p-4">
          <h2 className="font-semibold text-white">{title}</h2>
          <div className="flex items-center gap-2">
            {headerRight}
            <button onClick={onClose} className="text-gray-500 hover:text-white" aria-label="Close">
              <IconX className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-400">{label}</span>
      {children}
      {hint}
    </label>
  );
}

const inputCls =
  'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500';

// ---------------------------------------------------------------------------
// Collapsible per-window limit section (Fix 3). OFF by default.
// ---------------------------------------------------------------------------
function LimitWindow({ title, on, onToggle, amount, onAmount, ops, onOps, showDate, date, onDate, currentPeriod }) {
  return (
    <div className="rounded-lg border border-gray-800">
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-sm text-gray-200">{title}</span>
        <Toggle checked={on} onChange={onToggle} />
      </div>
      {on && (
        <div className="space-y-3 border-t border-gray-800 p-3">
          {showDate && (
            <Field label="Start date">
              <input type="date" className={inputCls} value={date} onChange={(e) => onDate(e.target.value)} />
            </Field>
          )}
          <Field label="Disable upon reaching amount (INR)">
            <input type="number" min="0" className={inputCls} value={amount} onChange={(e) => onAmount(e.target.value)} placeholder="e.g. 100000" />
          </Field>
          <Field label="Disable after N operations">
            <input type="number" min="0" className={inputCls} value={ops} onChange={(e) => onOps(e.target.value)} placeholder="e.g. 200" />
          </Field>
          <p className="text-xs text-gray-500">Current period: {Number(currentPeriod || 0).toFixed(2)} INR</p>
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
  const period = {
    month: usage?.daily_amount_total || 0,
    week: usage?.daily_amount_total || 0,
    day: usage?.daily_amount_total || 0,
    hour: usage?.daily_amount_total || 0,
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
          <input type="number" min="0" className={inputCls} value={form.min_amount} onChange={(e) => set('min_amount', e.target.value)} placeholder="100" />
        </Field>
        <Field label="Maximum amount per transaction">
          <input type="number" min="0" className={inputCls} value={form.max_amount} onChange={(e) => set('max_amount', e.target.value)} placeholder="100000" />
        </Field>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-gray-800 px-3 py-2.5">
        <div>
          <p className="text-sm text-gray-200">Activity of details</p>
          <p className="text-xs text-gray-500">Detail participates in transactions when ON</p>
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
  const [step, setStep] = useState(presetBank ? 2 : 1);
  const [bank, setBank] = useState(presetBank || null);
  const [bankQuery, setBankQuery] = useState('');
  const [form, setForm] = useState(() => ({
    ...emptyLimits(),
    account_name: '',
    upi_id: '',
    organization_name: '',
    bank_name: presetBank?.name || '',
    smartphone_id: '',
  }));
  const [saving, setSaving] = useState(false);
  const [caps, setCaps] = useState({ month: false, week: false, day: false, hour: false });

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const filteredBanks = useMemo(() => {
    const q = bankQuery.trim().toLowerCase();
    return q ? BANKS.filter((b) => b.name.toLowerCase().includes(q)) : BANKS;
  }, [bankQuery]);

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
  const step2Valid = nameValid && upiValid && orgValid;

  const save = async () => {
    setSaving(true);
    try {
      await traderApi.addPaymentDetail(
        buildBody(form, bank?.type || 'gpay', caps, {
          account_name: form.account_name,
          upi_id: form.upi_id,
          bank_name: form.bank_name || bank?.name || '',
          organization_name: form.organization_name,
          smartphone_id: num(form.smartphone_id) ?? null,
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

  const titles = { 1: 'Select Bank', 2: 'Fill in the data', 3: 'Setting Limits' };

  return (
    <>
      {/* step name — was the modal header title before tabs were added */}
      <p className="mb-3 text-sm font-medium text-gray-300">{titles[step]}</p>

      {/* step indicator */}
      <div className="mb-4 flex items-center gap-2">
        {[1, 2, 3].map((s) => (
          <div key={s} className={`h-1.5 flex-1 rounded-full ${s <= step ? 'bg-emerald-500' : 'bg-gray-700'}`} />
        ))}
      </div>

      {step === 1 && (
        <div>
          <SearchInput value={bankQuery} onChange={setBankQuery} placeholder="Search bank…" />
          <div className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1">
            {filteredBanks.map((b) => (
              <button
                key={b.name}
                onClick={() => pickBank(b)}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition hover:bg-gray-800 ${
                  bank?.name === b.name ? 'border-emerald-500/50 bg-gray-800' : 'border-gray-800'
                }`}
              >
                <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${CIRCLE[b.color]}`}>
                  {initials(b.name)}
                </span>
                <span className="text-sm text-gray-100">{b.name}</span>
              </button>
            ))}
            {filteredBanks.length === 0 && (
              <p className="py-4 text-center text-sm text-gray-500">No banks match “{bankQuery}”.</p>
            )}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <Field label="Smartphone">
            <select value={form.smartphone_id} onChange={(e) => set('smartphone_id', e.target.value)} className={inputCls}>
              <option value="">No devices</option>
            </select>
          </Field>

          <Field label="Title / Name">
            <input
              className={`${inputCls} ${form.account_name.length > 0 && !nameValid ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
              value={form.account_name}
              onChange={(e) => set('account_name', e.target.value)}
              placeholder="e.g. Rahul Sharma"
            />
            {form.account_name.length > 0 && !nameValid && (
              <span className="mt-1 block text-xs text-red-400">Name must be at least 2 characters</span>
            )}
          </Field>

          <Field label="UPI ID">
            <div className="relative">
              <input
                className={`${inputCls} pr-9 ${upiInvalid ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : upiValid ? 'border-emerald-500' : ''}`}
                value={form.upi_id}
                onChange={(e) => set('upi_id', e.target.value)}
                placeholder="name@bank"
              />
              {upiValid && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400" aria-hidden>✓</span>
              )}
            </div>
            <span className={`mt-1 block text-xs ${upiInvalid ? 'text-red-400' : 'text-gray-500'}`}>
              Enter valid UPI ID (example: name@bank)
            </span>
          </Field>

          <Field label="Organization name">
            <input
              className={inputCls}
              value={form.organization_name}
              onChange={(e) => set('organization_name', e.target.value)}
              placeholder="e.g. Sharma Enterprises"
            />
          </Field>
        </div>
      )}

      {step === 3 && (
        <>
          <p className="mb-3 text-xs text-gray-500">All limits are optional — leave a section off to skip it.</p>
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
          <button
            type="button"
            onClick={() => step2Valid && setStep(3)}
            disabled={!step2Valid}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition ${
              step2Valid
                ? 'bg-black text-white hover:bg-gray-800'
                : 'cursor-not-allowed bg-gray-700 text-gray-500'
            }`}
          >
            Next
          </button>
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
        }).catch((e) => console.error('NGO account saved, but routing sync failed:', e));
      }

      if (accountId) {
        setConnectingId(accountId);
        await startConnect(accountId);
      } else {
        setSuccess('Account connected successfully!');
        toast('Payment detail added', 'success');
        window.dispatchEvent(new Event('ngo-account-added'));
        setTimeout(() => {
          onClose();
          onSaved();
        }, 1500);
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
        setTimeout(() => {
          onClose();
          onSaved();
        }, 2000);
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
      setTimeout(() => {
        onClose();
        onSaved();
      }, 2000);
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

  // OTP Input Step
  if (otpStep) {
    return (
      <div>
        <div className="space-y-5">
          <div className="text-center py-4">
            <p className="text-sm text-gray-300 mb-1">
              {connecting ? 'Verifying...' : 'Enter the OTP sent to your registered mobile number'}
            </p>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium text-gray-400">6-Digit OTP</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={otpValue}
              onChange={(e) => setOtpValue(e.target.value.replace(/\D/g, ''))}
              placeholder="Enter 6-digit OTP"
              disabled={connecting}
              className="w-full rounded-lg border bg-gray-800 px-4 py-3 text-center text-2xl font-semibold tracking-[8px] text-gray-100 placeholder-gray-500 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              style={{
                background: '#161b22',
                borderColor: '#30363d',
                color: '#e6edf3',
              }}
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              {success}
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-col gap-3">
          <Button onClick={handleVerifyOTP} disabled={busy || otpValue.length !== 6}>
            {connecting ? 'Verifying...' : 'Verify OTP'}
          </Button>

          <button
            onClick={handleResendOTP}
            disabled={connecting}
            className="text-sm font-medium text-emerald-400 hover:text-emerald-300 disabled:text-gray-500"
          >
            Resend OTP
          </button>
        </div>

        <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-gray-500">
          <IconLock className="h-3.5 w-3.5 text-emerald-400" />
          <span>256-bit encrypted</span>
        </div>
      </div>
    );
  }

  // Original form step
  return (
    <div>
      <div className="space-y-3">
        <Field label="Platform">
          <select className={inputCls} value={form.platform} disabled={busy} onChange={(e) => set('platform', e.target.value)}>
            <option value="">Select platform…</option>
            {WEB_PLATFORMS.map((p) => (
              <option key={p.label} value={p.value}>{p.label}</option>
            ))}
          </select>
        </Field>

        <Field label="UPI ID">
          <input
            className={inputCls}
            value={form.upiId}
            disabled={busy}
            onChange={(e) => set('upiId', e.target.value)}
            placeholder="9988776655@paytm"
          />
        </Field>

        <Field label="Display Name">
          <input
            className={inputCls}
            value={form.displayName}
            disabled={busy}
            onChange={(e) => set('displayName', e.target.value)}
            placeholder="e.g. Bright Future Paytm"
          />
        </Field>

        <Field label="Login Email">
          <input
            type="email"
            className={inputCls}
            value={form.loginEmail}
            disabled={busy}
            onChange={(e) => set('loginEmail', e.target.value)}
            placeholder="ngo@paytm.com"
          />
        </Field>

        <Field label="Login Password">
          <input
            type="password"
            className={inputCls}
            value={form.loginPassword}
            disabled={busy}
            onChange={(e) => set('loginPassword', e.target.value)}
            placeholder="••••••••"
          />
        </Field>

        <Field label="Phone Number">
          <input
            className={inputCls}
            value={form.loginPhone}
            disabled={busy}
            onChange={(e) => set('loginPhone', e.target.value)}
            placeholder="9988776655"
          />
        </Field>

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        {success && (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            {success}
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between">
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={handleWebLoginSave} disabled={busy}>{loading ? 'Connecting...' : 'Save'}</Button>
      </div>

      <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-gray-500">
        <IconLock className="h-3.5 w-3.5 text-emerald-400" />
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
    <Modal title="Add Payment Detail" onClose={onClose}>
      {/* Icon tabs: android (APK, teal) / globe (Web, coral). Icon on top,
          text below, teal underline on the active tab. */}
      <div className="flex" style={{ borderBottom: '1px solid var(--cardborder)' }}>
        {[
          { key: 'apk', label: 'APK Connection', Icon: IconRobot, iconColor: 'text-emerald-400' },
          { key: 'web', label: 'Web Login', Icon: IconGlobe, iconColor: 'text-rose-400' },
        ].map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="-mb-px flex flex-1 flex-col items-center gap-1.5 transition"
              style={{
                padding: '12px 24px',
                borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              <t.Icon className={t.iconColor} style={{ width: 40, height: 40 }} />
              <span
                className="text-sm font-medium"
                style={{ color: active ? 'var(--accent)' : 'var(--muted)' }}
              >
                {t.label}
              </span>
            </button>
          );
        })}
      </div>

      <div className="pt-4">
        {tab === 'apk' ? (
          <ApkWizardBody presetBank={presetBank} onClose={onClose} onSaved={onSaved} />
        ) : (
          <WebLoginForm onClose={onClose} onSaved={onSaved} />
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// EDIT modal
// ---------------------------------------------------------------------------
function EditModal({ detail, onClose, onSaved, onDeleted }) {
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
          // over a routing-sync hiccup, just log it.
          console.error('NGO account saved, but routing sync failed:', syncErr);
        }
      } else {
        await traderApi.updatePaymentDetail(detail.id, body);
      }
      toast('Payment detail updated', 'success');
      await onSaved();
      onClose();
    } catch (e) {
      toast(apiError(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('Delete this payment detail? This cannot be undone.')) return;
    try {
      await traderApi.deletePaymentDetail(detail.id);
      toast('Payment detail deleted', 'success');
      await onDeleted();
      onClose();
    } catch (e) {
      toast(apiError(e), 'error');
    }
  };

  return (
    <Modal
      title="Edit Payment Detail"
      onClose={onClose}
      headerRight={
        // NGO/web accounts have no delete endpoint yet — only trader-native
        // details can be removed here.
        !detail.__ngo && (
          <button onClick={remove} className="text-gray-500 hover:text-red-400" aria-label="Delete">
            <IconTrash className="h-5 w-5" />
          </button>
        )
      }
    >
      <div className="space-y-3">
        <Field label="Title / Name">
          <input className={inputCls} value={form.account_name} onChange={(e) => set('account_name', e.target.value)} />
        </Field>
        <Field label="UPI ID">
          <input
            className={`${inputCls} ${form.upi_id.length > 0 && !upiValid ? 'border-red-500' : upiValid ? 'border-emerald-500' : ''}`}
            value={form.upi_id}
            onChange={(e) => set('upi_id', e.target.value)}
          />
          <span className="mt-1 block text-xs text-gray-500">Must contain “@” (example: name@bank)</span>
        </Field>
        <Field label="Organization name">
          <input className={inputCls} value={form.organization_name} onChange={(e) => set('organization_name', e.target.value)} />
        </Field>

        <div className="pt-1">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Limits</p>
          <LimitsForm form={form} set={set} caps={caps} setCaps={setCaps} usage={detail.usage} />
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </Modal>
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

// Connection type of a payment detail: 'web' when it came from a Web Login
// (ngo-backend connectionType === 'web'), otherwise 'apk' (the default for
// trader-native details, which have no connectionType field).
const connType = (d) => (d && d.connectionType === 'web' ? 'web' : 'apk');

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

// NGO accounts (from ngo-backend, port 3000) grouped by their payment platform.
function groupByPlatform(accounts) {
  return accounts.reduce((groups, account) => {
    const key = account.platform || 'other';
    if (!groups[key]) groups[key] = [];
    groups[key].push(account);
    return groups;
  }, {});
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

// ---------------------------------------------------------------------------
// LEFT column — Offers grouped by payment method
// ---------------------------------------------------------------------------
function OffersColumn({ details, onBulkToggle, onAdd, ngoAccounts = [], onToggleNGO }) {
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState(null);

  const groups = useMemo(() => {
    const map = {};
    for (const d of details) {
      const t = d.account_type || 'other';
      (map[t] = map[t] || []).push(d);
    }
    return Object.entries(map).map(([type, items]) => ({ type, items, meta: methodMeta(type) }));
  }, [details]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => g.meta.label.toLowerCase().includes(q));
  }, [groups, query]);

  return (
    <Card className="flex flex-col">
      <div className="flex items-center justify-between border-b border-gray-800 p-4">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-white">Offers</h2>
          <span className="text-gray-600" title="Payment methods you accept, grouped by provider.">
            <IconDetails className="h-4 w-4" />
          </span>
        </div>
        <button onClick={() => onAdd(null)} className="rounded-lg border border-gray-700 p-1.5 text-gray-300 hover:bg-gray-800" aria-label="Add offer">
          <IconPlus className="h-4 w-4" />
        </button>
      </div>

      <div className="p-4">
        <SearchInput value={query} onChange={setQuery} placeholder="Search offers…" />

        <div className="mt-4 space-y-3">
          {filtered.map((g) => {
            const anyActive = g.items.some((d) => d.is_active_detail);
            return (
              <div key={g.type} className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ${CIRCLE[g.meta.color] || CIRCLE.gray}`}>
                      {initials(g.meta.label)}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-gray-100">{g.meta.label}</p>
                      <p className="text-xs text-gray-500">INR · market rate</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Toggle checked={anyActive} onChange={(v) => onBulkToggle(g.items, v)} />
                    <div className="relative">
                      <button
                        onClick={() => setMenu(menu === g.type ? null : g.type)}
                        className="text-gray-500 hover:text-gray-200"
                        aria-label="Offer menu"
                      >
                        <IconDots className="h-4 w-4" />
                      </button>
                      {menu === g.type && (
                        <div className="absolute right-0 z-10 mt-1 w-40 rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-xl">
                          <button
                            onClick={() => { onBulkToggle(g.items, true); setMenu(null); }}
                            className="block w-full px-3 py-1.5 text-left text-xs text-gray-200 hover:bg-gray-800"
                          >
                            Enable all details
                          </button>
                          <button
                            onClick={() => { onBulkToggle(g.items, false); setMenu(null); }}
                            className="block w-full px-3 py-1.5 text-left text-xs text-gray-200 hover:bg-gray-800"
                          >
                            Disable all details
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* connected payment details as tags + connection-type icon (bottom-right) */}
                <div className="mt-3 flex items-end justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {g.items.map((d) => (
                      <span
                        key={d.id}
                        className={`rounded-md border px-2 py-0.5 text-xs ${
                          d.is_active_detail
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                            : 'border-gray-700 bg-gray-800 text-gray-500'
                        }`}
                      >
                        {d.account_name || maskUpi(d.upi_id)}
                      </span>
                    ))}
                  </div>
                  <ConnTypeIcon
                    type={g.items.some((i) => i.connectionType === 'web') ? 'web' : 'apk'}
                    size={28}
                  />
                </div>
              </div>
            );
          })}

          {/* NGO accounts (from the NGO backend) rendered as offer cards */}
          {ngoAccounts
            .filter((a) => {
              const q = query.trim().toLowerCase();
              if (!q) return true;
              return platformLabel(a.platform).toLowerCase().includes(q) || (a.displayName || '').toLowerCase().includes(q);
            })
            .map((a) => {
              const live = a.status === 'live';
              return (
                <div key={`ngo-${a._id}`} className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-300">
                        {(a.platform || '?').slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-gray-100">{platformLabel(a.platform)}</p>
                        <p className="text-xs text-gray-500">INR · NGO account</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Toggle checked={live} onChange={() => onToggleNGO(a)} />
                    </div>
                  </div>

                  <div className="mt-3 flex items-end justify-between gap-2">
                    <div className="flex flex-wrap gap-1.5">
                      <span
                        className={`rounded-md border px-2 py-0.5 text-xs ${
                          live
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                            : 'border-gray-700 bg-gray-800 text-gray-500'
                        }`}
                      >
                        {a.displayName}
                      </span>
                    </div>
                    <ConnTypeIcon type={a.connectionType === 'web' ? 'web' : 'apk'} size={28} />
                  </div>
                </div>
              );
            })}

          {filtered.length === 0 && ngoAccounts.length === 0 && (
            <p className="py-10 text-center text-sm text-gray-500">
              {groups.length === 0 ? 'No offers yet — add a payment detail to create one.' : 'No offers match your search.'}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// RIGHT column — Details grouped by bank
// ---------------------------------------------------------------------------
function DetailsColumn({ details, onToggle, onLink, onEdit, onAdd, ngoAccounts = [], onToggleNGO }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all'); // all | active | inactive
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);

  const unlinkedCount = useMemo(() => details.filter(notLinked).length, [details]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return details.filter((d) => {
      if (filter === 'active' && !d.is_active_detail) return false;
      if (filter === 'inactive' && d.is_active_detail) return false;
      if (onlyUnlinked && !notLinked(d)) return false;
      if (!q) return true;
      return (d.account_name || '').toLowerCase().includes(q) || (d.upi_id || '').toLowerCase().includes(q);
    });
  }, [details, query, filter, onlyUnlinked]);

  const groups = useMemo(() => {
    const map = {};
    for (const d of filtered) {
      const key = d.bank_name || d.organization_name || methodMeta(d.account_type).label;
      (map[key] = map[key] || []).push(d);
    }
    return Object.entries(map).map(([bank, items]) => ({ bank, items }));
  }, [filtered]);

  // NGO accounts: apply the same search + active/inactive filter, then group by
  // platform. The "unlinked-only" view is a trader concept, so it hides them.
  const ngoGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = ngoAccounts.filter((a) => {
      if (onlyUnlinked) return false;
      if (filter === 'active' && a.status !== 'live') return false;
      if (filter === 'inactive' && a.status === 'live') return false;
      if (!q) return true;
      return (a.displayName || '').toLowerCase().includes(q) || (a.upiId || '').toLowerCase().includes(q);
    });
    return Object.entries(groupByPlatform(list));
  }, [ngoAccounts, query, filter, onlyUnlinked]);

  return (
    <Card className="flex flex-col">
      <div className="flex items-center justify-between border-b border-gray-800 p-4">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-white">Details</h2>
          <Badge color="gray">{details.length + ngoAccounts.length}</Badge>
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
          <button onClick={() => onAdd(null)} className="rounded-lg border border-gray-700 p-1.5 text-gray-300 hover:bg-gray-800" aria-label="Add detail">
            <IconPlus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="p-4">
        <SearchInput value={query} onChange={setQuery} placeholder="Search account or UPI…" />

        {/* warning banner (Fix 4) */}
        {unlinkedCount > 0 && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <div className="flex items-center gap-2 text-sm text-amber-300">
              <IconWarning className="h-4 w-4 flex-shrink-0" />
              <span>You have active payment details that are not participating in transactions.</span>
            </div>
            <button
              onClick={() => setOnlyUnlinked((v) => !v)}
              className="rounded-md border border-amber-500/40 px-2.5 py-1 text-xs font-medium text-amber-200 hover:bg-amber-500/20"
            >
              {onlyUnlinked ? 'Show all' : 'Show'}
            </button>
          </div>
        )}

        <div className="mt-4 space-y-4">
          {groups.map((g) => (
            <div key={g.bank}>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold ${CIRCLE[methodMeta(g.items[0].account_type).color] || CIRCLE.gray}`}>
                    {initials(g.bank)}
                  </span>
                  <span className="text-sm font-medium text-gray-200">{g.bank}</span>
                  <span className="text-xs text-gray-500">INR</span>
                </div>
                <button
                  onClick={() => onAdd(BANKS.find((b) => b.name === g.bank) || null)}
                  className="text-emerald-400 hover:text-emerald-300"
                  aria-label="Add detail to bank"
                >
                  <IconPlus className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-2">
                {g.items.map((d) => {
                  const dot = limitDot(d);
                  const exhausted = isExhausted(d);
                  const unlinked = notLinked(d);
                  const highlight = exhausted || unlinked;
                  return (
                    <div
                      key={d.id}
                      className={`rounded-lg border px-3 py-2.5 ${
                        highlight ? 'border-amber-500/40 bg-amber-500/5' : 'border-gray-800 bg-gray-950'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {/* ON/OFF toggle (red off / green on) */}
                        <Toggle checked={!!d.is_active_detail} onChange={() => onToggle(d)} />

                        {/* robot online/offline */}
                        <span
                          className={d.smartphone_id ? 'text-emerald-400' : 'text-gray-600'}
                          title={d.smartphone_id ? 'Device online' : 'No device connected'}
                        >
                          <IconRobot className="h-5 w-5" />
                        </span>

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-100">{d.account_name || 'Untitled'}</p>
                          <p className="truncate text-xs text-gray-500">{maskUpi(d.upi_id)}</p>
                        </div>

                        {/* connection-type icon (apk=android/teal · web=globe/coral) */}
                        <ConnTypeIcon type={connType(d)} size={24} />

                        {/* limit dot + Day label */}
                        <div className="flex flex-col items-center" title={dot.title}>
                          <span className={`h-2.5 w-2.5 rounded-full ${dot.cls}`} />
                          <span className="mt-0.5 text-[10px] text-gray-500">Day</span>
                        </div>

                        <button onClick={() => onEdit(d)} className="text-gray-500 hover:text-gray-200" aria-label="Edit detail">
                          <IconEdit className="h-4 w-4" />
                        </button>
                      </div>

                      {/* inline warning + action */}
                      {highlight && (
                        <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                          <span className="text-amber-300">
                            {exhausted ? 'Limit exhausted' : 'Not linked to Offer'}
                          </span>
                          {exhausted ? (
                            <button onClick={() => onEdit(d)} className="rounded-md border border-amber-500/40 px-2 py-0.5 font-medium text-amber-200 hover:bg-amber-500/20">
                              Update limit
                            </button>
                          ) : (
                            <button onClick={() => onLink(d)} className="rounded-md border border-amber-500/40 px-2 py-0.5 font-medium text-amber-200 hover:bg-amber-500/20">
                              Link
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* NGO accounts (from the NGO backend) grouped by platform */}
          {ngoGroups.map(([platform, accounts]) => (
            <div key={`ngo-${platform}`}>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-[10px] font-bold text-emerald-300">
                    {platform.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="text-sm font-medium text-gray-200">{platformLabel(platform)}</span>
                  <span className="text-xs text-gray-500">INR</span>
                </div>
                <button
                  onClick={() => onAdd(null)}
                  className="text-emerald-400 hover:text-emerald-300"
                  aria-label="Add NGO account"
                >
                  <IconPlus className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-2">
                {accounts.map((a) => {
                  const live = a.status === 'live';
                  return (
                    <div key={a._id} className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-2.5">
                      <div className="flex items-center gap-3">
                        <Toggle checked={live} onChange={() => onToggleNGO(a)} />

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-100">{a.displayName || 'Untitled'}</p>
                          <p className="truncate text-xs text-gray-500">{maskUpi(a.upiId)}</p>
                        </div>

                        {/* connection-type icon (apk=android/teal · web=globe/coral) */}
                        <ConnTypeIcon type={a.connectionType === 'web' ? 'web' : 'apk'} size={24} />

                        {/* live/paused dot + Day label */}
                        <div className="flex flex-col items-center" title={live ? 'Live' : 'Paused'}>
                          <span className={`h-2.5 w-2.5 rounded-full ${live ? 'bg-emerald-500' : 'bg-gray-500'}`} />
                          <span className="mt-0.5 text-[10px] text-gray-500">Day</span>
                        </div>

                        <button
                          onClick={() => onEdit(ngoAccountToEditable(a))}
                          className="text-gray-500 hover:text-gray-200"
                          aria-label="Edit detail"
                        >
                          <IconEdit className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {groups.length === 0 && ngoGroups.length === 0 && (
            <p className="py-10 text-center text-sm text-gray-500">
              {details.length === 0 ? 'No payment details yet — add one to start receiving payments.' : 'No details match your filter.'}
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
  const [details, setDetails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [presetBank, setPresetBank] = useState(null);
  const [editing, setEditing] = useState(null);
  const [ngoAccounts, setNgoAccounts] = useState([]);
  const [ngoLoading, setNgoLoading] = useState(false);

  const load = async () => {
    try {
      const res = await traderApi.paymentDetails();
      setDetails(res?.data?.data?.payment_details || []);
    } catch (e) {
      setDetails([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

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

  // Optimistically flip an NGO account's status, then persist via ngoApi.
  const toggleNGO = async (account) => {
    const newStatus = account.status === 'live' ? 'paused' : 'live';
    setNgoAccounts((list) => list.map((a) => (a._id === account._id ? { ...a, status: newStatus } : a)));
    try {
      await toggleAccount(account._id, newStatus);
      // Keep the mirrored payment_detail's routing eligibility in sync —
      // best-effort, doesn't affect the toggle the user is waiting on.
      if (account.gatewayPaymentDetailId) {
        traderApi
          .updatePaymentDetail(account.gatewayPaymentDetailId, { is_active_detail: newStatus === 'live' })
          .catch((e) => console.error('Routing sync failed:', e));
      }
    } catch (e) {
      toast(e.message, 'error');
      loadNGOAccounts();
    }
  };

  // Optimistic single-field patch used by toggles / link.
  const patch = async (d, body, revertKey) => {
    setDetails((list) => list.map((x) => (x.id === d.id ? { ...x, ...body } : x)));
    try {
      await traderApi.updatePaymentDetail(d.id, body);
    } catch (e) {
      setDetails((list) => list.map((x) => (x.id === d.id ? { ...x, [revertKey]: d[revertKey] } : x)));
      toast(apiError(e), 'error');
    }
  };

  const toggleDetail = (d) => patch(d, { is_active_detail: !d.is_active_detail }, 'is_active_detail');
  const linkDetail = (d) => patch(d, { is_active: true }, 'is_active');

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
    <div>
      <PageHeader
        title="Offers & Details"
        subtitle="Manage the accounts you receive payments on"
        actions={
          <Button onClick={() => openAdd(null)}>
            <IconPlus className="h-4 w-4" />
            Add Payment Detail
          </Button>
        }
      />

      {loading ? (
        <p className="py-16 text-center text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <OffersColumn details={details} onBulkToggle={bulkToggle} onAdd={openAdd} ngoAccounts={ngoAccounts} onToggleNGO={toggleNGO} />
          <DetailsColumn details={details} onToggle={toggleDetail} onLink={linkDetail} onEdit={setEditing} onAdd={openAdd} ngoAccounts={ngoAccounts} onToggleNGO={toggleNGO} />
        </div>
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
        />
      )}
    </div>
  );
}
