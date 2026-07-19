import axios from 'axios';

// The role this panel is allowed to authenticate.
export const PANEL_ROLE = 'merchant';

const BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';

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

    // Any other 401: session is invalid — clear and redirect to login.
    if (status === 401) {
      localStorage.clear();
      window.location.href = '/login';
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

// Merchant endpoints. Every successful response is enveloped as
// { success: true, data: {...} } — callers should read `res.data.data`.
export const merchantApi = {
  dashboard: () => api.get('/merchant/dashboard'),
  orders: (status) => api.get('/merchant/orders', { params: status ? { status } : undefined }),
  createOrder: (body) => api.post('/merchant/orders', body),
  transactions: () => api.get('/merchant/transactions'),
  balance: () => api.get('/merchant/balance'),
  apiCredentials: () => api.get('/merchant/api-credentials'),
  setWebhook: (webhook_url) => api.post('/merchant/webhook', { webhook_url }),

  // Payout requests — merchant creates a payout, then tracks its status.
  createPayout: (body) => api.post('/payout-requests', body),
  myPayouts: (status) => api.get('/payout-requests/my', { params: status ? { status } : {} }),
};

// Kept for the offline mock-login fallback in AuthContext.
export const MOCK_USER = {
  id: 1,
  email: 'merchant@p2p.com',
  name: 'Test Store',
  businessName: 'Test Store',
  role: 'merchant',
};

export const MOCK_TOKENS = {
  accessToken: 'mock.access.token',
  refreshToken: 'mock.refresh.token',
};

export default api;
