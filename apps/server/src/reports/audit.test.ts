import { newId } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../seed/dev-seed.js';
import { useHarness } from '../testing/command-harness.js';
import { line, orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';
import { auditPage, dayBounds, leakageSummary } from './audit.js';

// P4-01: the leakage dashboard counts what docs/02 flags, with amounts; the audit viewer lists who, when and why.
describe('audit viewer and leakage dashboard', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  const DAY = '2026-11-02';
  const TZ = 'Asia/Kolkata';
  const ravi = { deviceId: null, userId: seedId('user:captain') };

  beforeEach(() => {
    seedOutlet(h);
    // T1: 3 dal sent; one cancelled-line of naan, dal reduced 3 → 2; KOT reprinted; moved to T5; paid complimentary.
    const t1 = o.open(S.t1, 2).order!.id;
    const dal = newId();
    const naan = newId();
    o.run('AddItems', t1, { items: [line(S.dalMakhani, { id: dal, qty: 3 }), line(S.butterNaan, { id: naan, qty: 2 })] });
    const kots = (o.run('FireKOT', t1, { all: true }).result as { kots: Array<{ id: string }> }).kots;
    h.run('CancelFiredItem', { orderItemId: naan, reason: 'Burnt' }, { orderId: t1, expectedVersion: h.db.prepare('SELECT version FROM "order" WHERE id = ?').pluck().get(t1) as number, actor: ravi });
    o.run('ModifyFiredItem', t1, { orderItemId: dal, newQty: 2, reason: 'Too much' });
    h.run('ReprintKOT', { kotId: kots[0]!.id });
    o.run('MoveTable', t1, { toTableId: seedId('table:main:5') });
    o.run('PrintBill', t1, {});
    const bill = h.db.prepare('SELECT id, total_paise FROM bill WHERE order_id = ?').get(t1) as { id: string; total_paise: number };
    o.run('Settle', t1, { billId: bill.id, tenders: [{ mode: 'complimentary', amountPaise: bill.total_paise, ref: 'Owner guest' }] });
    // T2: printed then voided unpaid — food made, never paid.
    const t2 = o.open(S.t2, 2).order!.id;
    o.run('AddItems', t2, { items: [line(S.dalMakhani)] });
    o.run('FireKOT', t2, { all: true });
    o.run('PrintBill', t2, {});
    o.run('VoidBill', t2, { billId: h.db.prepare('SELECT id FROM bill WHERE order_id = ?').pluck().get(t2) as string, reason: 'Guest left' });
    h.run('PayOut', { amountPaise: 45_000, reason: 'Milk' });
    h.run('OpenDrawer', { reason: 'Change' });
  });

  it('day bounds are the outlet’s calendar days in UTC', () => {
    expect(dayBounds('2026-11-02', '2026-11-02', TZ)).toEqual({ start: '2026-11-01T18:30:00.000Z', end: '2026-11-02T18:30:00.000Z' });
    expect(() => dayBounds('2026-11-03', '2026-11-02', TZ)).toThrow(/start date/);
  });

  it('cards count every flagged event with its amount; void orders show as unbilled food', () => {
    const { cards, unbilled } = leakageSummary(h.db, DAY, DAY, TZ);
    const card = (k: string) => cards.find((c) => c.key === k)!;
    expect(card('cancelled')).toMatchObject({ count: 1, amountPaise: 2 * 6_000 });
    expect(card('reduced')).toMatchObject({ count: 1, amountPaise: 28_000 });
    expect(card('voids').count).toBe(1);
    expect(card('reprints').count).toBe(1);
    expect(card('moves').count).toBe(1);
    expect(card('complimentary').count).toBe(1);
    expect(card('cash')).toMatchObject({ count: 2, amountPaise: 45_000 });
    expect(card('discounts').count).toBe(0);
    expect(unbilled).toEqual({ orders: 1, items: 1, amountPaise: 28_000 });
    expect(leakageSummary(h.db, '2026-11-01', '2026-11-01', TZ).cards.every((c) => c.count === 0)).toBe(true);
  });

  it('drilling into a card lists who, when and why, in plain words', () => {
    const page = auditPage(h.db, { from: DAY, to: DAY, leakageOnly: true, actions: ['item.cancel_fired', 'item.modify_fired', 'order.move_table'] }, TZ);
    expect(page.entries.map((e) => [e.label, e.ref, e.reason, e.by])).toEqual([
      ['Table moved', 'T1 → T5', null, null],
      ['Reduced after KOT', 'Dal Makhani: 3 → 2', 'Too much', null],
      ['Cancelled after KOT', '2 × Butter Naan', 'Burnt', 'Ravi (Captain)'],
    ]);
    expect(page.entries[0]!.at).toBe('02-11-26 13:30');
  });

  it('the full log pages newest first', () => {
    const first = auditPage(h.db, { from: DAY, to: DAY, limit: 5 }, TZ);
    expect(first.entries).toHaveLength(5);
    expect(first.next).not.toBeNull();
    const second = auditPage(h.db, { from: DAY, to: DAY, limit: 5, before: first.next! }, TZ);
    expect(second.entries[0]!.seq).toBeLessThan(first.entries.at(-1)!.seq);
    expect(first.entries.map((e) => e.seq)).toEqual([...first.entries.map((e) => e.seq)].sort((a, b) => b - a));
  });
});
