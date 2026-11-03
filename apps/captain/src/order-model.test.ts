import type { OrderItemSnapshot } from '@dinepos/shared';
import { describe, expect, it } from 'vitest';
import { fireChoices, firedMessage, heldByCourse, heldSummary, kotText } from './order-model.js';

const line = (id: string, course: number, status: OrderItemSnapshot['status'] = 'held', qty = 1): OrderItemSnapshot => ({
  id,
  itemId: `i-${id}`,
  name: id,
  qty,
  unitPricePaise: 10_000,
  taxRateBp: 500,
  addons: [],
  course,
  status,
});

describe('captain basket', () => {
  it('groups held lines by course, lowest first; sent and cancelled lines are not in the basket', () => {
    const items = [line('a', 2), line('b', 1, 'held', 2), line('c', 1, 'fired'), line('d', 2, 'cancelled'), line('e', 2)];
    const groups = heldByCourse(items);
    expect(groups.map((g) => [g.course, g.items.map((i) => i.id), g.qty, g.amountPaise])).toEqual([
      [1, ['b'], 2, 20_000],
      [2, ['a', 'e'], 2, 20_000],
    ]);
    expect(heldSummary(items)).toEqual({ qty: 4, amountPaise: 40_000 });
  });

  it('offers Fire all, plus one button per course when more than one course is waiting', () => {
    expect(fireChoices([line('a', 1, 'fired')])).toEqual([]);
    expect(fireChoices([line('a', 1), line('b', 1)]).map((c) => c.label)).toEqual(['Fire all']);
    const choices = fireChoices([line('a', 3), line('b', 1, 'held', 2)]);
    expect(choices.map((c) => [c.label, c.payload, c.qty])).toEqual([
      ['Fire all', { all: true }, 3],
      ['Fire course 1', { course: 1 }, 2],
      ['Fire course 3', { course: 3 }, 1],
    ]);
  });

  it('says which KOTs went to the kitchen', () => {
    expect(kotText(7)).toBe('KOT 0007');
    expect(firedMessage({ kots: [{ kotNo: 12 }, { kotNo: 13 }] })).toBe('KOT 0012, 0013 sent to the kitchen.');
    expect(firedMessage(undefined)).toBe('Sent to the kitchen.');
  });
});
