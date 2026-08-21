import api from '../services/api';

// Real ngo-backend socket origin — sockets still connect directly (not
// proxied through backend/), but authenticate via a short-lived token from
// getNgoSocketToken() below instead of a client-supplied room name.
const NGO_BASE = import.meta.env.VITE_NGO_API_BASE_URL || 'http://localhost:3000/api';
export const NGO_SOCKET_ORIGIN = NGO_BASE.replace(/\/api\/?$/, '');

// Every REST call below goes through backend/'s /trader/ngo-proxy/* relay,
// authenticated with this trader's own real accessToken (same one every
// other traderApi.* call already uses — see services/api.js's request
// interceptor). backend/ mints a fresh short-lived signed service token per
// call and forwards to ngo-backend; no shared ngo_staff login, no ngoId,
// nothing to store in localStorage anymore.
const PROXY = '/trader/ngo-proxy';

// api (axios) throws on any non-2xx response, unlike the old fetch()-based
// version of this file, which checked res.status/json.success by hand.
// Normalize both into a plain thrown Error carrying ngo-backend's own
// message, so every caller's existing `catch (e) { ... e.message }` still
// works unchanged.
async function unwrap(promise) {
  let res;
  try {
    res = await promise;
  } catch (err) {
    throw new Error(err.response?.data?.message || err.message);
  }
  if (!res.data.success) throw new Error(res.data.message || 'Request failed');
  return res.data;
}

// Short-lived token for this trader's direct Socket.IO connection to
// ngo-backend — pass as `auth: { serviceToken }` when calling io(...).
export async function getNgoSocketToken() {
  const data = await unwrap(api.get('/trader/ngo-socket-token'));
  return data.data.token;
}

export async function saveAPKAccount(data) {
  return unwrap(api.post(`${PROXY}/ngo/accounts`, {
    type: 'apk',
    platform: data.platform,
    upiId: data.upiId,
    displayName: data.displayName,
  }));
}

export async function saveWebAccount(data) {
  return unwrap(api.post(`${PROXY}/ngo/accounts`, {
    type: 'web',
    platform: data.platform,
    upiId: data.upiId,
    displayName: data.displayName,
    loginEmail: data.loginEmail,
    loginPassword: data.loginPassword,
    loginPhone: data.loginPhone,
  }));
}

export async function getAccounts() {
  const res = await unwrap(api.get(`${PROXY}/ngo/accounts`));
  return res.data;
}

// Returns { account, reconnect } — reconnect is only present when turning ON
// triggered a cookie-first reconnect attempt (web-login account, no live
// session), and reports what that attempt actually did (live / needsOTP /
// failed) so the caller can react instead of assuming success.
export async function toggleAccount(accountId, status) {
  const res = await unwrap(api.patch(`${PROXY}/ngo/accounts/${accountId}/toggle`, { status }));
  return { account: res.data, reconnect: res.reconnect || null };
}

// Edit account details (title, organization, limits) — separate from the
// live/paused toggle above.
export async function updateAccount(accountId, data) {
  const res = await unwrap(api.patch(`${PROXY}/ngo/accounts/${accountId}`, data));
  return res.data;
}

// Delete an account permanently. If it's a web-login account with a live
// scraper session, the backend closes that session and removes its saved
// cookie file before deleting the record.
export async function deleteAccount(accountId) {
  return unwrap(api.delete(`${PROXY}/ngo/accounts/${accountId}`));
}

// Scraper/APK-sourced transactions — this is where real payment events
// actually land (see ngo-backend's webScraper.js fetchAndSaveTransactions),
// unlike the P2P gateway's MySQL NotificationLog table, which nothing
// currently writes to.
// One server page of captured transactions. Returns the FULL paginated
// response ({ transactions, total, pages }), not just the array — the caller
// needs `total` to know whether older history remains to load. The endpoint
// defaults to only the newest 20 with no params, which is why every older
// entry was invisible before this passed page/limit (BUG-52).
export async function getTransactions(page = 1, limit = 50) {
  return unwrap(api.get(`${PROXY}/ngo/transactions?page=${page}&limit=${limit}`));
}

// Payout evidence capture status for a payout — the record/screenshot/SMS flags
// the Buy USDT ProcessModal checklist shows. Pass both the payout uuid and id
// (the device may have captured under either — robust match, see the ngo route).
// `full` pulls the heavy screenshot payload too, so the trader can SEE what was
// captured on their own payout. It stays safe: the ngo route scopes evidence to
// the requesting trader (resolveTraderFilter), so this only ever returns their
// own capture — never another trader's.
export async function getPayoutEvidence(orderIds, { full = false } = {}) {
  const orderId = (Array.isArray(orderIds) ? orderIds : [orderIds]).filter(Boolean).join(',');
  const q = `orderId=${encodeURIComponent(orderId)}${full ? '&full=1' : ''}`;
  const res = await unwrap(api.get(`${PROXY}/ngo/payout-evidence?${q}`));
  return res.evidence;
}

// Start connect process
export async function connectAccount(accountId) {
  return unwrap(api.post(`${PROXY}/ngo/accounts/${accountId}/connect`));
}

// Submit OTP
export async function verifyOTP(accountId, otp) {
  return unwrap(api.post(`${PROXY}/ngo/accounts/${accountId}/verify-otp`, { otp }));
}

// Get account status
export async function getAccountStatus(accountId) {
  try {
    const res = await api.get(`${PROXY}/ngo/accounts/${accountId}/status`);
    return res.data;
  } catch (err) {
    return err.response?.data || { success: false, message: err.message };
  }
}

// Manual sync
export async function syncAccount(accountId) {
  return unwrap(api.post(`${PROXY}/ngo/accounts/${accountId}/sync`));
}

export async function generateLicense() {
  return unwrap(api.post(`${PROXY}/apk/generate-license`));
}

export async function getDevices() {
  const res = await unwrap(api.get(`${PROXY}/apk/devices`));
  return res.devices;
}

// Rename a paired device (trader-assigned display name).
export async function renameDevice(deviceId, deviceName) {
  const res = await unwrap(api.patch(`${PROXY}/apk/devices/${deviceId}`, { deviceName }));
  return res.device;
}

// Permanently delete a device (real backend DELETE, not a client-side hide).
export async function deleteDevice(deviceId) {
  return unwrap(api.delete(`${PROXY}/apk/devices/${deviceId}`));
}

// Real-time liveness check for one device (for gating actions like linking
// a Details account into an Offer) — same ~15s heartbeat window as the
// Smartphones page's online dot, computed fresh server-side each call.
export async function getDeviceLiveness(deviceId) {
  const devices = await getDevices();
  return devices.find((d) => d.deviceId === deviceId) || null;
}
