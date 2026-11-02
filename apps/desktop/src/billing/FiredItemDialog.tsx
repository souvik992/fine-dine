import type { OrderItemSnapshot } from '@dinepos/shared';
import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '../components/Modal.js';

const REASONS = ['Guest changed mind', 'Wrong item entered', 'Taking too long', 'Out of stock', 'Quality complaint'];

/**
 * Reduce or cancel a line already sent to the kitchen (P2-04). The kitchen gets a change slip; the change is
 * audited with the reason and shows on the leakage report. A manager PIN is asked for when the role needs one.
 */
export function FiredItemDialog({ item, onClose, run }: { item: OrderItemSnapshot; onClose: () => void; run: (type: string, payload: unknown, done?: string) => Promise<boolean> }) {
  const [keep, setKeep] = useState(Math.max(0, item.qty - 1));
  const [reason, setReason] = useState('');
  const [notPrepared, setNotPrepared] = useState(false);
  const [busy, setBusy] = useState(false);
  const cancelAll = keep === 0;

  const submit = async () => {
    setBusy(true);
    const ok = cancelAll
      ? await run('CancelFiredItem', { orderItemId: item.id, reason: reason.trim(), returnToStock: notPrepared }, `${item.name} cancelled. The kitchen has been told.`)
      : await run('ModifyFiredItem', { orderItemId: item.id, newQty: keep, reason: reason.trim(), returnToStock: notPrepared }, `${item.name} reduced to ${keep}. The kitchen has been told.`);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal title={`Change sent item: ${item.name}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim()) void submit();
        }}
      >
        <p className="mb-3 text-sm text-muted-foreground">
          Sent on KOT {String(item.kotNo ?? 0).padStart(4, '0')}: {item.qty} ×. The kitchen gets a change slip. To add more, add the item again and send it.
        </p>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">Keep</span>
          <button type="button" className="btn h-9 w-9 px-0" aria-label="One less" disabled={keep === 0} onClick={() => setKeep(keep - 1)}>
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-10 text-center text-lg font-bold tabular-nums" data-testid="keep-qty">
            {keep}
          </span>
          <button type="button" className="btn h-9 w-9 px-0" aria-label="One more" disabled={keep >= item.qty - 1} onClick={() => setKeep(keep + 1)}>
            <Plus className="h-4 w-4" />
          </button>
          <span className="text-sm text-muted-foreground">{cancelAll ? 'Cancel the whole line' : `Take back ${item.qty - keep}`}</span>
        </div>

        <p className="mb-1 mt-4 text-sm font-semibold">Reason</p>
        <div className="mb-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Common reasons">
          {REASONS.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={reason === r} className="tab h-8 text-xs" aria-selected={reason === r} onClick={() => setReason(r)}>
              {r}
            </button>
          ))}
        </div>
        <input data-autofocus className="input" maxLength={120} placeholder="Or type the reason" aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />

        <label className="mt-4 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={notPrepared} onChange={(e) => setNotPrepared(e.target.checked)} />
          <span>
            <span className="font-semibold">Not prepared yet</span>
            <span className="block text-xs text-muted-foreground">Puts its recipe ingredients back in stock. Leave off if the food was already made.</span>
          </span>
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Keep as is
          </button>
          <button type="submit" className={`btn ${cancelAll ? 'bg-danger text-white' : 'btn-primary'}`} disabled={busy || !reason.trim()}>
            {busy ? 'Sending…' : cancelAll ? 'Cancel item' : `Reduce to ${keep}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
