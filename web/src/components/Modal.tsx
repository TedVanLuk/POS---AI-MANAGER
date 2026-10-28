import { useState, type ReactNode } from 'react';

export function Modal({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
        <div className="actions">{actions ?? <button className="btn" onClick={onClose}>Close</button>}</div>
      </div>
    </div>
  );
}

/** Asks "why?" before any change that affects pay — the reason goes to the audit log. */
export function ReasonDialog({ title, description, confirmLabel = 'Save', onConfirm, onClose, children }: {
  title: string; description?: ReactNode; confirmLabel?: string; children?: ReactNode;
  onConfirm: (reason: string) => Promise<unknown>; onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await onConfirm(reason.trim()); onClose(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose} actions={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || reason.trim().length < 3} onClick={go}>{busy ? 'Saving…' : confirmLabel}</button>
    </>}>
      {description && <div className="muted" style={{ marginBottom: '.75rem' }}>{description}</div>}
      {children}
      <label className="field" style={{ marginTop: '.75rem' }}>Reason (required, saved in the audit log)
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Approved OT not captured — employee forgot to time out" autoFocus />
      </label>
      {error && <div className="error">{error}</div>}
    </Modal>
  );
}

/** In-page confirmation (browser confirm() is unavailable in embedded viewers). */
export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose }: {
  title: string; message: ReactNode; confirmLabel?: string; danger?: boolean;
  onConfirm: () => Promise<unknown>; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    try { await onConfirm(); onClose(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose} actions={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={busy} onClick={go}>{busy ? 'Working…' : confirmLabel}</button>
    </>}>
      <div>{message}</div>
      {error && <div className="error" style={{ marginTop: '.5rem' }}>{error}</div>}
    </Modal>
  );
}
