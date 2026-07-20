import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { Card, Badge, Button, SearchInput, Select, PageHeader } from '../components/ui';
import { IconPlus, IconChevron, IconDots } from '../components/icons';
// NOTE: There is no backend endpoint for a trader's smartphones, so this page
// stays on mock data. Do not wire it to the API until an endpoint exists.
import { smartphones } from '../utils/mock';
import { generateLicense, NGO_SOCKET_ORIGIN } from '../lib/ngoApi';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
];

const NGO_ID = '6a4be25836583c99fa079802';

// Reuses the exact popup look already established for this pairing flow
// (dark card, emerald accent, big letter-spaced code) — no new visual style.
const popupStyles = {
  modal: {
    position: 'fixed',
    top: 0, left: 0,
    width: '100%', height: '100%',
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  modalBox: {
    background: '#111827',
    border: '1px solid #1f2937',
    borderRadius: '16px',
    padding: '32px',
    width: '360px',
    textAlign: 'center',
  },
  modalTitle: {
    color: '#e6edf3',
    fontSize: '18px',
    fontWeight: '600',
    marginBottom: '8px',
  },
  modalSub: {
    color: '#6b7280',
    fontSize: '13px',
    marginBottom: '20px',
  },
  appName: {
    color: '#00d4aa',
    fontSize: '13px',
    fontWeight: '600',
    marginBottom: '16px',
  },
  codeBox: {
    background: '#1a2332',
    border: '2px solid #00d4aa',
    borderRadius: '12px',
    padding: '20px',
    marginBottom: '20px',
  },
  codeText: {
    color: '#00d4aa',
    fontSize: '36px',
    fontWeight: '700',
    letterSpacing: '8px',
    margin: 0,
  },
  primaryBtn: {
    background: '#00d4aa',
    color: '#000',
    border: 'none',
    borderRadius: '8px',
    padding: '10px 16px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    width: '100%',
    marginBottom: '10px',
  },
  copyBtn: {
    background: '#1f2937',
    color: '#e6edf3',
    border: 'none',
    borderRadius: '8px',
    padding: '8px 16px',
    fontSize: '13px',
    cursor: 'pointer',
    marginBottom: '16px',
    width: '100%',
  },
  closeBtn: {
    background: 'transparent',
    color: '#6b7280',
    border: '1px solid #374151',
    borderRadius: '8px',
    padding: '8px 16px',
    fontSize: '13px',
    cursor: 'pointer',
    width: '100%',
  },
};

export default function Smartphones() {
  const [filters, setFilters] = useState({ status: 'all', name: '', connection: '' });
  const [menuOpen, setMenuOpen] = useState(false);

  // PaymentBot pairing popup: null (closed) -> 'install' -> 'code'.
  const [pairStep, setPairStep] = useState(null);
  const [licenseKey, setLicenseKey] = useState('');
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const startPairing = () => {
    setMenuOpen(false);
    setPairStep('install');
  };

  const closePairing = () => {
    setPairStep(null);
    setLicenseKey('');
  };

  const handleAppInstalled = async () => {
    setGenerating(true);
    try {
      const data = await generateLicense();
      if (data.success) {
        setLicenseKey(data.licenseKey);
        setPairStep('code');
      }
    } catch (e) {
      console.error('generate-license failed:', e);
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(licenseKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Only connect while the code screen is up — not on every page visit.
  useEffect(() => {
    if (pairStep !== 'code') return undefined;

    const socket = io(NGO_SOCKET_ORIGIN);
    socket.emit('join', NGO_ID);
    socket.on('device-registered', (data) => {
      closePairing();
      alert(data.deviceName + ' connected!');
    });

    return () => socket.disconnect();
  }, [pairStep]);

  const set = (k) => (v) => setFilters((f) => ({ ...f, [k]: v }));

  const filtered = useMemo(() => {
    return smartphones.filter((s) => {
      if (filters.status !== 'all' && (filters.status === 'online') !== s.online) return false;
      if (filters.name && !s.name.toLowerCase().includes(filters.name.toLowerCase())) return false;
      if (filters.connection && !s.connectionType.toLowerCase().includes(filters.connection.toLowerCase())) return false;
      return true;
    });
  }, [filters]);

  return (
    <div>
      <PageHeader
        title="Smartphones"
        subtitle="Devices connected to your account"
        actions={
          <div className="relative">
            <Button onClick={() => setMenuOpen((v) => !v)}>
              <IconPlus className="h-4 w-4" />
              Add Smartphone
              <IconChevron className="h-4 w-4" />
            </Button>
            {menuOpen && (
              <div className="absolute right-0 z-10 mt-1 w-48 rounded-lg border border-gray-800 bg-gray-900 py-1 shadow-xl">
                {['PaymentBot'].map((o) => (
                  <button
                    key={o}
                    onClick={startPairing}
                    className="block w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-800"
                  >
                    {o}
                  </button>
                ))}
              </div>
            )}
          </div>
        }
      />

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select value={filters.status} onChange={set('status')} options={STATUS_OPTIONS} />
          <SearchInput value={filters.name} onChange={set('name')} placeholder="Name" />
          <SearchInput value={filters.connection} onChange={set('connection')} placeholder="Connection type" />
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 font-medium">Smartphone Name</th>
                <th className="px-4 py-3 font-medium">Connection Type</th>
                <th className="px-4 py-3 font-medium">Details</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filtered.map((s) => (
                <tr key={s.id} className="text-gray-200 hover:bg-gray-800/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${s.online ? 'bg-emerald-500' : 'bg-gray-500'}`} />
                      <span className="font-medium">{s.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge color="green">{s.connectionType}</Badge>
                  </td>
                  <td className="px-4 py-3">{s.details}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{s.createdAt}</td>
                  <td className="px-4 py-3 text-right">
                    <button className="text-gray-500 hover:text-gray-200">
                      <IconDots className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-sm text-gray-500">
                    No smartphones match your filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {pairStep === 'install' && (
        <div style={popupStyles.modal}>
          <div style={popupStyles.modalBox}>
            <p style={popupStyles.modalTitle}>Install PaymentBot</p>
            <p style={popupStyles.modalSub}>
              Download it to the phone that has banking apps installed.
              It will read notifications and automatically verify payments.
            </p>
            <p style={popupStyles.appName}>PaymentBot</p>
            <a
              href="#"
              style={{ ...popupStyles.primaryBtn, display: 'block', textDecoration: 'none' }}
            >
              Download Android APK
            </a>
            <button
              style={popupStyles.copyBtn}
              onClick={handleAppInstalled}
              disabled={generating}
            >
              {generating ? 'Generating code…' : 'The app is installed'}
            </button>
            <button style={popupStyles.closeBtn} onClick={closePairing}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {pairStep === 'code' && (
        <div style={popupStyles.modal}>
          <div style={popupStyles.modalBox}>
            <p style={popupStyles.modalTitle}>Enter the code in the app</p>
            <p style={popupStyles.modalSub}>Then follow setup instructions</p>
            <p style={popupStyles.appName}>PaymentBot</p>
            <div style={popupStyles.codeBox}>
              <p style={popupStyles.codeText}>{licenseKey}</p>
            </div>
            <button style={popupStyles.copyBtn} onClick={handleCopyCode}>
              {copied ? 'Copied!' : 'Copy code'}
            </button>
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-gray-700 border-t-emerald-500" />
            <p style={{ ...popupStyles.modalSub, marginBottom: '16px' }}>
              After completing setup in the app you will be able to verify
              payments automatically.
            </p>
            <button style={popupStyles.closeBtn} onClick={closePairing}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
