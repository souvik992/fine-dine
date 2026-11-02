import { describe, expect, it } from 'vitest';
import { bulkLabels, canvasSize, hasLayout, MIN_CANVAS, nextFreeSlot, snap, TILE_H, TILE_W } from './layout-model.js';

describe('floor layout geometry', () => {
  it('snaps to a 20-unit grid and stays on the canvas', () => {
    expect(snap(31, 49)).toEqual({ x: 40, y: 40 });
    expect(snap(-50, -1)).toEqual({ x: 0, y: 0 });
    expect(snap(99_999, 99_999)).toEqual({ x: 10_000 - TILE_W, y: 10_000 - TILE_H });
  });

  it('grows the canvas to fit placed tables', () => {
    expect(canvasSize([])).toEqual(MIN_CANVAS);
    expect(canvasSize([{ id: 'a', layoutX: 2000, layoutY: 100 }])).toEqual({ w: 2000 + TILE_W + 40, h: MIN_CANVAS.h });
  });

  it('shows the saved layout only when every table has a position', () => {
    expect(hasLayout([{ id: 'a', layoutX: 0, layoutY: 0 }])).toBe(true);
    expect(hasLayout([{ id: 'a', layoutX: 0, layoutY: 0 }, { id: 'b', layoutX: null, layoutY: null }])).toBe(false);
    expect(hasLayout([])).toBe(false);
  });

  it('finds the next free slot row by row', () => {
    expect(nextFreeSlot([])).toEqual({ x: 20, y: 20 });
    expect(nextFreeSlot([{ id: 'a', layoutX: 20, layoutY: 20 }])).toEqual({ x: 20 + TILE_W + 20, y: 20 });
  });

  it('makes labels for several tables, skipping ones that exist', () => {
    expect(bulkLabels('T', 9, 12, ['t10'])).toEqual(['T9', 'T11', 'T12']);
    expect(bulkLabels('R', 3, 1, [])).toEqual([]);
    expect(bulkLabels('X', 1, 500, [])).toEqual([]); // at most 100 at once
  });
});
