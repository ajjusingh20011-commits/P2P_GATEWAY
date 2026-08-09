import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  AuthCard,
  AuthError,
  AuthField,
  AuthFooter,
  AuthHeader,
  AuthProgress,
  AuthShell,
  IconArrowRight,
  IconShieldLock,
  IconUser,
  OtpInput,
  PasswordInput,
  Spinner,
} from '../components/auth';

/** Seconds left in the current TOTP window — speakeasy uses the standard 30s step. */
function totpSecondsLeft() {
  return 30 - (Math.floor(Date.now() / 1000) % 30);
}

export default function Login() {
  const navigate = useNavigate();
  const { login, validate2fa } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotNote, setForgotNote] = useState(false);

  // 2FA step-2 state — same backend flow as trader (role-agnostic 2FA), just
  // no merchant-facing settings page exists yet to actually turn it on, so
  // this step only ever renders for an account enabled some other way.
  const [tempToken, setTempToken] = useState('');
  const [code, setCode] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(totpSecondsLeft);

  // Tracks the authenticator's real rotation window rather than a decorative countdown.
  useEffect(() => {
    if (!tempToken) return undefined;
    setSecondsLeft(totpSecondsLeft());
    const id = setInterval(() => setSecondsLeft(totpSecondsLeft()), 1000);
    return () => clearInterval(id);
  }, [tempToken]);

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
    setTempToken('');
    setCode('');
    setError('');
  };

  if (tempToken) {
    return (
      <AuthShell>
        <AuthCard onSubmit={handleVerify}>
          <AuthHeader
            icon={<IconShieldLock />}
            title="Two-Factor Authentication"
            subtitle="Enter the 6-digit code from your authenticator app"
          />
          <AuthProgress step={2} />

          <AuthError>{error}</AuthError>

          <OtpInput value={code} onChange={setCode} disabled={loading} autoFocus />

          <p className="mp-otpExpiry">
            Code expires in <b>00:{String(secondsLeft).padStart(2, '0')}</b>
          </p>

          <button type="submit" className="mp-authSubmit" disabled={loading || code.length < 6}>
            {loading ? (
              <>
                <Spinner />
                Verifying…
              </>
            ) : (
              <>
                Verify Code
                <IconArrowRight />
              </>
            )}
          </button>

          <button type="button" className="mp-authLink" onClick={backToLogin}>
            Back to login
          </button>

          <AuthFooter />
        </AuthCard>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthCard onSubmit={handleSubmit}>
        <AuthHeader icon={<IconUser />} title="Merchant Login" subtitle="Access your merchant dashboard" />
        <AuthProgress step={1} />

        <AuthError>{error}</AuthError>

        <AuthField label="Email" htmlFor="mp-email">
          <input
            id="mp-email"
            className="mp-authInput"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email"
          />
        </AuthField>

        <AuthField label="Password" htmlFor="mp-password">
          <PasswordInput
            id="mp-password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            visible={showPassword}
            onToggle={() => setShowPassword((v) => !v)}
          />
        </AuthField>

        {/*
         * Same honest disclosure as trader's login — authRoutes.js has no
         * password-reset endpoint for any role, so this says so plainly
         * rather than showing a fake "reset email sent" success state.
         */}
        <div className="mp-authForgotRow">
          <button type="button" className="mp-authForgot" onClick={() => setForgotNote(true)}>
            Forgot password?
          </button>
        </div>
        {forgotNote && (
          <p className="mp-authForgotNote">Password reset isn’t available yet — contact MaxPay support.</p>
        )}

        <button type="submit" className="mp-authSubmit" disabled={loading}>
          {loading ? (
            <>
              <Spinner />
              Signing in…
            </>
          ) : (
            <>
              Next
              <IconArrowRight />
            </>
          )}
        </button>

        <AuthFooter />
      </AuthCard>
    </AuthShell>
  );
}
