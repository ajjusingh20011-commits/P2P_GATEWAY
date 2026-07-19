import axios from 'axios';

// The role this panel is allowed to authenticate.
export const PANEL_ROLE = 'admin';

const BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';

// ---------------------------------------------------------------------------
// OFFLINE / MOCK helpers
// The panel can run before the backend exists. AuthContext falls back to a
// mock login on network errors; these constants back that flow.
// ---------------------------------------------------------------------------
export const MOCK_USER = {
  id: 1,
  email: 'admin@p2p.com',
  name: 'Platform Admin',
  role: 'admin',
};

export const MOCK_TOKENS = {
  accessToken: 'mock.access.token',
  refreshToken: 'mock.refresh.token',
};

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

// On 401 (expired / invalid token or refresh failure): clear session and
// redirect to the login screen.
api.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url || '';
    // Don't hijack the login request — the form needs to show its own error.
    if (status === 401 && !url.includes('/auth/login')) {
      localStorage.clear();
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Unwrap the standard envelope: { success: true, data: {...} } -> data.
const unwrap = (res) => res.data?.data;

export const authApi = {
  login: (email, password) =>
    api.post('/auth/login', { email, password, role: PANEL_ROLE }).then(unwrap),
  logout: (refreshToken) => api.post('/auth/logout', { refreshToken }).then(unwrap),
  me: () => api.get('/auth/me').then(unwrap),
};

export const adminApi = {
  dashboard: () => api.get('/admin/dashboard').then(unwrap),

  listTraders: (params) => api.get('/admin/traders', { params }).then(unwrap),
  createTrader: (payload) => api.post('/admin/traders', payload).then(unwrap),
  createTraderFull: (payload) => api.post('/admin/traders/create', payload).then(unwrap),
  updateTrader: (id, payload) => api.put(`/admin/traders/${id}`, payload).then(unwrap),
  updateTraderBalance: (id, payload) => api.put(`/admin/traders/${id}/balance`, payload).then(unwrap),
  updateTraderCommission: (id, payload) => api.put(`/admin/traders/${id}/commission`, payload).then(unwrap),
  setTraderOnline: (id, is_online) => api.put(`/admin/traders/${id}/online-status`, { is_online }).then(unwrap),
  suspendTrader: (id, suspended) => api.put(`/admin/traders/${id}/suspend`, { suspended }).then(unwrap),

  listMerchants: (params) => api.get('/admin/merchants', { params }).then(unwrap),
  createMerchant: (payload) => api.post('/admin/merchants', payload).then(unwrap),
  createMerchantFull: (payload) => api.post('/admin/merchants/create', payload).then(unwrap),
  updateMerchant: (id, payload) => api.put(`/admin/merchants/${id}`, payload).then(unwrap),
  updateMerchantFees: (id, payload) => api.put(`/admin/merchants/${id}/fees`, payload).then(unwrap),

  getSettings: () => api.get('/admin/settings').then(unwrap),
  updateSettings: (payload) => api.put('/admin/settings', payload).then(unwrap),

  listOrders: (params) => api.get('/admin/orders', { params }).then(unwrap),
  // Admin approve / reject / override an order.
  updateOrder: (id, payload) => api.put(`/admin/orders/${id}`, payload).then(unwrap),
  // Order System v2 review/settlement endpoints.
  reviewOrder: (id) => api.put(`/admin/orders/${id}/review`).then(unwrap),
  confirmOrderV2: (id, payload) => api.put(`/admin/orders/${id}/confirm`, payload || {}).then(unwrap),
  rejectOrderV2: (id, reason) => api.put(`/admin/orders/${id}/reject`, { reason }).then(unwrap),
  disputeOrderV2: (id, reason) => api.put(`/admin/orders/${id}/dispute`, { reason }).then(unwrap),

  listDisputes: (params) => api.get('/admin/disputes', { params }).then(unwrap),
  resolveDispute: (id, payload) =>
    api.put(`/admin/disputes/${id}/resolve`, payload).then(unwrap),

  // Payout requests ("Buy USDT") — admin settlement/moderation.
  listPayoutRequests: (params) => api.get('/admin/payout-requests', { params }).then(unwrap),
  approvePayoutRequest: (id) => api.post(`/admin/payout-requests/${id}/approve`).then(unwrap),
  rejectPayoutRequest: (id, reason) => api.post(`/admin/payout-requests/${id}/reject`, { reason }).then(unwrap),
  resolvePayoutDispute: (id, payload) => api.post(`/admin/payout-requests/${id}/dispute-resolve`, payload).then(unwrap),
};

// Order lifecycle actions. `id` is the order UUID (exposed as the order's
// `uuid`/`id` field in the admin orders list). Uses the default axios instance
// so the Bearer token + 401 handling apply.
//   - confirm (approve)  → PUT /admin/orders/:id  { status: 'confirmed' }
//   - reject             → PUT /admin/orders/:id  { status: 'cancelled' }
//   - dispute            → POST /orders/:id/dispute
export const orderApi = {
  confirmOrder: (id) => adminApi.updateOrder(id, { status: 'confirmed' }),
  cancelOrder: (id) => adminApi.updateOrder(id, { status: 'cancelled' }),
  disputeOrder: (id, reason) => api.post(`/orders/${id}/dispute`, { reason }).then(unwrap),
  overrideOrder: (id, status) => adminApi.updateOrder(id, { status }),
};

export default api;
