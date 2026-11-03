import type { OutboxEntry } from '@dinepos/client';
import type { FloorSnapshot } from '@dinepos/shared';
import { useState } from 'react';
import { Sheet } from '../components/Sheet.js';
import { freeTables, timeText } from '../offline/pending-model.js';
import { useSync } from '../offline/sync-context.js';

/**
 * Needs attention (docs/05): changes made offline that the server refused when they were replayed. Each says what was
 * done, by whom and why it was refused; the captain tries again, gives it up, or seats the guests at another table.
 * Later changes to the same table wait behind it.
 */
export function AttentionSheet({ floor, onClose }: { floor: FloorSnapshot | undefined; onClose: () => void }) {
  const sync = useSync();
  const problems = sync.entries.filter((e) => e.status === 'attention');
  return (
    <Sheet title="Needs attention" onClose={onClose}>
      {problems.length === 0 ? <p className="text-muted-foreground">Nothing needs attention.</p> : null}
      <ul className="space-y-3" aria-label="Refused changes">
        {problems.map((e) => (
          <Problem key={e.seq} entry={e} behind={sync.entries.filter((x) => x.orderId === e.orderId && x.seq > e.seq).length} floor={floor} />
        ))}
      </ul>
    </Sheet>
  );
}

function Problem({ entry: e, behind, floor }: { entry: OutboxEntry; behind: number; floor: FloorSnapshot | undefined }) {
  const sync = useSync();
  const [confirm, setConfirm] = useState(false);
  const [moving, setMoving] = useState(false);
  const free = freeTables(floor, sync.entries);
  const canReseat = e.type === 'OpenTable' && e.problem?.code === 'INVALID_STATE';
  return (
    <li className="rounded-xl border-2 border-danger/60 p-3" data-attention={e.table.label}>
      <p className="flex justify-between gap-2 text-sm text-muted-foreground">
        <span className="font-bold text-foreground">Table {e.table.label}</span>
        <span>
          {e.by.name} · {timeText(e.queuedAt)}
        </span>
      </p>
      <p className="mt-1 font-semibold">{e.label}</p>
      <p className="mt-1 text-sm font-semibold text-danger">{e.problem?.message}</p>
      {behind ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {behind} more change{behind === 1 ? '' : 's'} to this table wait{behind === 1 ? 's' : ''} for this one.
        </p>
      ) : null}
      {moving ? (
        <div className="mt-3">
          <p className="mb-2 text-sm font-semibold">Seat them at:</p>
          <div className="flex flex-wrap gap-2">
            {free.map((t) => (
              <button key={t.id} className="btn h-11 px-4" onClick={() => sync.reseat(e.seq, t)}>
                {t.label}
              </button>
            ))}
            {free.length === 0 ? <p className="text-sm text-muted-foreground">No free table right now.</p> : null}
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {canReseat ? (
            <button className="btn btn-primary h-11 w-full" onClick={() => setMoving(true)} disabled={!sync.online}>
              Seat at another table
            </button>
          ) : null}
          <button className="btn h-11 flex-1" onClick={() => sync.retry(e.seq)} disabled={!sync.online}>
            Try again
          </button>
          <button className={`btn h-11 flex-1 ${confirm ? 'border-danger text-danger' : ''}`} onClick={() => (confirm ? sync.discard(e.seq) : setConfirm(true))}>
            {confirm ? (e.type === 'OpenTable' && behind ? `Discard with ${behind} more` : 'Yes, discard') : 'Discard'}
          </button>
        </div>
      )}
    </li>
  );
}
