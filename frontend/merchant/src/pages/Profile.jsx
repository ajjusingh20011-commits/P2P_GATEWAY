import { useState } from 'react';
import { Button, Input, Section, PageHeader, Modal } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { profile as seed } from '../utils/mock';

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
    setTimeout(() => setSaved(false), 1800);
  };

  const changePassword = () => {
    if (!pwd.current || !pwd.next) return setPwdMsg('Please fill all fields.');
    if (pwd.next !== pwd.confirm) return setPwdMsg('New passwords do not match.');
    setPwdMsg('');
    setShowPwd(false);
    setPwd({ current: '', next: '', confirm: '' });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div>
      <PageHeader
        title="Profile"
        subtitle="Business account details"
        actions={<Button onClick={save}>{saved ? '✓ Saved' : 'Save changes'}</Button>}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title="Business Information" description="Shown on customer checkout pages">
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm text-gray-400">Business name</label>
              <Input value={form.businessName} onChange={set('businessName')} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-gray-400">Email</label>
              <Input type="email" value={form.email} onChange={set('email')} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-gray-400">Phone</label>
              <Input value={form.phone} onChange={set('phone')} />
            </div>
          </div>
        </Section>

        <Section title="Security" description="Password and access">
          <div className="space-y-4">
            <div className="rounded-lg border border-gray-800 bg-gray-950 px-4 py-3">
              <p className="text-sm font-medium text-gray-100">Password</p>
              <p className="text-xs text-gray-500">Last changed 42 days ago</p>
            </div>
            <Button variant="ghost" onClick={() => setShowPwd(true)}>Change password</Button>
          </div>
        </Section>
      </div>

      <Modal
        open={showPwd}
        onClose={() => setShowPwd(false)}
        size="md"
        title="Change Password"
        footer={<><Button variant="ghost" onClick={() => setShowPwd(false)}>Cancel</Button><Button onClick={changePassword}>Update password</Button></>}
      >
        <div className="space-y-4">
          {pwdMsg && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{pwdMsg}</p>}
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">Current password</label>
            <Input type="password" value={pwd.current} onChange={(e) => setPwd((p) => ({ ...p, current: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">New password</label>
            <Input type="password" value={pwd.next} onChange={(e) => setPwd((p) => ({ ...p, next: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-gray-400">Confirm new password</label>
            <Input type="password" value={pwd.confirm} onChange={(e) => setPwd((p) => ({ ...p, confirm: e.target.value }))} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
