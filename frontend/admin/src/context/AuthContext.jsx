import { createContext, useContext, useEffect, useState } from 'react';
import { authApi } from '../services/api';

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
  // on failure (e.g. a transient network error) fall back to the previously
  // stored real user rather than forcing a re-login — a genuinely invalid/
  // expired token still gets caught by the response interceptor's 401 handler.
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
    const data = await authApi.login(email, password);
    // Step 1 of a 2FA login: server withholds tokens until the TOTP code is
    // validated. Signal the Login page to render the code-entry step.
    if (data.requires_2fa) {
      return { requires2fa: true, tempToken: data.temp_token };
    }
    persistSession({
      user: data.user,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });
    setUser(data.user);
    return data.user;
  };

  // Step 2 of a 2FA login: exchange the temp token + TOTP code for a session.
  const validate2fa = async (tempToken, code) => {
    const data = await authApi.twoFAValidate(tempToken, code);
    persistSession({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken });
    setUser(data.user);
    return data.user;
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
