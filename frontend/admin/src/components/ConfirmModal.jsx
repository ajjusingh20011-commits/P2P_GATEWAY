import { useEffect, useState } from 'react';
import { Modal, Button } from './ui';

/**
 * Shared confirmation dialog for financially/operationally consequential
 * admin actions (reject, dispute, suspend, force-disconnect, approve...).
 * Real project's row/modal actions previously fired on a single click with
 * no confirmation step at all — this ports the design's ConfirmModal
 * pattern as a genuine safety improvement, not just a visual addition.
 *
 * requireAck / ackLabel (optional, default off — every existing call site is
 * unaffected): when set, the confirm button stays disabled until the admin
 * has explicitly checked a distinct acknowledgement checkbox, in addition to
 * the click itself. Added for approving a payout whose evidence was never
 * verified (payoutService's evidence_unverified gate) — the description text
 * alone was previously the ONLY difference from a normal approval, so an
 * admin could click straight through an unverified payout exactly like any
 * other one. This makes the distinction something they have to actively do,
 * not just something they could have read.
 */
export default function ConfirmModal({
  open, title, description, confirmLabel = 'Confirm', tone = 'primary', onConfirm, onClose, busy = false,
  requireAck = false, ackLabel = '',
}) {
  const [acked, setAcked] = useState(false);

  // Reset the checkbox each time the dialog opens for a (possibly different)
  // row — an acknowledgement must never silently carry over from a previous
  // confirmation.
  useEffect(() => {
    if (open) setAcked(false);
  }, [open]);

  if (!open) return null;
  const confirmDisabled = busy || (requireAck && !acked);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} disabled={confirmDisabled} onClick={() => onConfirm(acked)}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0 }}>{description}</p>
      {requireAck && (
        <label style={{
          display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 14,
          padding: '10px 12px', borderRadius: 8, background: 'rgba(180, 83, 9, 0.1)',
          border: '1px solid rgba(180, 83, 9, 0.35)', cursor: 'pointer', fontSize: 13.5, lineHeight: 1.4,
        }}
        >
          <input
            type="checkbox"
            checked={acked}
            onChange={(e) => setAcked(e.target.checked)}
            style={{ marginTop: 2, cursor: 'pointer' }}
          />
          <span style={{ color: '#b45309', fontWeight: 600 }}>{ackLabel}</span>
        </label>
      )}
    </Modal>
  );
}
