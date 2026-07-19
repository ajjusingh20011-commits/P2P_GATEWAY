import { useMemo, useState } from 'react';
import { Card, Badge, Button, SearchInput, Select, PageHeader, Modal, Field } from '../components/ui';
import { IconPower } from '../components/icons';
import { smartphones as seedPhones } from '../utils/mock';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
];

function PhoneModal({ phone, onClose, onDisconnect }) {
  if (!phone) return null;
  return (
    <Modal
      open={!!phone}
      onClose={onClose}
      size="lg"
      title={phone.name}
      subtitle={`Owner: ${phone.ownerName} (#${phone.ownerId})`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {phone.online && <Button variant="danger" onClick={() => { onDisconnect(phone.id); onClose(); }}><IconPower className="h-4 w-4" /> Force disconnect</Button>}
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Status"><Badge color={phone.online ? 'green' : 'gray'}>{phone.online ? 'Online' : 'Offline'}</Badge></Field>
          <Field label="Last ping">{phone.lastPing}</Field>
          <Field label="Connection">{phone.connectionType}</Field>
          <Field label="Bank accounts">{phone.bankAccounts}</Field>
          <Field label="Owner">{phone.ownerName}</Field>
          <Field label="Registered">{phone.createdAt}</Field>
        </div>

        <section>
          <h3 className="mb-2 text-sm font-semibold text-white">Activity Log</h3>
          <ul className="divide-y divide-gray-800 rounded-lg border border-gray-800">
            {phone.activity.map((a, i) => (
              <li key={i} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-gray-200">{a.event}</span>
                <span className="text-xs text-gray-500">{a.at}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Modal>
  );
}

export default function Smartphones() {
  const [list, setList] = useState(seedPhones);
  const [filters, setFilters] = useState({ status: 'all', q: '', connection: '' });
  const [selected, setSelected] = useState(null);

  const set = (k) => (v) => setFilters((f) => ({ ...f, [k]: v }));

  const disconnect = (id) => setList((l) => l.map((p) => (p.id === id ? { ...p, online: false, lastPing: 'just now' } : p)));

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return list.filter((p) => {
      if (filters.status !== 'all' && (filters.status === 'online') !== p.online) return false;
      if (q && !p.name.toLowerCase().includes(q) && !p.ownerName.toLowerCase().includes(q)) return false;
      if (filters.connection && !p.connectionType.toLowerCase().includes(filters.connection.toLowerCase())) return false;
      return true;
    });
  }, [list, filters]);

  const online = list.filter((p) => p.online).length;
  const selectedLive = selected ? list.find((p) => p.id === selected.id) : null;

  return (
    <div>
      <PageHeader title="Smartphones" subtitle={`${online} online of ${list.length} devices across all traders`} />

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select value={filters.status} onChange={set('status')} options={STATUS_OPTIONS} />
          <SearchInput value={filters.q} onChange={set('q')} placeholder="Device or owner name" />
          <SearchInput value={filters.connection} onChange={set('connection')} placeholder="Connection type" />
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 font-medium">Device</th>
                <th className="px-4 py-3 font-medium">Owner (Trader)</th>
                <th className="px-4 py-3 font-medium">Connection</th>
                <th className="px-4 py-3 font-medium">Banks</th>
                <th className="px-4 py-3 font-medium">Last Ping</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filtered.map((p) => (
                <tr key={p.id} className="cursor-pointer text-gray-200 hover:bg-gray-800/40" onClick={() => setSelected(p)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${p.online ? 'bg-emerald-500' : 'bg-gray-500'}`} />
                      <span className="font-medium">{p.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-gray-100">{p.ownerName}</div>
                    <div className="text-xs text-gray-500">#{p.ownerId}</div>
                  </td>
                  <td className="px-4 py-3"><Badge color="sky">{p.connectionType}</Badge></td>
                  <td className="px-4 py-3">{p.bankAccounts}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{p.lastPing}</td>
                  <td className="px-4 py-3"><Badge color={p.online ? 'green' : 'gray'}>{p.online ? 'online' : 'offline'}</Badge></td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" disabled={!p.online} onClick={() => disconnect(p.id)}>
                      <IconPower className="h-3.5 w-3.5" /> Disconnect
                    </Button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="py-10 text-center text-sm text-gray-500">No smartphones match your filters</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <PhoneModal phone={selectedLive} onClose={() => setSelected(null)} onDisconnect={disconnect} />
    </div>
  );
}
