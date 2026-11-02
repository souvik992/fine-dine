import { formatINR, type FloorTable } from '@dinepos/shared';
import { Modal } from '../components/Modal.js';
import { elapsedMinutes, formatElapsed, STATE_META } from './floor-model.js';

/** Summary of an occupied table. The full order/billing screen arrives in P1-09. */
export function TablePanel({ table, now, onClose }: { table: FloorTable; now: Date; onClose: () => void }) {
  const rows: Array<[string, string]> = [
    ['State', STATE_META[table.state].label],
    ['Covers', String(table.covers ?? 0)],
    ['Seated for', formatElapsed(elapsedMinutes(table.since, now)) || '—'],
    ['Running total', formatINR(table.amountPaise ?? 0)],
  ];
  return (
    <Modal title={`Table ${table.label}`} onClose={onClose}>
      <dl className="grid grid-cols-2 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 rounded-lg bg-secondary p-3 text-sm text-muted-foreground">
        Ordering and billing on this terminal arrive with the billing screen (roadmap P1-09).
      </p>
      <div className="mt-4 flex justify-end">
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
