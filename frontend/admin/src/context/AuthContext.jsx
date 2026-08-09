import { createContext, useContext, useEffect, useState } from 'react';
import { authApi, MOCK_USER, MOCK_TOKENS } from '../services/api';

const AuthContext = createContext(null);

function persistSession({ user, accessToken, refreshToken }) {
  if (accessToken) localStorage.setItem('accessToken', accessToken);
  if (refreshToken) localStorage.setItem('refreshToken', refreshToken);
  if (user) localStorage.setItem('user', JSON.stringify(user));
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Rehydrate the session on load. If a token exists, confirm it via /auth/me;
  // on failure fall back to any stored user (offline / mock mode).
  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    const stored = localStorage.getItem('user');
    if (!token) {
      setLoading(false);
      return;
    }

    let active = true;
    authApi
      .me()
      .then((data) => {
        if (!active) return;
        const u = data?.user || (stored ? JSON.parse(stored) : null);
        if (u) {
          setUser(u);
          localStorage.setItem('user', JSON.stringify(u));
        }
      })
      .catch(() => {
        if (!active) return;
        // Keep the session alive from storage when the backend is unreachable.
        if (stored) {
          try {
            setUser(JSON.parse(stored));
          } catch (_) {
            localStorage.clear();
          }
        }
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, []);

  const login = async (email, password) => {
    try {
      const data = await authApi.login(email, password);
      persistSession({
        user: data.user,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      });
      setUser(data.user);
      return data.user;
    } catch (err) {
      // Network error (backend down) → fall back to a mock login so the panel
      // remains usable offline. A real response error (e.g. 401) is rethrown so
      // the login form can display it.
      if (!err.response) {
        const u = { ...MOCK_USER };
        persistSession({ user: u, ...MOCK_TOKENS });
        setUser(u);
        return u;
      }
      throw err;
    }
  };

  const logout = async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    try {
      if (refreshToken) await authApi.logout(refreshToken);
    } catch (_) {
      // Ignore logout failures — clear the local session regardless.
    }
    localStorage.clear();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
