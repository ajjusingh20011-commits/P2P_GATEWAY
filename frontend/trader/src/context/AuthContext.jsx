import { createContext, useContext, useEffect, useState } from 'react';
import { authApi, MOCK_USER, MOCK_TOKENS } from '../services/api';

const AuthContext = createContext(null);

// Demo credentials accepted while running without a backend.
const DEMO_PASSWORD = 'Trader@123456';
const isDemoLogin = (email, password) =>
  email.toLowerCase().includes('trader') && password === DEMO_PASSWORD;

function persistSession(user, tokens) {
  localStorage.setItem('accessToken', tokens.accessToken);
  localStorage.setItem('refreshToken', tokens.refreshToken);
  localStorage.setItem('user', JSON.stringify(user));
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Rehydrate session on load if a token is present.
  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      setLoading(false);
      return;
    }
    authApi
      .me()
      .then((res) => setUser(res.data.data.user))
      .catch(() => {
        // Fall back to a previously stored (mock) user before giving up.
        const stored = localStorage.getItem('user');
        if (stored) {
          try {
            setUser(JSON.parse(stored));
            return;
          } catch (_) {
            /* fall through */
          }
        }
        localStorage.clear();
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    try {
      const res = await authApi.login(email, password);
      const data = res.data.data;
      // Step 1 of a 2FA login: server withholds tokens until the TOTP code is
      // validated. Signal the Login page to render the code-entry step.
      if (data?.requires_2fa) {
        return { requires2fa: true, tempToken: data.temp_token, role: data.role };
      }
      const { user: u, accessToken, refreshToken } = data;
      persistSession(u, { accessToken, refreshToken });
      setUser(u);
      return u;
    } catch (err) {
      // Backend unreachable (network error) -> allow mock login for the demo account.
      if (!err.response && isDemoLogin(email, password)) {
        const u = { ...MOCK_USER, email };
        persistSession(u, MOCK_TOKENS);
        setUser(u);
        return u;
      }
      throw err;
    }
  };

  // Step 2 of a 2FA login: exchange the temp token + TOTP code for a real
  // session. Stores tokens/user exactly like a normal login.
  const validate2fa = async (tempToken, code) => {
    const res = await authApi.twoFAValidate(tempToken, code);
    const { user: u, accessToken, refreshToken } = res.data.data;
    persistSession(u, { accessToken, refreshToken });
    setUser(u);
    return u;
  };

  const logout = async () => {
    try {
      await authApi.logout(localStorage.getItem('refreshToken'));
    } catch (_) {
      /* ignore network errors on logout */
    }
    localStorage.clear();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, validate2fa, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
