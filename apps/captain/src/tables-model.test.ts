import type { FloorSnapshot, FloorTable } from '@dinepos/shared';
import { describe, expect, it } from 'vitest';
import { elapsedText, stateCounts, tablesOf } from './tables-model.js';

const t = (label: string, areaId = 'a', state: FloorTable['state'] = 'FREE'): FloorTable => ({ id: label, label, areaId, state });

describe('captain table list', () => {
  it('lists an area’s tables in natural order', () => {
    const floor = { serverTime: '', areas: [], tables: [t('T10'), t('T2'), t('R1', 'b'), t('T1')] } as FloorSnapshot;
    expect(tablesOf(floor, 'a').map((x) => x.label)).toEqual(['T1', 'T2', 'T10']);
    expect(tablesOf(floor, null)).toHaveLength(4);
  });

  it('shows time at the table and the states present', () => {
    expect(elapsedText(12)).toBe('12 min');
    expect(elapsedText(65)).toBe('1 h 05');
    expect(elapsedText(undefined)).toBe('');
    expect(stateCounts([t('a'), t('b', 'a', 'KOT_RUNNING'), t('c')])).toEqual([
      ['FREE', 2],
      ['KOT_RUNNING', 1],
    ]);
  });
});
