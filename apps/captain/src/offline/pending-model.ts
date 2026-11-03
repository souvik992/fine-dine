// How waiting changes show on the phone (pure): tables seated offline, per-table counters, what a Fire sends.
import type { OrderView, OutboxEntry } from '@dinepos/client';
import type { FloorSnapshot, FloorTable } from '@dinepos/shared';

/** Tables seated on this phone but not on the server yet show as seated, with their order. */
export function floorWithPending(floor: FloorSnapshot, entries: readonly OutboxEntry[]): FloorSnapshot {
  const seated = new Map(entries.filter((e) => e.type === 'OpenTable').map((e) => [e.table.id, e]));
  if (seated.size === 0) return floor;
  return {
    ...floor,
    tables: floor.tables.map((t): FloorTable => {
      const e = seated.get(t.id);
      if (!e || t.orderId) return t;
      const captainId = e.payload.captainId as string | null | undefined;
      return { ...t, state: 'SEATED', orderId: e.orderId, covers: e.payload.covers as number, elapsedMin: 0, ...(captainId ? { captainId, captainName: e.by.name } : {}) };
    }),
  };
}

export interface TableWaiting {
  waiting: number;
  attention: number;
}

/** Changes still on this phone, per table. */
export function waitingByTable(entries: readonly OutboxEntry[]): Map<string, TableWaiting> {
  const out = new Map<string, TableWaiting>();
  for (const e of entries) {
    const w = out.get(e.table.id) ?? { waiting: 0, attention: 0 };
    w.waiting++;
    if (e.status === 'attention') w.attention++;
    out.set(e.table.id, w);
  }
  return out;
}

/**
 * A Fire from the phone names the dishes the captain saw waiting (docs/05 "FireKOT (new items)"), so dishes added
 * meanwhile at a terminal are not sent with it.
 */
export function fireItemIds(view: Pick<OrderView, 'items'>, choice: { all: true } | { course: number }): string[] {
  return view.items.filter((i) => i.status === 'held' && ('all' in choice || i.course === choice.course)).map((i) => i.id);
}

/** Free tables to seat a refused offline order at instead (not seated on this phone either). */
export function freeTables(floor: FloorSnapshot | undefined, entries: readonly OutboxEntry[]): FloorTable[] {
  if (!floor) return [];
  const mine = new Set(entries.filter((e) => e.type === 'OpenTable').map((e) => e.table.id));
  return floor.tables.filter((t) => t.state === 'FREE' && !t.orderId && !mine.has(t.id));
}

export function timeText(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}
