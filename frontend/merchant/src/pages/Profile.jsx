import { useState } from 'react';
import { Badge, Button, Input, Section, PageHeader, Modal } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { profile as seed } from '../utils/mock';

// Neither a profile-update endpoint nor a password-change endpoint exists
// in the backend for any role (confirmed: not in merchantRoutes.js, and no
// change-password route anywhere). Both actions below used to fake success
// with a bare setTimeout — replaced with honest, clearly-labeled preview
// states instead, per the rule against faking server success for
// credential/permission changes.
export default function Profile() {
  const { user } = useAuth();
  const [form, setForm] = useState({
    businessName: user?.businessName || seed.businessName,
    email: user?.email || seed.email,
    phone: seed.phone,
  });
  const [saved, setSaved] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' });
  const [pwdMsg, setPwdMsg] = useState('');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = () => {
    setSaved(true);
  };

  const changePassword = () => {
    if (!pwd.current || !pwd.next) return setPwdMsg('Please fill all fields.');
    if (pwd.next !== pwd.confirm) return setPwdMsg('New passwords do not match.');
    setPwdMsg('preview');
  };

  return (
    <div>
      <PageHeader
        title="Profile"
        subtitle="Business account details"
        actions={<Button onClick={save}>{saved ? 'Preview saved (not persisted)' : 'Save changes'}</Button>}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section
          title="Business Information"
          description="Shown on customer checkout pages"
        >
          <div className="mb-3"><Badge color="gray">Preview — editing here isn't saved yet</Badge></div>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm" style={{ color: 'var(--muted)' }}>Business name</label>
              <Input value={form.businessName} onChange={set('businessName')} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm" style={{ color: 'var(--muted)' }}>Email</label>
              <Input type="email" value={form.email} onChange={set('email')} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm" style={{ color: 'var(--muted)' }}>Phone</label>
              <Input value={form.phone} onChange={set('phone')} />
            </div>
          </div>
        </Section>

        <Section title="Security" description="Password and access">
          <div className="space-y-4">
            <div className="rounded-lg border px-4 py-3" style={{ borderColor: 'var(--cardborder)', background: 'var(--hover)' }}>
              <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Password</p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>Last changed 42 days ago</p>
            </div>
            <Button variant="ghost" onClick={() => setShowPwd(true)}>Change password</Button>
          </div>
        </Section>
      </div>

      <Modal
        open={showPwd}
        onClose={() => { setShowPwd(false); setPwdMsg(''); setPwd({ current: '', next: '', confirm: '' }); }}
        size="md"
        title="Change Password"
        subtitle="Preview — not yet connected to a live account-security endpoint"
        footer={
          pwdMsg === 'preview' ? (
            <Button onClick={() => { setShowPwd(false); setPwdMsg(''); setPwd({ current: '', next: '', confirm: '' }); }}>Close</Button>
          ) : (
            <><Button variant="ghost" onClick={() => setShowPwd(false)}>Cancel</Button><Button onClick={changePassword}>Preview update</Button></>
          )
        }
      >
        {pwdMsg === 'preview' ? (
          <div className="rounded-lg border px-3 py-3 text-sm" style={{ borderColor: 'var(--cardborder)', background: 'var(--hover)', color: 'var(--text)' }}>
            <strong>Preview only.</strong> Password changes aren't connected to a live endpoint yet — nothing was updated.
          </div>
        ) : (
          <div className="space-y-4">
            {pwdMsg && <p className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{pwdMsg}</p>}
            <div>
              <label className="mb-1.5 block text-sm" style={{ color: 'var(--muted)' }}>Current password</label>
              <Input type="password" value={pwd.current} onChange={(e) => setPwd((p) => ({ ...p, current: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm" style={{ color: 'var(--muted)' }}>New password</label>
              <Input type="password" value={pwd.next} onChange={(e) => setPwd((p) => ({ ...p, next: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm" style={{ color: 'var(--muted)' }}>Confirm new password</label>
              <Input type="password" value={pwd.confirm} onChange={(e) => setPwd((p) => ({ ...p, confirm: e.target.value }))} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
