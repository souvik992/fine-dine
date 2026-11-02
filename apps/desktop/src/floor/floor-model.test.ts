import type { FloorSnapshot, FloorTable } from '@dinepos/shared';
import { describe, expect, it } from 'vitest';
import { elapsedMinutes, findTable, formatElapsed, moveFocus, STATE_META, stateCounts, tablesInArea } from './floor-model.js';

const t = (label: string, areaId: string, state: FloorTable['state'] = 'FREE'): FloorTable => ({ id: label, label, areaId, state });
const floor: FloorSnapshot = {
  serverTime: '2026-11-02T13:30:00.000+05:30',
  areas: [
    { id: 'main', name: 'Main', sort: 0 },
    { id: 'roof', name: 'Roof', sort: 1 },
  ],
  tables: [t('T1', 'main'), t('T7', 'main', 'SEATED'), t('T17', 'main'), t('R1', 'roof', 'KOT_RUNNING')],
};

describe('floor model', () => {
  it('filters by area', () => {
    expect(tablesInArea(floor, 'roof').map((x) => x.label)).toEqual(['R1']);
    expect(tablesInArea(floor, null)).toHaveLength(4);
  });

  it('finds tables the way billers type them', () => {
    expect(findTable(floor, 't7')?.label).toBe('T7');
    expect(findTable(floor, ' T 17 ')?.label).toBe('T17');
    expect(findTable(floor, '17')?.label).toBe('T17');
    expect(findTable(floor, '1')).toBeUndefined(); // T1 and R1 both match: ambiguous
    expect(findTable(floor, '')).toBeUndefined();
  });

  it('moves focus in a grid without wrapping', () => {
    // 7 tiles, 3 per row: 0 1 2 / 3 4 5 / 6
    expect(moveFocus(0, 'ArrowRight', 7, 3)).toBe(1);
    expect(moveFocus(0, 'ArrowLeft', 7, 3)).toBe(0);
    expect(moveFocus(1, 'ArrowDown', 7, 3)).toBe(4);
    expect(moveFocus(4, 'ArrowDown', 7, 3)).toBe(4); // no tile below 4
    expect(moveFocus(6, 'ArrowUp', 7, 3)).toBe(3);
    expect(moveFocus(-1, 'ArrowRight', 7, 3)).toBe(1);
    expect(moveFocus(0, 'ArrowDown', 0, 3)).toBe(-1);
  });

  it('formats elapsed time from the local clock', () => {
    const now = new Date('2026-11-02T08:00:00Z');
    expect(elapsedMinutes('2026-11-02T07:15:00Z', now)).toBe(45);
    expect(elapsedMinutes(undefined, now)).toBeNull();
    expect(formatElapsed(45)).toBe('45m');
    expect(formatElapsed(125)).toBe('2h 05m');
    expect(formatElapsed(null)).toBe('');
  });

  it('gives every state a text label and icon, not just a colour', () => {
    for (const meta of Object.values(STATE_META)) {
      expect(meta.label).toMatch(/\w/);
      expect(meta.icon).toBeTruthy();
    }
    expect(stateCounts(floor.tables)).toEqual({ FREE: 2, SEATED: 1, KOT_RUNNING: 1 });
  });
});
