import type { OrderSnapshot } from '@dinepos/shared';
import { useState } from 'react';
import { Modal } from '../components/Modal.js';
import { isCounterOrder, orderTitle } from '../floor/counter-model.js';

const REASONS = ['Guests left', 'Opened by mistake', 'Wrong table'];
const COUNTER_REASONS = ['Customer cancelled', 'Opened by mistake', 'Duplicate order'];

/** Release table: frees a table with nothing to bill (nothing sent to the kitchen, no bill). The order ends void. */
export function ReleaseTableDialog({ order, onClose, run, onDone }: { order: OrderSnapshot; onClose: () => void; run: (type: string, payload: unknown, done?: string) => Promise<boolean>; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const held = order.items.filter((i) => i.status === 'held').length;
  // a takeaway / delivery order is cancelled, not released: it has no table to free
  const counter = isCounterOrder(order);
  const label = counter ? orderTitle(order) : (order.table?.label ?? 'this table');

  const release = async () => {
    setBusy(true);
    const ok = await run('ReleaseTable', reason.trim() ? { reason: reason.trim() } : {}, counter ? `${label} was cancelled.` : `${label} is free.`);
    setBusy(false);
    if (ok) onDone();
  };

  return (
    <Modal title={counter ? `Cancel ${label}?` : `Release ${label}?`} onClose={onClose}>
      <p className="text-sm">
        Nothing was sent to the kitchen, so there is nothing to bill. {counter ? 'The order is cancelled.' : 'The table becomes free.'}
        {held > 0 ? ` The ${held} item${held === 1 ? '' : 's'} not sent will be dropped.` : ''}
      </p>
      <p className="mt-3 text-sm font-semibold">Reason (optional)</p>
      <div className="mt-1 flex flex-wrap gap-2">
        {(counter ? COUNTER_REASONS : REASONS).map((r) => (
          <button key={r} className={`btn h-8 text-sm ${reason === r ? 'btn-primary' : ''}`} onClick={() => setReason(r)}>
            {r}
          </button>
        ))}
      </div>
      <input className="input mt-2" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Or type a reason" aria-label="Reason" />
      <p className="mt-2 text-xs text-muted-foreground">Kept in the audit log and the Voids and cancellations report.</p>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          {counter ? 'Keep the order' : 'Keep the table'}
        </button>
        <button data-autofocus className="btn btn-primary" disabled={busy} onClick={() => void release()}>
          {counter ? 'Cancel order' : 'Release table'}
        </button>
      </div>
    </Modal>
  );
}
