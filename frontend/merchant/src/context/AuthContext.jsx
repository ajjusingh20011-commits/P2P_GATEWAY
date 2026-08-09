import { createContext, useContext, useEffect, useState } from 'react';
import { authApi } from '../services/api';

const AuthContext = createContext(null);

function persistSession(user, tokens) {
  localStorage.setItem('accessToken', tokens.accessToken);
  localStorage.setItem('refreshToken', tokens.refreshToken);
  localStorage.setItem('user', JSON.stringify(user));
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Rehydrate session from localStorage on load — no network call.
  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    const stored = localStorage.getItem('user');
    if (token && stored) {
      try {
        setUser(JSON.parse(stored));
      } catch (_) {
        localStorage.clear();
      }
    }
    setLoading(false);
  }, []);

  // Authenticate against the backend as a merchant.
  const login = async (email, password) => {
    const res = await authApi.login(email, password);
    const data = res.data.data;
    // Account has 2FA enabled — defer session until the code is validated.
    if (data.requires_2fa) {
      return { requires2fa: true, tempToken: data.temp_token };
    }
    const { user: u, accessToken, refreshToken } = data;
    persistSession(u, { accessToken, refreshToken });
    setUser(u);
    return u;
  };

  // Step 2 of a 2FA login: exchange the temp token + TOTP code for a session.
  const validate2fa = async (tempToken, code) => {
    const res = await authApi.twoFAValidate(tempToken, code);
    const { user: u, accessToken, refreshToken } = res.data.data;
    persistSession(u, { accessToken, refreshToken });
    setUser(u);
    return u;
  };

  const logout = async () => {
    try {
      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken) await authApi.logout(refreshToken);
    } catch (_) {
      // Best-effort — clear the local session regardless.
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
