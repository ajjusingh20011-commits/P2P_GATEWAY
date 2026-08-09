import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui.jsx';

export default function Login() {
  const navigate = useNavigate();
  const { login, validate2fa } = useAuth();
  const [theme] = useState(() => localStorage.getItem('panel-theme') || 'light');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 2FA step-2 state.
  const [tempToken, setTempToken] = useState(null);
  const [code, setCode] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(email.trim(), password);
      if (result?.requires2fa) {
        setTempToken(result.tempToken);
        setCode('');
      } else {
        navigate('/dashboard', { replace: true });
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await validate2fa(tempToken, code.trim());
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const backToLogin = () => {
    setTempToken(null);
    setCode('');
    setError('');
  };

  const spinner = (
    <svg className="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );

  const inputStyle = {
    background: 'var(--input-bg)',
    borderColor: 'var(--input-border)',
    color: 'var(--text)',
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
            className="mx-auto mb-4 flex h-[52px] w-[52px] items-center justify-center rounded-xl text-lg font-extrabold text-white"
            style={{ background: 'linear-gradient(145deg,#5b55ee,#3d36bd)', boxShadow: '0 7px 20px rgba(79,70,229,.3)' }}
          >
            M
          </div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text)' }}>
            MaxPay Trader
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            {tempToken ? 'Enter your authenticator code' : 'Sign in to your trader account'}
          </p>
        </div>

        {tempToken ? (
          <form onSubmit={handleVerify} className="tf-card space-y-5 p-8">
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
                Two-factor code
              </label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                style={inputStyle}
                className="w-full rounded-lg border px-3.5 py-2.5 text-center text-lg tracking-[0.4em] outline-none focus:ring-1"
              />
              <p className="mt-1.5 text-xs" style={{ color: 'var(--subtle)' }}>
                Open your authenticator app and enter the 6-digit code.
              </p>
            </div>

            <Button type="submit" disabled={loading || code.length < 6} className="w-full">
              {loading ? (
                <>
                  {spinner}
                  Verifying…
                </>
              ) : (
                'Verify'
              )}
            </Button>

            <button
              type="button"
              onClick={backToLogin}
              className="w-full text-center text-xs font-medium hover:opacity-80"
              style={{ color: 'var(--muted)' }}
            >
              Back to sign in
            </button>
          </form>
        ) : (
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
                style={inputStyle}
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
                  style={inputStyle}
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
                  {spinner}
                  Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </Button>
          </form>
        )}

        <p className="mt-6 text-center text-xs" style={{ color: 'var(--subtle)' }}>
          P2P UPI Payment Gateway · Trader Panel
        </p>
      </div>
    </div>
  );
}
