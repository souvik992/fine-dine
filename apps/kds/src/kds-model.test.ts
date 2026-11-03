import type { KdsTicket } from '@dinepos/shared';
import { describe, expect, it } from 'vitest';
import { ageLevel, ageSeconds, ageText, allDay, bumpTargets, byCourse, chosenStation, columns } from './kds-model.js';

const ticket = (id: string, extra: Partial<KdsTicket> = {}): KdsTicket => ({
  id,
  kotNo: 1,
  kind: 'new',
  orderId: 'o',
  orderType: 'dine_in',
  firedAt: '2026-11-02T08:00:00.000Z',
  lines: [],
  ...extra,
});
const l = (name: string, qty: number, course = 1) => ({ name, qty, course, addons: [] });

describe('kitchen screen model', () => {
  it('ticket age on the server clock, as m:ss; amber and red at the outlet’s thresholds', () => {
    const t = ticket('a');
    const fired = Date.parse(t.firedAt);
    expect(ageSeconds(t, fired + 125_000, 0)).toBe(125);
    expect(ageSeconds(t, fired, 30_000)).toBe(30); // this screen's clock is 30 s behind the server
    expect(ageSeconds(t, fired - 5_000, 0)).toBe(0);
    expect([ageText(125), ageText(750), ageText(3900)]).toEqual(['2:05', '12:30', '1:05:00']);
    const board = { amberMin: 10, redMin: 20 };
    expect([ageLevel(599, board), ageLevel(600, board), ageLevel(1199, board), ageLevel(1200, board)]).toEqual(['ok', 'amber', 'amber', 'red']);
  });

  it('splits New and Ready; groups lines by course', () => {
    const c = columns([ticket('a'), ticket('b', { readyAt: 'x' }), ticket('c')]);
    expect([c.fresh.map((x) => x.ticket.id), c.ready.map((x) => x.ticket.id)]).toEqual([['a', 'c'], ['b']]);
    expect(byCourse([l('Soup', 1, 2), l('Naan', 2, 1), l('Dal', 1, 2)]).map((g) => [g.course, g.lines.map((x) => x.name)])).toEqual([
      [1, ['Naan']],
      [2, ['Soup', 'Dal']],
    ]);
  });

  it('all-day counts: still to cook, change slips taken off, ready tickets and move notices left out', () => {
    const counts = allDay([
      ticket('a', { lines: [l('Dal Makhani', 2), l('Jeera Rice', 1)] }),
      ticket('b', { lines: [l('Dal Makhani', 3)] }),
      ticket('c', { kind: 'modify', lines: [l('Dal Makhani', -1), l('Jeera Rice', -1)] }),
      ticket('d', { readyAt: 'x', lines: [l('Paneer Tikka', 4)] }),
      ticket('e', { kind: 'move_notice', lines: [l('Dal Makhani', 2)] }),
    ]);
    expect(counts).toEqual([{ name: 'Dal Makhani', qty: 4 }]);
  });

  it('the station: ?station= first, then the saved choice', () => {
    expect(chosenStation('?station=S1', 'S2')).toBe('S1');
    expect(chosenStation('', 'S2')).toBe('S2');
    expect(chosenStation('', null)).toBeNull();
  });

  it('change slips sit on the ticket they change; on their own once it went out; a bump takes them along', () => {
    const original = ticket('k41', { kotNo: 41, readyAt: 'x' });
    const slip = ticket('k43', { kotNo: 43, kind: 'modify', forKotNo: 41 });
    const orphan = ticket('k44', { kotNo: 44, kind: 'cancel', forKotNo: 30 });
    const other = ticket('k45', { kotNo: 45, kind: 'modify', forKotNo: 41, orderId: 'another order' });
    const c = columns([original, slip, orphan, other]);
    expect(c.ready.map((x) => [x.ticket.id, x.slips.map((s) => s.id)])).toEqual([['k41', ['k43']]]);
    expect(c.fresh.map((x) => x.ticket.id)).toEqual(['k44', 'k45']);
    const card = c.ready[0]!;
    expect(bumpTargets(card, 'served').map((t) => t.id)).toEqual(['k41', 'k43']);
    expect(bumpTargets(card, 'recall').map((t) => t.id)).toEqual(['k41']); // the slip was never bumped
    expect(bumpTargets(card, 'ready').map((t) => t.id)).toEqual(['k41', 'k43']);
  });
});
