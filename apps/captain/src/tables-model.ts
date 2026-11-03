// Pure helpers for the captain's table list (tested).
import type { FloorSnapshot, FloorTable, TableState } from '@dinepos/shared';

export const STATE_LABEL: Record<TableState, string> = {
  FREE: 'Free',
  SEATED: 'Seated',
  KOT_RUNNING: 'Food on its way',
  BILL_PRINTED: 'Bill printed',
  RESERVED: 'Reserved',
  BLOCKED: 'Blocked',
};

export const STATE_CLASS: Record<TableState, string> = {
  FREE: 'tile-free',
  SEATED: 'tile-seated',
  KOT_RUNNING: 'tile-kot',
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
