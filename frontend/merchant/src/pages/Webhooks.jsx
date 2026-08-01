import { useState } from 'react';
import { Card, Badge, Button, Input, PageHeader } from '../components/ui';
import { IconCheck, IconRefresh } from '../components/icons';
import { webhookLogs as seedLogs, profile } from '../utils/mock';
import { merchantApi } from '../services/api';

// No GET endpoint returns the merchant's saved webhook_url (confirmed —
// only POST /merchant/webhook exists), so there's no real way to fetch the
// current server value on load. Falling back to the last URL this browser
// itself successfully saved is honest (it's a real save this session made,
// not fabricated) and strictly better than showing an unrelated example.com
// placeholder as if it were live data — but it's still a local cache, not a
// true server round-trip, so it won't reflect a save made elsewhere.
const LAST_SAVED_KEY = 'merchant-webhook-last-saved-url';

export default function Webhooks() {
  const [url, setUrl] = useState(() => localStorage.getItem(LAST_SAVED_KEY) || profile.webhookUrl);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [testing, setTesting] = useState(false);
  const [logs, setLogs] = useState(seedLogs);

  // Real save — POST /merchant/webhook (merchantApi.setWebhook).
  const save = async () => {
    setSaving(true);
    setSaveError('');
    try {
      await merchantApi.setWebhook(url);
      localStorage.setItem(LAST_SAVED_KEY, url);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (err) {
      setSaveError(err.response?.data?.message || 'Could not save the webhook URL.');
    } finally {
      setSaving(false);
    }
  };

  // No real webhook-delivery-test endpoint exists in the backend — this
  // stays a clearly-labeled preview action (see the "Preview" badge below)
  // rather than a real test dispatch.
  const test = () => {
    setTesting(true);
    setTimeout(() => {
      setTesting(false);
      setLogs((l) => [
        { id: `WHK-${3301}`, event: 'test.ping', status: 200, ok: true, at: '2026-07-01 (just now)', durationMs: 120 },
        ...l,
      ]);
    }, 1000);
  };

  return (
    <div>
      <PageHeader title="Webhooks" subtitle="Receive real-time payment events" />

      <div className="space-y-6">
        <Card className="p-5">
          <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: 0 }}>Endpoint</h2>
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0 14px' }}>We POST event payloads to this URL</p>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourdomain.com/webhooks/p2p" className="min-w-[240px] flex-1" />
            <Button onClick={save} disabled={saving}>{saved ? <><IconCheck className="h-4 w-4" /> Saved</> : saving ? 'Saving…' : 'Save'}</Button>
            <Button variant="ghost" onClick={test} disabled={testing}>
              <IconRefresh className={`h-4 w-4 ${testing ? 'animate-spin' : ''}`} />
              {testing ? 'Testing…' : 'Test webhook'}
            </Button>
          </div>
          {saveError && <p className="mt-2 text-xs" style={{ color: '#ef4444' }}>{saveError}</p>}
          <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>
            Events: <span style={{ color: 'var(--text)' }}>order.created, order.confirmed, order.expired, payment.received, payout.settled</span>
          </p>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--cardborder)' }}>
            <div>
              <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: 0 }}>Recent deliveries</h2>
              <p style={{ color: 'var(--muted)', fontSize: 11, margin: '3px 0 0' }}>Preview — test webhook only, not real deliveries</p>
            </div>
            <Badge color="gray">Preview</Badge>
          </div>
          {logs.length === 0 ? (
            <p className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>No data yet</p>
          ) : (
            <div>
              {logs.map((l) => (
                <div key={l.id + l.at} className="flex items-center gap-3" style={{ padding: '10px 16px', borderTop: '1px solid var(--cardborder)' }}>
                  <Badge color={l.ok ? 'green' : 'red'}>{l.status}</Badge>
                  <span className="flex-1 truncate font-mono text-xs" style={{ color: 'var(--muted)' }}>{l.event}</span>
                  <span className="text-xs" style={{ color: 'var(--subtle, var(--muted))' }}>{l.durationMs}ms</span>
                  <span className="text-xs" style={{ color: 'var(--subtle, var(--muted))' }}>{l.at}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
