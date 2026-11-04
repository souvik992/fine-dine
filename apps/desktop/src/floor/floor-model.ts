// Pure floor-screen logic (no React): grouping, search, keyboard movement, state presentation.
import type { FloorSnapshot, FloorTable, TableState } from '@dinepos/shared';

export interface StateMeta {
  label: string;
  /** lucide icon name, mapped in TableTile. Colour is never the only signal (docs/09). */
  icon: 'circle' | 'users' | 'flame' | 'bell' | 'check' | 'receipt' | 'calendar' | 'ban';
  className: string;
}

export const STATE_META: Record<TableState, StateMeta> = {
  FREE: { label: 'Free', icon: 'circle', className: 'tile-free' },
  SEATED: { label: 'Seated', icon: 'users', className: 'tile-seated' },
  KOT_RUNNING: { label: 'KOT running', icon: 'flame', className: 'tile-kot' },
  FOOD_READY: { label: 'Food ready', icon: 'bell', className: 'tile-ready' },
  SERVED: { label: 'Served · print bill', icon: 'check', className: 'tile-served' },
  BILL_PRINTED: { label: 'Bill printed', icon: 'receipt', className: 'tile-bill' },
  RESERVED: { label: 'Reserved', icon: 'calendar', className: 'tile-reserved' },
  BLOCKED: { label: 'Blocked', icon: 'ban', className: 'tile-blocked' },
};

export function tablesInArea(floor: FloorSnapshot, areaId: string | null): FloorTable[] {
  return areaId ? floor.tables.filter((t) => t.areaId === areaId) : floor.tables;
}

/** Finds a table by what the biller typed ("t7", "T 7", "7"); exact label first, then a unique number match. */
export function findTable(floor: FloorSnapshot, query: string): FloorTable | undefined {
  const q = query.replace(/\s+/g, '').toLowerCase();
  if (!q) return undefined;
  const exact = floor.tables.find((t) => t.label.toLowerCase() === q);
  if (exact) return exact;
  if (/^\d+$/.test(q)) {
    const byNumber = floor.tables.filter((t) => t.label.replace(/\D+/g, '') === q);
    if (byNumber.length === 1) return byNumber[0];
  }
  return undefined;
}

export type Arrow = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

/** Index after an arrow key in a grid of `count` tiles with `columns` per row (clamped, no wrap). */
export function moveFocus(index: number, key: Arrow, count: number, columns: number): number {
  if (count === 0) return -1;
  const cols = Math.max(1, columns);
  const i = Math.min(Math.max(index, 0), count - 1);
  switch (key) {
    case 'ArrowLeft':
      return Math.max(0, i - 1);
    case 'ArrowRight':
      return Math.min(count - 1, i + 1);
    case 'ArrowUp':
      return i - cols >= 0 ? i - cols : i;
    case 'ArrowDown':
      return i + cols < count ? i + cols : i;
  }
}

/** Minutes since `since`, from the local clock (the floor refreshes on events, the clock ticks in between). */
export function elapsedMinutes(since: string | undefined, now: Date): number | null {
  if (!since) return null;
  const t = Date.parse(since);
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((now.getTime() - t) / 60_000));
}

export function formatElapsed(min: number | null): string {
  if (min === null) return '';
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
}

/** Counts per state for the area summary chips. */
export function stateCounts(tables: readonly FloorTable[]): Partial<Record<TableState, number>> {
  const out: Partial<Record<TableState, number>> = {};
  for (const t of tables) out[t.state] = (out[t.state] ?? 0) + 1;
  return out;
}

/** Tables whose captain asked for the bill (P3-04), oldest first. */
export function billRequests(floor: FloorSnapshot | undefined): FloorTable[] {
  return (floor?.tables ?? []).filter((t) => t.billRequest && t.orderId).sort((a, b) => a.billRequest!.at.localeCompare(b.billRequest!.at));
}
