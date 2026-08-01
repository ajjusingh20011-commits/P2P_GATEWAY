import { useEffect, useState } from 'react';
import { Card, Badge, Button, PageHeader, Modal } from '../components/ui';
import { IconEye, IconEyeOff, IconRefresh, IconCopy, IconCheck } from '../components/icons';
import { apiCredentials as seed, maskKey } from '../utils/mock';
import { merchantApi } from '../services/api';

// Design's walletBox chip (label + code + icon actions in one row), matching
// MaxPayDesign's API-key card visual — the underlying action is still the
// single real regenerate() call below (this system has no per-key rotation).
function CredentialRow({ label, value, show, onToggleShow, onRegen }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div
      className="flex flex-wrap items-center gap-3"
      style={{ border: '1px solid var(--cardborder)', background: 'var(--hover)', borderRadius: 12, padding: '12px 14px' }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', margin: 0 }}>{label}</p>
        <code className="block truncate" style={{ color: 'var(--text)', fontSize: 13, marginTop: 4 }}>{show ? value : maskKey(value)}</code>
      </div>
      <button type="button" className="tf-hbtn" onClick={onToggleShow} aria-label={show ? `Hide ${label}` : `Reveal ${label}`}>
        {show ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
      </button>
      <button type="button" className="tf-hbtn" onClick={copy} aria-label={`Copy ${label}`}>
        {copied ? <IconCheck className="h-4 w-4" /> : <IconCopy className="h-4 w-4" />}
      </button>
      <Button variant="ghost" size="sm" onClick={onRegen}>
        <IconRefresh className="h-4 w-4" /> Regenerate
      </Button>
    </div>
  );
}

const CODE = `POST /api/orders/create
Host: api.p2p-gateway.com

Headers:
  X-API-Key: {your_api_key}
  X-API-Secret: {your_api_secret}
  Content-Type: application/json

Body:
{
  "amount": 5000,
  "customer_ref": "INV-2043"
}

Response 201:
{
  "order_id": "ORD-48210",
  "checkout_url": "https://checkout.p2p-gateway.com/?order=ORD-48210",
  "expires_in": 600
}`;

export default function ApiCredentials() {
  const [creds, setCreds] = useState(seed);
  const [copiedCode, setCopiedCode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showKey, setShowKey] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  // Confirm-then-regenerate — POST /merchant/api-credentials/regenerate
  // atomically rotates BOTH key and secret together (see
  // merchantController.regenerateApiCredentials), so both rows share one
  // real, confirmed action rather than faking two independent regenerations
  // in local state.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState('');

  // Load the real (masked) API key. The secret is not returned by GET —
  // keep the mock secret for the hidden/masked display. On error keep the mock.
  useEffect(() => {
    let alive = true;
    merchantApi
      .apiCredentials()
      .then((res) => {
        if (!alive) return;
        const d = res.data.data;
        setCreds((c) => ({ ...c, apiKey: d.api_key || d.api_key_masked || c.apiKey }));
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const confirmRegenerate = async () => {
    setRegenerating(true);
    setRegenError('');
    try {
      const res = await merchantApi.regenerateApiCredentials();
      const d = res.data.data;
      setCreds((c) => ({ ...c, apiKey: d.api_key, apiSecret: d.api_secret }));
      setShowKey(true);
      setShowSecret(true);
      setConfirmOpen(false);
    } catch (err) {
      setRegenError(err.response?.data?.message || 'Could not regenerate credentials. Please try again.');
    } finally {
      setRegenerating(false);
    }
  };

  const copyCode = () => {
    navigator.clipboard?.writeText(CODE);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 1500);
  };

  return (
    <div>
      <PageHeader
        title="API Credentials"
        subtitle={loading ? 'Loading credentials…' : 'Authenticate your server-to-server requests'}
      />

      <div className="space-y-6">
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: 0 }}>API keys</h2>
              <p style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0 0' }}>Live keys — process real payments. Keep them secret.</p>
            </div>
            <Badge color="green">Live</Badge>
          </div>
          <div className="mt-4 space-y-3">
            <CredentialRow label="API Key" value={creds.apiKey} show={showKey} onToggleShow={() => setShowKey((v) => !v)} onRegen={() => setConfirmOpen(true)} />
            <CredentialRow label="API Secret" value={creds.apiSecret} show={showSecret} onToggleShow={() => setShowSecret((v) => !v)} onRegen={() => setConfirmOpen(true)} />
          </div>
          <p className="mt-4 rounded-lg border px-4 py-2.5 text-xs" style={{ borderColor: 'rgba(245,158,11,0.3)', background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>
            Regenerating rotates both the key and secret together and immediately invalidates the previous pair. Update your integration before regenerating in production.
          </p>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--cardborder)' }}>
            <div>
              <h2 className="font-semibold" style={{ color: 'var(--text)' }}>Create an order</h2>
              <p className="mt-0.5 text-sm" style={{ color: 'var(--muted)' }}>Example request</p>
            </div>
            <Button variant="ghost" size="sm" onClick={copyCode}>
              {copiedCode ? <IconCheck className="h-4 w-4" /> : <IconCopy className="h-4 w-4" />}
              {copiedCode ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed" style={{ color: 'var(--text)' }}>{CODE}</pre>
        </Card>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => { if (!regenerating) { setConfirmOpen(false); setRegenError(''); } }}
        size="md"
        title="Regenerate API credentials?"
        subtitle="This is a real, immediate action against your live account."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={regenerating}>Cancel</Button>
            <Button variant="danger" onClick={confirmRegenerate} disabled={regenerating}>{regenerating ? 'Regenerating…' : 'Regenerate now'}</Button>
          </>
        }
      >
        <div className="space-y-3 text-sm" style={{ color: 'var(--text)' }}>
          <p>
            This will immediately generate a new API key <strong>and</strong> a new API secret for your account,
            and permanently invalidate the current pair.
          </p>
          <p style={{ color: 'var(--muted)' }}>
            This cannot be undone. Any live integration using the current key/secret will stop authenticating
            until you update it with the new credentials shown after regeneration.
          </p>
          {regenError && <p style={{ color: '#ef4444' }}>{regenError}</p>}
        </div>
      </Modal>
    </div>
  );
}
