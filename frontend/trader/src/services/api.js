import axios from 'axios';

// The role this panel is allowed to authenticate.
export const PANEL_ROLE = 'trader';

const BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';

// ---------------------------------------------------------------------------
// OFFLINE / MOCK MODE
// Lets the dashboard run before the backend exists. When a request fails with
// a network error (backend unreachable), we resolve most calls with mock data
// instead of surfacing an error. Login is deliberately NOT mocked here so that
// AuthContext can validate the demo credentials itself.
// ---------------------------------------------------------------------------
export const MOCK_USER = {
  id: 1,
  email: 'trader@p2p.com',
  name: 'Test Trader',
  role: 'trader',
  balance_usdt: '4073.80',
};

export const MOCK_TOKENS = {
  accessToken: 'mock.access.token',
  refreshToken: 'mock.refresh.token',
};

// True when there is no HTTP response at all (server down, CORS, DNS, etc.).
const isNetworkError = (error) => !error.response;

function mockResponseFor(config) {
  const url = config?.url || '';
  const ok = (data) => ({ data: { success: true, data }, status: 200, mock: true, config });

  if (url.includes('/auth/me')) return ok({ user: MOCK_USER });
  if (url.includes('/auth/refresh')) return ok({ ...MOCK_TOKENS });
  if (url.includes('/auth/logout')) return ok({});

  // Generic fallback for any future data endpoint.
  return ok([]);
}

const api = axios.create({
  baseURL: BASE,
  headers: { 'Content-Type': 'application/json' },
});

// Attach the access token to every request.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Transparently refresh the access token once on expiry, then retry.
let refreshing = null;
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    const code = error.response?.data?.code;

    if (status === 401 && code === 'TOKEN_EXPIRED' && original && !original._retry) {
      original._retry = true;
      try {
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) throw new Error('no refresh token');
        refreshing = refreshing || axios.post(`${BASE}/auth/refresh`, { refreshToken });
        const { data } = await refreshing;
        refreshing = null;
        localStorage.setItem('accessToken', data.data.accessToken);
        localStorage.setItem('refreshToken', data.data.refreshToken);
        original.headers.Authorization = `Bearer ${data.data.accessToken}`;
        return api(original);
      } catch (e) {
        refreshing = null;
        localStorage.clear();
        window.location.href = '/login';
        return Promise.reject(e);
      }
    }

    // Any OTHER 401 (not a transparent refresh): the session is invalid.
    // Clear storage and send the user back to login.
    if (status === 401 && !original?.url?.includes('/auth/login')) {
      localStorage.clear();
      window.location.href = '/login';
      return Promise.reject(error);
    }

    // Backend unreachable: serve mock data so the UI keeps working.
    // Login is excluded — AuthContext validates the demo credentials.
    if (isNetworkError(error) && original && !original.url?.includes('/auth/login')) {
      return Promise.resolve(mockResponseFor(original));
    }

    return Promise.reject(error);
  }
);

export const authApi = {
  login: (email, password) => api.post('/auth/login', { email, password, role: PANEL_ROLE }),
  logout: (refreshToken) => api.post('/auth/logout', { refreshToken }),
  me: () => api.get('/auth/me'),
  // Two-factor authentication.
  twoFAStatus: () => api.get('/auth/2fa/status'),
  twoFASetup: () => api.get('/auth/2fa/setup'),
  twoFAVerifySetup: (token) => api.post('/auth/2fa/verify-setup', { token }),
  twoFADisable: (totp_code, password) => api.post('/auth/2fa/disable', { totp_code, password }),
  twoFAValidate: (temp_token, totp_code) => api.post('/auth/2fa/validate', { temp_token, totp_code }),
};

// Trader-scoped data endpoints. Every response is enveloped as
// { success, data }, so callers read `res.data.data`.
export const traderApi = {
  dashboard: () => api.get('/trader/dashboard'),
  commission: (period) => api.get('/trader/commission', { params: period ? { period } : {} }),
  setOnline: (is_online) => api.put('/trader/online-status', { is_online }),
  orders: (status) => api.get('/orders', { params: status ? { status } : {} }),
  notifications: () => api.get('/trader/notifications'),
  payouts: () => api.get('/trader/payouts'),
  paymentDetails: () => api.get('/trader/payment-details'),
  addPaymentDetail: (body) => api.post('/trader/payment-details', body),
  updatePaymentDetail: (id, body) => api.put(`/trader/payment-details/${id}`, body),
  deletePaymentDetail: (id) => api.delete(`/trader/payment-details/${id}`),

  // Payout requests ("Buy USDT") — merchant payouts this trader can process.
  payoutRequests: (status) => api.get('/trader/payout-requests', { params: status ? { status } : {} }),
  acceptPayout: (id) => api.post(`/trader/payout-requests/${id}/accept`),
  processPayout: (id) => api.get(`/trader/payout-requests/${id}/process`),
  transferredPayout: (id, body) => api.post(`/trader/payout-requests/${id}/transferred`, body || {}),
  cancelPayout: (id) => api.post(`/trader/payout-requests/${id}/cancel`),
  problemPayout: (id, body) => api.post(`/trader/payout-requests/${id}/problem`, body || {}),
};

export default api;
