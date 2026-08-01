import { Modal, Button } from './ui';

/**
 * Shared confirmation dialog for financially/operationally consequential
 * admin actions (reject, dispute, suspend, force-disconnect, approve...).
 * Real project's row/modal actions previously fired on a single click with
 * no confirmation step at all — this ports the design's ConfirmModal
 * pattern as a genuine safety improvement, not just a visual addition.
 */
export default function ConfirmModal({ open, title, description, confirmLabel = 'Confirm', tone = 'primary', onConfirm, onClose, busy = false }) {
  if (!open) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0 }}>{description}</p>
    </Modal>
  );
}
