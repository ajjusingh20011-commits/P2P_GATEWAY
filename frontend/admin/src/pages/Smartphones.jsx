import { useEffect, useMemo, useState } from 'react';
import { Card, Badge, Button, SearchInput, Select, Tabs, PageHeader, Modal, Field, InlineLoader } from '../components/ui';
import AdminIdPopover from '../components/AdminIdPopover';
import ConfirmModal from '../components/ConfirmModal';
import { IconPower } from '../components/icons';
import { adminApi } from '../services/api';
import { toast } from '../components/toast';

const fmtDate = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
};

// Map a backend Smartphone record onto the shape the table/modal expect.
// Real fields only (see backend/src/models/smartphone.model.js) — no
// battery/network/permission/APK-version/IP/linked-accounts data exists on
// this model at all (that's all design-only mock), so none of it is shown
// here rather than invented.
function mapPhone(p) {
  return {
    id: p.id,
    deviceId: p.device_id,
    name: p.device_name || p.device_id,
    ownerName: p.trader?.user?.email || `Trader #${p.trader_id}`,
    ownerId: p.trader_id,
    connectionType: p.connection_type,
    lastPing: fmtDate(p.last_ping),
    online: !!p.is_online,
    createdAt: fmtDate(p.created_at),
  };
}

function PhoneModal({ phone, onClose, onRequestDisconnect }) {
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
          {phone.online && <Button variant="danger" onClick={() => onRequestDisconnect(phone)}><IconPower className="h-4 w-4" /> Force disconnect</Button>}
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Field label="Status"><Badge color={phone.online ? 'green' : 'gray'}>{phone.online ? 'Online' : 'Offline'}</Badge></Field>
        <Field label="Last ping">{phone.lastPing}</Field>
        <Field label="Connection">{phone.connectionType}</Field>
        <Field label="Owner">{phone.ownerName}</Field>
        <Field label="Registered">{phone.createdAt}</Field>
      </div>
    </Modal>
  );
}

export default function Smartphones() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [connectionFilter, setConnectionFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [disconnectTarget, setDisconnectTarget] = useState(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = () => {
    setLoading(true);
    setError('');
    adminApi
      .listSmartphones()
      .then((data) => setList((data.smartphones || []).map(mapPhone)))
      .catch(() => setError('Could not load smartphones.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  // Force-disconnect is a real, consequential action (kicks a trader's live
  // device offline) — confirmed via the shared ConfirmModal rather than
  // firing immediately from the row button.
  const confirmDisconnect = async () => {
    if (!disconnectTarget) return;
    setDisconnecting(true);
    try {
      await adminApi.disconnectSmartphone(disconnectTarget.id);
      toast(`${disconnectTarget.name} disconnected`, 'success');
      setList((l) => l.map((p) => (p.id === disconnectTarget.id ? { ...p, online: false, lastPing: 'just now' } : p)));
      setDisconnectTarget(null);
      setSelected(null);
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to disconnect device', 'error');
    } finally {
      setDisconnecting(false);
    }
  };

  const connectionOptions = useMemo(() => {
    const types = Array.from(new Set(list.map((p) => p.connectionType).filter(Boolean)));
    return [{ value: 'all', label: 'All connection types' }, ...types.map((t) => ({ value: t, label: t }))];
  }, [list]);

  const counts = useMemo(() => ({
    all: list.length,
    online: list.filter((p) => p.online).length,
    offline: list.filter((p) => !p.online).length,
  }), [list]);

  const tabs = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'online', label: 'Online', count: counts.online },
    { key: 'offline', label: 'Offline', count: counts.offline },
  ];

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return list.filter((p) => {
      if (tab !== 'all' && (tab === 'online') !== p.online) return false;
      if (connectionFilter !== 'all' && p.connectionType !== connectionFilter) return false;
      if (query && !p.name.toLowerCase().includes(query) && !p.ownerName.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [list, tab, connectionFilter, q]);

  const selectedLive = selected ? list.find((p) => p.id === selected.id) : null;

  return (
    <div>
      <PageHeader
        title="Smartphones"
        subtitle={loading ? 'Loading…' : `${counts.online} online of ${list.length} devices across all traders`}
        actions={loading ? <InlineLoader /> : null}
      />

      {error && (
        <div className="mb-4 rounded-lg border px-4 py-2.5 text-sm" style={{ borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
          {error}
        </div>
      )}

      <Card className="mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <SearchInput value={q} onChange={setQ} placeholder="Search device or owner…" className="sm:max-w-xs" />
        <Select value={connectionFilter} onChange={setConnectionFilter} options={connectionOptions} className="sm:w-56" />
      </Card>

      <Card className="mb-4 p-2">
        <Tabs tabs={tabs} active={tab} onChange={setTab} />
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--cardborder)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="w-10 px-4 py-3" />
                <th className="px-4 py-3 font-medium">Device</th>
                <th className="px-4 py-3 font-medium">Owner (Trader)</th>
                <th className="px-4 py-3 font-medium">Connection</th>
                <th className="px-4 py-3 font-medium">Last Ping</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--cardborder)]">
              {filtered.map((p) => (
                <tr key={p.id} className="cursor-pointer text-[var(--text)] hover:bg-[var(--hover)]" onClick={() => setSelected(p)}>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <AdminIdPopover rows={[{ label: 'Device ID', value: p.deviceId }, { label: 'Owner Trader ID', value: p.ownerId }]} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${p.online ? 'bg-emerald-500' : 'bg-[var(--muted)]'}`} />
                      <span className="font-medium">{p.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-[var(--text)]">{p.ownerName}</div>
                    <div className="text-xs text-[var(--muted)]">#{p.ownerId}</div>
                  </td>
                  <td className="px-4 py-3"><Badge color="sky">{p.connectionType}</Badge></td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)]">{p.lastPing}</td>
                  <td className="px-4 py-3"><Badge color={p.online ? 'green' : 'gray'}>{p.online ? 'online' : 'offline'}</Badge></td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" disabled={!p.online} onClick={() => setDisconnectTarget(p)}>
                      <IconPower className="h-3.5 w-3.5" /> Disconnect
                    </Button>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="py-10 text-center text-sm text-[var(--muted)]">No smartphones match your filters</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <PhoneModal phone={selectedLive} onClose={() => setSelected(null)} onRequestDisconnect={setDisconnectTarget} />

      <ConfirmModal
        open={!!disconnectTarget}
        title="Force disconnect this device?"
        description={disconnectTarget ? `${disconnectTarget.name} (owned by ${disconnectTarget.ownerName}) will be marked offline immediately and the trader's device will be notified to disconnect. Reversible — the device reconnects normally next time it comes online.` : ''}
        tone="danger"
        confirmLabel={disconnecting ? 'Disconnecting…' : 'Force disconnect'}
        busy={disconnecting}
        onConfirm={confirmDisconnect}
        onClose={() => setDisconnectTarget(null)}
      />
    </div>
  );
}
