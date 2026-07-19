import { useState } from 'react';
import { Card, Badge, Button, Input, Section, PageHeader } from '../components/ui';
import { IconCheck, IconRefresh } from '../components/icons';
import { webhookLogs as seedLogs, profile } from '../utils/mock';

export default function Webhooks() {
  const [url, setUrl] = useState(profile.webhookUrl);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [logs, setLogs] = useState(seedLogs);

  const save = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

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
        <Section title="Endpoint" description="We POST event payloads to this URL">
          <div className="flex flex-wrap items-center gap-2">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourdomain.com/webhooks/p2p" className="min-w-[240px] flex-1" />
            <Button onClick={save}>{saved ? <><IconCheck className="h-4 w-4" /> Saved</> : 'Save'}</Button>
            <Button variant="ghost" onClick={test} disabled={testing}>
              <IconRefresh className={`h-4 w-4 ${testing ? 'animate-spin' : ''}`} />
              {testing ? 'Testing…' : 'Test webhook'}
            </Button>
          </div>
          <p className="mt-3 text-xs text-gray-500">
            Events: <span className="text-gray-400">order.created, order.confirmed, order.expired, payment.received, payout.settled</span>
          </p>
        </Section>

        <Card>
          <div className="border-b border-gray-800 p-4">
            <h2 className="font-semibold text-white">Delivery Logs</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3 font-medium">Delivery ID</th>
                  <th className="px-4 py-3 font-medium">Event</th>
                  <th className="px-4 py-3 font-medium">Response</th>
                  <th className="px-4 py-3 font-medium">Duration</th>
                  <th className="px-4 py-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {logs.map((l) => (
                  <tr key={l.id + l.at} className="text-gray-200 hover:bg-gray-800/40">
                    <td className="px-4 py-3 font-mono text-xs text-gray-400">{l.id}</td>
                    <td className="px-4 py-3"><Badge color="indigo">{l.event}</Badge></td>
                    <td className="px-4 py-3"><Badge color={l.ok ? 'green' : 'red'}>{l.status}</Badge></td>
                    <td className="px-4 py-3 text-gray-400">{l.durationMs} ms</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{l.at}</td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr><td colSpan={5} className="py-10 text-center text-sm text-gray-500">No data yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
