// Pure helpers for the captain's table list (tested).
import type { FloorSnapshot, FloorTable, TableState } from '@dinepos/shared';

export { initials } from '@dinepos/client';

export const STATE_LABEL: Record<TableState, string> = {
  FREE: 'Free',
  SEATED: 'Seated',
  KOT_RUNNING: 'Food on its way',
  FOOD_READY: 'Food ready: serve it',
  SERVED: 'Served · bill next',
  BILL_PRINTED: 'Bill printed',
  RESERVED: 'Reserved',
  BLOCKED: 'Blocked',
};

export const STATE_CLASS: Record<TableState, string> = {
  FREE: 'tile-free',
  SEATED: 'tile-seated',
  KOT_RUNNING: 'tile-kot',
  FOOD_READY: 'tile-ready',
  SERVED: 'tile-served',
  BILL_PRINTED: 'tile-bill',
  RESERVED: 'tile-reserved',
  BLOCKED: 'tile-blocked',
};

/** "T2" before "T10": natural order by the label's letters, then its number. */
export function byLabel(a: FloorTable, b: FloorTable): number {
  return a.label.localeCompare(b.label, 'en', { numeric: true, sensitivity: 'base' });
}

/** Tables of one area (all when null), in natural label order. */
export function tablesOf(floor: FloorSnapshot, areaId: string | null): FloorTable[] {
  return floor.tables.filter((t) => areaId === null || t.areaId === areaId).sort(byLabel);
}

/** The "My tables" tab (P3-04). */
export const MINE = 'mine';

/** A table is mine when my section holds it, or I am the captain of the order on it. */
export function isMine(t: FloorTable, userId: string | undefined): boolean {
  return !!userId && (t.captainId === userId || (t.sectionCaptainIds?.includes(userId) ?? false));
}

/** The tables for a tab: an area, or MINE (across areas). */
export function tablesFor(floor: FloorSnapshot, tab: string | null, userId: string | undefined): FloorTable[] {
  return tab === MINE ? floor.tables.filter((t) => isMine(t, userId)).sort(byLabel) : tablesOf(floor, tab);
}

/** "12 min", "1 h 05". */
export function elapsedText(min: number | undefined): string {
  if (min === undefined || min < 0) return '';
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

/** Counts per state for the summary chips (only the states present). */
export function stateCounts(tables: FloorTable[]): Array<[TableState, number]> {
  const counts = new Map<TableState, number>();
  for (const t of tables) counts.set(t.state, (counts.get(t.state) ?? 0) + 1);
  return (Object.keys(STATE_LABEL) as TableState[]).filter((s) => counts.has(s)).map((s) => [s, counts.get(s)!]);
}
