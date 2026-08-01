import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui.jsx';

export default function Admin() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [theme] = useState(() => localStorage.getItem('panel-theme') || 'light');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email.trim(), password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="tf-scope flex min-h-screen items-center justify-center px-4"
      data-theme={theme}
      style={{ background: 'var(--bg)' }}
    >
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl text-lg font-bold text-white"
            style={{ background: 'linear-gradient(145deg,#f4626a,#c62f35)', boxShadow: '0 7px 20px rgba(229,72,77,.24)' }}
          >
            M
          </div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text)' }}>
            MaxPay Admin
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            Restricted access — administrators only
          </p>
        </div>

        <form onSubmit={handleSubmit} className="tf-card space-y-5 p-8">
          {error && (
            <div
              className="rounded-lg border px-4 py-2.5 text-sm"
              style={{ borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
            >
              {error}
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--text)' }}>
              Email
            </label>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--text)' }}
              className="w-full rounded-lg border px-3.5 py-2.5 outline-none focus:ring-1"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--text)' }}>
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--text)' }}
                className="w-full rounded-lg border px-3.5 py-2.5 pr-16 outline-none focus:ring-1"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 px-3 text-xs font-medium hover:opacity-80"
                style={{ color: 'var(--muted)' }}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? (
              <>
                <svg className="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </Button>
        </form>

        <div
          className="mt-4 rounded-lg border px-4 py-3 text-center text-xs"
          style={{ borderColor: 'var(--cardborder)', background: 'var(--hover)', color: 'var(--muted)' }}
        >
          Demo mode · any email &amp; password signs you in as admin
        </div>

        <p className="mt-6 text-center text-xs" style={{ color: 'var(--subtle, var(--muted))' }}>
          P2P UPI Payment Gateway · MaxPay Admin
        </p>
      </div>
    </div>
  );
}
