import type { OrderSnapshot } from '@dinepos/shared';
import { useState } from 'react';
import { Modal } from '../components/Modal.js';

const REASONS = ['Guests left', 'Opened by mistake', 'Wrong table'];

/** Release table: frees a table with nothing to bill (nothing sent to the kitchen, no bill). The order ends void. */
export function ReleaseTableDialog({ order, onClose, run, onDone }: { order: OrderSnapshot; onClose: () => void; run: (type: string, payload: unknown, done?: string) => Promise<boolean>; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const held = order.items.filter((i) => i.status === 'held').length;
  const label = order.table?.label ?? 'this table';

  const release = async () => {
    setBusy(true);
    const ok = await run('ReleaseTable', reason.trim() ? { reason: reason.trim() } : {}, `${label} is free.`);
    setBusy(false);
    if (ok) onDone();
  };

  return (
    <Modal title={`Release ${label}?`} onClose={onClose}>
      <p className="text-sm">
        Nothing was sent to the kitchen, so there is nothing to bill. The table becomes free.
        {held > 0 ? ` The ${held} item${held === 1 ? '' : 's'} not sent will be dropped.` : ''}
      </p>
      <p className="mt-3 text-sm font-semibold">Reason (optional)</p>
      <div className="mt-1 flex flex-wrap gap-2">
        {REASONS.map((r) => (
          <button key={r} className={`btn h-8 text-sm ${reason === r ? 'btn-primary' : ''}`} onClick={() => setReason(r)}>
            {r}
          </button>
        ))}
      </div>
      <input className="input mt-2" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Or type a reason" aria-label="Reason" />
      <p className="mt-2 text-xs text-muted-foreground">Kept in the audit log and the Voids and cancellations report.</p>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          Keep the table
        </button>
        <button data-autofocus className="btn btn-primary" disabled={busy} onClick={() => void release()}>
          Release table
        </button>
      </div>
    </Modal>
  );
}
