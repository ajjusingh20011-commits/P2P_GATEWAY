/**
 * MaxPay authentication UI primitives.
 *
 * Presentation only — these hold no auth state and call no APIs. The panel's
 * page component owns every handler, so the merchant and admin panels can adopt
 * this exact visual system by swapping wording alone.
 */
import { useEffect, useRef } from 'react';
import './auth.css';

/* ── Icons (inline: the panel's icons.jsx has no shield/eye set) ──────────── */

export function IconShield({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

export function IconShieldLock({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12h6v4H9z" />
      <path d="M10.5 12v-1.5a1.5 1.5 0 0 1 3 0V12" />
    </svg>
  );
}

export function IconUser({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

function IconEye({ open }) {
  return open ? (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a3 3 0 004.2 4.2" />
      <path d="M9.4 5.2A9.6 9.6 0 0112 5c6.4 0 10 7 10 7a17.9 17.9 0 01-3.4 4.3M6.2 6.3A17.7 17.7 0 002 12s3.6 7 10 7a9.7 9.7 0 003.3-.56" />
    </svg>
  );
}

export function IconArrowRight({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  );
}

export function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

/* ── Shell ───────────────────────────────────────────────────────────────── */

export function AuthShell({ children }) {
  return (
    <div className="mp-auth">
      <header className="mp-authTop">
        <span className="mp-authBrand">
          <b>M</b>
          MaxPay
        </span>
        <span className="mp-authSecure">
          <IconShield />
          Secure &amp; Encrypted
        </span>
      </header>
      <main className="mp-authMain">{children}</main>
    </div>
  );
}

export function AuthCard({ children, onSubmit }) {
  return (
    <form className="mp-authCard" onSubmit={onSubmit} noValidate={false}>
      {children}
    </form>
  );
}

export function AuthHeader({ icon, title, subtitle }) {
  return (
    <>
      <div className="mp-authIcon">{icon}</div>
      <h1 className="mp-authTitle">{title}</h1>
      <p className="mp-authSubtitle">{subtitle}</p>
    </>
  );
}

/** Two-step indicator: 1 Login ───── 2 Verify. */
export function AuthProgress({ step }) {
  return (
    <div className="mp-authProgress" role="presentation">
      <span className={`mp-authStep ${step === 1 ? 'active' : 'done'}`}>
        <i>1</i>
        Login
      </span>
      <hr />
      <span className={`mp-authStep ${step === 2 ? 'active' : ''}`}>
        <i>2</i>
        Verify
      </span>
    </div>
  );
}

export function AuthField({ label, htmlFor, children }) {
  return (
    <div className="mp-authField">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

export function PasswordInput({ visible, onToggle, ...props }) {
  return (
    <div className="mp-authInputWrap">
      <input {...props} type={visible ? 'text' : 'password'} className="mp-authInput" />
      <button
        type="button"
        className="mp-authReveal"
        onClick={onToggle}
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        <IconEye open={visible} />
      </button>
    </div>
  );
}

export function AuthError({ children }) {
  if (!children) return null;
  return (
    <div className="mp-authError" role="alert">
      {children}
    </div>
  );
}

export function AuthFooter() {
  return (
    <p className="mp-authFoot">
      <IconShield size={12} />
      Secure connection
    </p>
  );
}

/* ── OTP ─────────────────────────────────────────────────────────────────── */

const OTP_LENGTH = 6;

/**
 * Six single-character boxes over one controlled string.
 *
 * The value stays a plain 6-digit string so the caller keeps passing exactly
 * what it passed before — the boxes are a rendering of that string, not a new
 * data shape.
 */
export function OtpInput({ value, onChange, disabled, autoFocus }) {
  const refs = useRef([]);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  const handleChange = (index, raw) => {
    const typed = raw.replace(/\D/g, '');
    if (!typed) return;

    // Typing/pasting several digits at once fills forward from this box.
    if (typed.length > 1) {
      const chars = value.split('');
      for (let i = 0; i < typed.length && index + i < OTP_LENGTH; i++) chars[index + i] = typed[i];
      onChange(chars.join('').slice(0, OTP_LENGTH));
      refs.current[Math.min(index + typed.length, OTP_LENGTH - 1)]?.focus();
      return;
    }

    const chars = value.padEnd(OTP_LENGTH, ' ').split('');
    chars[index] = typed;
    onChange(chars.join('').replace(/ /g, '').slice(0, OTP_LENGTH));
    refs.current[Math.min(index + 1, OTP_LENGTH - 1)]?.focus();
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const chars = value.padEnd(OTP_LENGTH, ' ').split('');
      // Clear this box, or step back and clear the previous one when empty.
      const target = chars[index] !== ' ' && chars[index] !== undefined ? index : Math.max(index - 1, 0);
      chars[target] = ' ';
      onChange(chars.join('').replace(/ /g, '').slice(0, OTP_LENGTH));
      refs.current[target]?.focus();
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      refs.current[Math.max(index - 1, 0)]?.focus();
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      refs.current[Math.min(index + 1, OTP_LENGTH - 1)]?.focus();
    }
  };

  const handlePaste = (index, e) => {
    const pasted = (e.clipboardData.getData('text') || '').replace(/\D/g, '');
    if (!pasted) return;
    e.preventDefault();
    const chars = value.padEnd(OTP_LENGTH, ' ').split('');
    for (let i = 0; i < pasted.length && index + i < OTP_LENGTH; i++) chars[index + i] = pasted[i];
    const next = chars.join('').replace(/ /g, '').slice(0, OTP_LENGTH);
    onChange(next);
    refs.current[Math.min(index + pasted.length, OTP_LENGTH - 1)]?.focus();
  };

  return (
    <div className="mp-otp">
      {Array.from({ length: OTP_LENGTH }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={OTP_LENGTH}
          disabled={disabled}
          value={value[i] ?? ''}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={(e) => handlePaste(i, e)}
          onFocus={(e) => e.target.select()}
          aria-label={`Digit ${i + 1} of ${OTP_LENGTH}`}
        />
      ))}
    </div>
  );
}
