import { Modal, Button } from './ui';

/**
 * Shared confirmation dialog, replacing native window.confirm() popups
 * (which render as an unstyled "<host> says…" browser dialog, not part of
 * the app at all) with the app's own modal styling. Ported from
 * frontend/admin/src/components/ConfirmModal.jsx — same component, same
 * props, this app's own Modal/Button primitives underneath.
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
