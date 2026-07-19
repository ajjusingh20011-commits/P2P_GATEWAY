import { useEffect, useState } from 'react';
import { Card, Button, Section, PageHeader } from '../components/ui';
import { IconEye, IconEyeOff, IconRefresh, IconCopy, IconCheck } from '../components/icons';
import { apiCredentials as seed, maskKey } from '../utils/mock';
import { merchantApi } from '../services/api';

function CredentialRow({ label, value, onRegen }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div>
      <label className="mb-1.5 block text-sm text-gray-400">{label}</label>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-sm text-gray-300">
          {show ? value : maskKey(value)}
        </code>
        <Button variant="ghost" size="sm" onClick={() => setShow((v) => !v)}>
          {show ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
          {show ? 'Hide' : 'Show'}
        </Button>
        <Button variant="ghost" size="sm" onClick={copy}>
          {copied ? <IconCheck className="h-4 w-4" /> : <IconCopy className="h-4 w-4" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onRegen}>
          <IconRefresh className="h-4 w-4" /> Regenerate
        </Button>
      </div>
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

  const rand = (prefix) => `${prefix}${Math.abs(Date.now() % 1e10).toString(36)}${'x9f2a7b1c4d8'}`;
  const regenKey = () => setCreds((c) => ({ ...c, apiKey: rand('pk_live_') }));
  const regenSecret = () => setCreds((c) => ({ ...c, apiSecret: rand('sk_live_') }));

  const copyCode = () => {
    navigator.clipboard?.writeText(CODE);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 1500);
  };

  return (
    <div>
      <PageHeader title="API Credentials" subtitle={loading ? 'Loading credentials…' : 'Authenticate your server-to-server requests'} />

      <div className="space-y-6">
        <Section title="Keys" description="Keep these secret. Never expose them in client-side code.">
          <div className="space-y-5">
            <CredentialRow label="API Key" value={creds.apiKey} onRegen={regenKey} />
            <CredentialRow label="API Secret" value={creds.apiSecret} onRegen={regenSecret} />
          </div>
          <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-300">
            Regenerating a key immediately invalidates the previous one. Update your integration before regenerating in production.
          </p>
        </Section>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-800 p-4">
            <div>
              <h2 className="font-semibold text-white">Create an order</h2>
              <p className="mt-0.5 text-sm text-gray-400">Example request</p>
            </div>
            <Button variant="ghost" size="sm" onClick={copyCode}>
              {copiedCode ? <IconCheck className="h-4 w-4" /> : <IconCopy className="h-4 w-4" />}
              {copiedCode ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-gray-300">{CODE}</pre>
        </Card>
      </div>
    </div>
  );
}
