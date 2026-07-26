import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { Card, Badge, Button, SearchInput, Select, PageHeader, Modal, EmptyState, LoadingState } from '../components/ui';
import { IconPlus, IconChevron, IconDots, IconEdit, IconTrash } from '../components/icons';
import { getDevices, generateLicense, renameDevice, deleteDevice, NGO_SOCKET_ORIGIN } from '../lib/ngoApi';
import { traderApi } from '../services/api';

// PENDING devices (a pairing code nobody claimed) are never returned by
// getDevices() any more — see ngo-backend/src/routes/apk.js — so "Pending"
// is no longer a meaningful filter here.
const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

// Devices are considered online only while a heartbeat/event has landed
// within this window — matches the ~4s HeartbeatService interval with slack.
const ONLINE_POLL_MS = 15 * 1000;

export default function Smartphones() {
  const [filters, setFilters] = useState({ status: 'all', name: '' });
  const [menuOpen, setMenuOpen] = useState(false);

  // PaymentBot pairing popup: null (closed) -> 'install' -> 'code'.
  const [pairStep, setPairStep] = useState(null);
  const [licenseKey, setLicenseKey] = useState('');
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  // Pairing code expiry, driven by the server-issued licenseExpiresAt so the
  // countdown can't drift from what /register-device actually enforces.
  const [codeExpiresAt, setCodeExpiresAt] = useState(null);
  const [remainingSec, setRemainingSec] = useState(0);

  const [devices, setDevices] = useState([]);
  const [loadingDevices, setLoadingDevices] = useState(true);

  // Linked payment details (trader-native MySQL side), grouped by the real
  // ngo-backend device id they're paired to (Fix 5) — same ngo_device_id
  // field the "Add Payment Detail" device picker now writes.
  const [detailsByDevice, setDetailsByDevice] = useState({});

  async function loadDevices() {
    try {
      setLoadingDevices(true);
      const list = await getDevices();
      setDevices(list || []);
    } catch (e) {
      console.error('Failed to load devices:', e);
      setDevices([]);
    } finally {
      setLoadingDevices(false);
    }
  }

  async function loadLinkedDetails() {
    try {
      const res = await traderApi.paymentDetails();
      const details = res?.data?.data?.payment_details || [];
      const grouped = {};
      for (const d of details) {
        if (!d.ngo_device_id) continue;
        (grouped[d.ngo_device_id] = grouped[d.ngo_device_id] || []).push(d);
      }
      setDetailsByDevice(grouped);
    } catch (e) {
      console.error('Failed to load linked payment details:', e);
      setDetailsByDevice({});
    }
  }

  useEffect(() => {
    loadDevices();
    loadLinkedDetails();
  }, []);

  // Keep the online dot honest without requiring a manual refresh — Mongo's
  // `status` field never flips back on disconnect (see apk.js), so recency
  // has to be re-checked periodically, not just read once at mount.
  useEffect(() => {
    const id = setInterval(loadDevices, ONLINE_POLL_MS);
    return () => clearInterval(id);
  }, []);

  const startPairing = () => {
    setMenuOpen(false);
    setPairStep('install');
  };

  const closePairing = () => {
    setPairStep(null);
    setLicenseKey('');
    setCodeExpiresAt(null);
    setRemainingSec(0);
  };

  const handleAppInstalled = async () => {
    setGenerating(true);
    try {
      const data = await generateLicense();
      if (data.success) {
        setLicenseKey(data.licenseKey);
        setCodeExpiresAt(data.licenseExpiresAt ? new Date(data.licenseExpiresAt).getTime() : null);
        setPairStep('code');
      }
    } catch (e) {
      console.error('generate-license failed:', e);
    } finally {
      setGenerating(false);
    }
  };

  // Live countdown, ticking from the server-issued expiry.
  useEffect(() => {
    if (pairStep !== 'code' || !codeExpiresAt) return undefined;
    const tick = () => setRemainingSec(Math.max(0, Math.round((codeExpiresAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [pairStep, codeExpiresAt]);

  const codeExpired = pairStep === 'code' && codeExpiresAt != null && remainingSec <= 0;
  const fmtCountdown = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(licenseKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Only connect while the code screen is up — not on every page visit.
  // Joins the trader's REAL ngoId room (the same value every other NGO API
  // call resolves via getNGOAuth(), cached at localStorage.ngo_id by the
  // time this runs since generateLicense() already awaited it) — previously
  // a hardcoded, unrelated id, so this event never arrived and the modal
  // never auto-closed.
  useEffect(() => {
    if (pairStep !== 'code') return undefined;
    const ngoId = localStorage.getItem('ngo_id');
    if (!ngoId) return undefined;

    const socket = io(NGO_SOCKET_ORIGIN);
    socket.emit('join', ngoId);
    socket.on('device-registered', (data) => {
      closePairing();
      alert(data.deviceName + ' connected!');
      loadDevices();
    });

    return () => socket.disconnect();
  }, [pairStep]);

  const set = (k) => (v) => setFilters((f) => ({ ...f, [k]: v }));

  // Per-row 3-dot menu: Rename (inline edit, PATCH) and Delete (confirm, real
  // DELETE) — Fix 4. Only one row's menu / rename box open at a time.
  const [rowMenuId, setRowMenuId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [expandedDeviceId, setExpandedDeviceId] = useState(null);

  const startRename = (s) => {
    setRowMenuId(null);
    setRenamingId(s.id);
    setRenameValue(s.deviceName || '');
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue('');
  };

  const saveRename = async (s) => {
    const name = renameValue.trim();
    if (!name) return;
    setRenaming(true);
    try {
      await renameDevice(s.id, name);
      setDevices((list) => list.map((d) => (d.id === s.id ? { ...d, deviceName: name } : d)));
      cancelRename();
    } catch (e) {
      console.error('Rename failed:', e);
      alert('Rename failed: ' + e.message);
    } finally {
      setRenaming(false);
    }
  };

  const removeDevice = async (s) => {
    setRowMenuId(null);
    const label = s.deviceName || 'this device';
    if (!window.confirm(`Delete ${label}? This permanently removes it and cannot be undone.`)) return;
    try {
      await deleteDevice(s.id);
      setDevices((list) => list.filter((d) => d.id !== s.id));
    } catch (e) {
      console.error('Delete failed:', e);
      alert('Delete failed: ' + e.message);
    }
  };

  const filtered = useMemo(() => {
    return devices.filter((s) => {
      if (filters.status !== 'all' && s.status !== filters.status) return false;
      if (filters.name) {
        const q = filters.name.toLowerCase();
        if (!(s.deviceName || '').toLowerCase().includes(q) && !(s.deviceModel || '').toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [devices, filters]);

  return (
    <div>
      <PageHeader
        title="Smartphones"
        subtitle="Devices connected to your account"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={loadDevices} disabled={loadingDevices}>
              {loadingDevices ? 'Refreshing…' : 'Refresh'}
            </Button>
            <div className="relative">
              <Button onClick={() => setMenuOpen((v) => !v)}>
                <IconPlus className="h-4 w-4" />
                Add Smartphone
                <IconChevron className="h-4 w-4" />
              </Button>
              {menuOpen && (
                <div
                  className="absolute right-0 z-10 mt-1 w-48 rounded-lg py-1"
                  style={{ border: '1px solid var(--cardborder)', background: 'var(--card)', boxShadow: 'var(--shadow)' }}
                >
                  {['PaymentBot'].map((o) => (
                    <button
                      key={o}
                      onClick={startPairing}
                      className="tf-row-hover block w-full px-4 py-2 text-left text-sm"
                      style={{ color: 'var(--text)' }}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        }
      />

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select value={filters.status} onChange={set('status')} options={STATUS_OPTIONS} />
          <SearchInput value={filters.name} onChange={set('name')} placeholder="Search by name or model" />
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {loadingDevices ? <LoadingState label="Loading devices…" /> : <EmptyState title="No smartphones match your filters" />}
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s) => {
            const linked = detailsByDevice[s.id] || [];
            const expanded = expandedDeviceId === s.id;
            return (
              <Card key={s.id} data-device-id={s.id} className="p-4" style={{ position: 'relative' }}>
                <div className="flex items-center justify-between">
                  <span
                    className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold"
                    style={{
                      background: s.online ? 'rgba(34,197,94,.14)' : 'var(--hover)',
                      color: s.online ? '#22c55e' : 'var(--muted)',
                    }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.online ? '#22c55e' : 'var(--muted)' }} />
                    {s.online ? 'Online' : 'Offline'}
                  </span>
                  <div className="relative">
                    <button
                      onClick={() => setRowMenuId(rowMenuId === s.id ? null : s.id)}
                      className="tf-hbtn"
                      style={{ width: 30, height: 30 }}
                      aria-label="Device actions"
                    >
                      <IconDots className="h-4 w-4" />
                    </button>
                    {rowMenuId === s.id && (
                      <div
                        className="absolute right-0 z-10 mt-1 w-36 rounded-lg py-1"
                        style={{ border: '1px solid var(--cardborder)', background: 'var(--card)', boxShadow: 'var(--shadow)' }}
                      >
                        <button
                          onClick={() => startRename(s)}
                          className="tf-row-hover flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
                          style={{ color: 'var(--text)' }}
                        >
                          <IconEdit className="h-3.5 w-3.5" /> Rename
                        </button>
                        <button
                          onClick={() => removeDevice(s)}
                          className="tf-row-hover flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
                          style={{ color: '#ef4444' }}
                        >
                          <IconTrash className="h-3.5 w-3.5" /> Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3">
                  {renamingId === s.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveRename(s);
                          if (e.key === 'Escape') cancelRename();
                        }}
                        disabled={renaming}
                        className="rounded px-2 py-0.5 text-sm outline-none"
                        style={{ border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text)' }}
                      />
                      <button
                        onClick={() => saveRename(s)}
                        disabled={renaming || !renameValue.trim()}
                        className="text-xs font-medium disabled:opacity-50"
                        style={{ color: '#22c55e' }}
                      >
                        Save
                      </button>
                      <button onClick={cancelRename} disabled={renaming} className="text-xs" style={{ color: 'var(--muted)' }}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <h3 style={{ color: 'var(--text)', fontWeight: 700, fontSize: 15, margin: 0 }}>{s.deviceName || 'Unnamed device'}</h3>
                  )}
                  <p style={{ color: 'var(--muted)', fontSize: 12, margin: '3px 0 0' }}>{s.deviceModel || '—'}</p>
                </div>

                <div className="mt-3">
                  <Badge color="gray">{s.licenseKey || '—'}</Badge>
                </div>

                <div className="mt-3 grid grid-cols-2 overflow-hidden" style={{ borderRadius: 10, border: '1px solid var(--cardborder)' }}>
                  <div className="p-2.5" style={{ borderRight: '1px solid var(--cardborder)' }}>
                    <p style={{ color: 'var(--muted)', fontSize: 10, margin: 0 }}>Last seen</p>
                    <p style={{ color: 'var(--text)', fontSize: 12, fontWeight: 600, margin: '3px 0 0' }}>
                      {s.lastSeen ? new Date(s.lastSeen).toLocaleString() : 'Never'}
                    </p>
                  </div>
                  <div className="relative p-2.5">
                    <p style={{ color: 'var(--muted)', fontSize: 10, margin: 0 }}>Linked details</p>
                    {linked.length === 0 ? (
                      <p style={{ color: 'var(--text)', fontSize: 12, fontWeight: 600, margin: '3px 0 0' }}>—</p>
                    ) : (
                      <button
                        onClick={() => setExpandedDeviceId(expanded ? null : s.id)}
                        style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 700, margin: '3px 0 0', background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
                      >
                        {linked.length} account{linked.length === 1 ? '' : 's'}
                      </button>
                    )}
                    {expanded && (
                      <div
                        className="absolute left-0 z-10 mt-1 w-56 rounded-lg p-2"
                        style={{ border: '1px solid var(--cardborder)', background: 'var(--card)', boxShadow: 'var(--shadow)' }}
                      >
                        {linked.map((d) => (
                          <div key={d.id} className="truncate px-1 py-0.5 text-xs" style={{ color: 'var(--text)' }}>
                            {d.account_name || 'Untitled'} — <span style={{ color: 'var(--muted)' }}>{d.upi_id}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={pairStep === 'install'} onClose={closePairing} title="Install PaymentBot" width={360}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 16px' }}>
            Download it to the phone that has banking apps installed.
            It will read notifications and automatically verify payments.
          </p>
          <p style={{ color: 'var(--accent)', fontSize: 13, fontWeight: 600, margin: '0 0 16px' }}>PaymentBot</p>
          <a
            href="#"
            className="mb-2.5 block w-full rounded-lg py-2.5 text-sm font-semibold"
            style={{ background: 'var(--accent)', color: '#fff', textDecoration: 'none' }}
          >
            Download Android APK
          </a>
          <Button variant="ghost" className="mb-4 w-full" onClick={handleAppInstalled} disabled={generating}>
            {generating ? 'Generating code…' : 'The app is installed'}
          </Button>
          <Button variant="ghost" className="w-full" onClick={closePairing}>
            Cancel
          </Button>
        </div>
      </Modal>

      <Modal open={pairStep === 'code'} onClose={closePairing} title="Enter the code in the app" subtitle="Then follow setup instructions" width={360}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--accent)', fontSize: 13, fontWeight: 600, margin: '0 0 16px' }}>PaymentBot</p>
          <div
            className="mb-5 rounded-xl p-5"
            style={{ border: '2px solid var(--accent)', background: 'var(--hover)', opacity: codeExpired ? 0.4 : 1 }}
          >
            <p className="font-mono" style={{ color: 'var(--accent)', fontSize: 32, fontWeight: 700, letterSpacing: 8, margin: 0 }}>{licenseKey}</p>
          </div>
          <p
            style={{
              fontSize: 13,
              margin: '0 0 16px',
              color: codeExpired ? '#ef4444' : remainingSec <= 60 ? '#f59e0b' : 'var(--muted)',
              fontWeight: 600,
            }}
          >
            {codeExpired ? 'Code expired' : `Expires in ${fmtCountdown(remainingSec)}`}
          </p>
          {codeExpired ? (
            <Button className="w-full" onClick={handleAppInstalled} disabled={generating}>
              {generating ? 'Generating…' : 'Generate new code'}
            </Button>
          ) : (
            <>
              <Button variant="ghost" className="mb-4 w-full" onClick={handleCopyCode}>
                {copied ? 'Copied!' : 'Copy code'}
              </Button>
              <div
                className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full"
                style={{ border: '2px solid var(--cardborder)', borderTopColor: 'var(--accent)' }}
              />
              <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 16px' }}>
                After completing setup in the app you will be able to verify
                payments automatically.
              </p>
            </>
          )}
          <Button variant="ghost" className="w-full" onClick={closePairing}>
            Cancel
          </Button>
        </div>
      </Modal>
    </div>
  );
}
