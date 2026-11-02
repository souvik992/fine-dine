// Floor layout geometry shared by the editor and the floor screen (pure, tested).

/** Logical canvas units; a table tile is TILE_W × TILE_H. Positions are stored as integers (dining_table.layout_x/y). */
export const TILE_W = 140;
export const TILE_H = 100;
export const SNAP = 20;
export const MIN_CANVAS = { w: 1200, h: 720 };
export const MAX_COORD = 10_000;

export interface Placed {
  id: string;
  layoutX: number | null;
  layoutY: number | null;
}

/** Snaps to the grid and keeps the tile on the canvas. */
export function snap(x: number, y: number): { x: number; y: number } {
  const clamp = (v: number, max: number) => Math.min(Math.max(0, Math.round(v / SNAP) * SNAP), max);
  return { x: clamp(x, MAX_COORD - TILE_W), y: clamp(y, MAX_COORD - TILE_H) };
}

/** Canvas size that fits every placed table (never smaller than the default). */
export function canvasSize(tables: readonly Placed[]): { w: number; h: number } {
  let w = MIN_CANVAS.w;
  let h = MIN_CANVAS.h;
  for (const t of tables) {
    if (t.layoutX === null || t.layoutY === null) continue;
    w = Math.max(w, t.layoutX + TILE_W + SNAP * 2);
    h = Math.max(h, t.layoutY + TILE_H + SNAP * 2);
  }
  return { w, h };
}

/** True when every table of the area has a position (the floor screen then shows the saved layout). */
export function hasLayout(tables: readonly Placed[]): boolean {
  return tables.length > 0 && tables.every((t) => t.layoutX !== null && t.layoutY !== null);
}

/** First free grid slot, row by row, for a table that has no position yet. */
export function nextFreeSlot(tables: readonly Placed[], width = MIN_CANVAS.w): { x: number; y: number } {
  const taken = (x: number, y: number) =>
    tables.some((t) => t.layoutX !== null && t.layoutY !== null && Math.abs(t.layoutX - x) < TILE_W && Math.abs(t.layoutY - y) < TILE_H);
  for (let y = SNAP; y < MAX_COORD - TILE_H; y += TILE_H + SNAP) {
    for (let x = SNAP; x + TILE_W <= width; x += TILE_W + SNAP) if (!taken(x, y)) return { x, y };
  }
  return { x: 0, y: 0 };
}

/** Labels for "add several tables": prefix + numbers from..to (e.g. T 9–12 → T9…T12), skipping existing ones. */
export function bulkLabels(prefix: string, from: number, to: number, existing: readonly string[]): string[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to - from > 99) return [];
  const have = new Set(existing.map((l) => l.toLowerCase()));
  const out: string[] = [];
  for (let n = from; n <= to; n++) {
    const label = `${prefix.trim()}${n}`;
    if (!have.has(label.toLowerCase())) out.push(label);
  }
  return out;
}
