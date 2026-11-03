import { newId } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { getKdsBoard } from '../queries/kds.js';
import { runReport } from '../reports/catalog.js';
import { denyAll, TEST_NOW, useHarness } from '../testing/command-harness.js';
import { line, orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';

// P4-02: the kitchen display. A KOT goes new → ready → served (or back), without touching the order's version.
describe('kitchen display', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  let orderId: string;
  let kotId: string;
  beforeEach(() => {
    seedOutlet(h);
    orderId = o.open(S.t1, 3).order!.id;
    o.run('AddItems', orderId, { items: [line(S.dalMakhani, { qty: 2, note: 'less spicy' }), line(S.butterNaan, { addons: [{ addonId: S.butter }] })] });
    const kots = (o.run('FireKOT', orderId, { all: true }).result as { kots: Array<{ id: string; stationId: string }> }).kots;
    kotId = kots.find((k) => k.stationId === S.kitchen)!.id;
  });
  const board = (stationId = S.kitchen) => getKdsBoard(h.db, stationId, TEST_NOW(), 'Asia/Kolkata');
  const version = () => h.db.prepare('SELECT version FROM "order" WHERE id = ?').pluck().get(orderId);
  const statusEvents = () => (h.db.prepare("SELECT payload_json FROM event_log WHERE event = 'kot.status' AND topic = 'kds' ORDER BY seq").pluck().all() as string[]).map((j) => (JSON.parse(j) as { status: string }).status);

  it('the board shows the station’s tickets as printed: table, guests, lines with notes, and the age thresholds', () => {
    const b = board();
    expect(b.station.name).toBe('Kitchen');
    expect(b).toMatchObject({ amberMin: 10, redMin: 20 });
    expect(b.tickets).toHaveLength(1);
    expect(b.tickets[0]).toMatchObject({ id: kotId, kind: 'new', orderId, tableLabel: 'T1', covers: 3, lines: [{ qty: 2, name: 'Dal Makhani', note: 'less spicy', course: 1 }] });
    expect(b.tickets[0]!.readyAt).toBeUndefined();
    expect(board(S.tandoor).tickets[0]!.lines[0]).toMatchObject({ name: 'Butter Naan', addons: [{ name: 'Extra butter', qty: 1 }] }); // other station, own ticket
  });

  it('bump → ready, second bump → served (off the board); recall brings it back; the order version never moves', () => {
    const v = version();
    h.run('MarkKotReady', { kotId });
    expect(board().tickets[0]!.readyAt).toBe(TEST_NOW().toISOString());
    h.run('MarkKotServed', { kotId });
    expect(board().tickets).toEqual([]);
    h.run('RecallKot', { kotId });
    expect(board().tickets[0]).toMatchObject({ id: kotId });
    expect(board().tickets[0]!.readyAt).toBeUndefined();
    expect(version()).toBe(v);
    expect(statusEvents()).toEqual(['ready', 'served', 'new']);
    expect(h.count('audit_event', "action IN ('kot.ready', 'kot.served', 'kot.recall')")).toBe(3);
  });

  it('served without a first bump counts as ready at the same moment (complete kitchen times)', () => {
    h.run('MarkKotServed', { kotId });
    const row = h.db.prepare('SELECT ready_at, served_at FROM kot WHERE id = ?').get(kotId) as { ready_at: string; served_at: string };
    expect(row.ready_at).toBe(row.served_at);
  });

  it('INVALID_STATE for a bump twice, a served ticket, or a recall of an unbumped one; NOT_FOUND for an unknown ticket', () => {
    h.fail('RecallKot', { kotId }, 'INVALID_STATE');
    h.run('MarkKotReady', { kotId });
    expect(h.fail('MarkKotReady', { kotId }, 'INVALID_STATE').message).toMatch(/already ready/);
    h.run('MarkKotServed', { kotId });
    h.fail('MarkKotServed', { kotId }, 'INVALID_STATE');
    h.fail('MarkKotReady', { kotId }, 'INVALID_STATE');
    h.fail('MarkKotReady', { kotId: newId() }, 'NOT_FOUND');
  });

  it('FORBIDDEN without kds.bump; DUPLICATE replay changes nothing more', () => {
    expect(h.fail('MarkKotReady', { kotId }, 'FORBIDDEN', { rights: denyAll }).details).toEqual({ right: 'kds.bump' });
    const commandId = newId();
    h.run('MarkKotReady', { kotId }, { commandId });
    expect(h.run('MarkKotReady', { kotId }, { commandId }).duplicate).toBe(true);
    expect(h.count('audit_event', "action = 'kot.ready'")).toBe(1);
  });

  it('change slips show too; tickets of paid orders leave the board', () => {
    const dal = h.db.prepare("SELECT id FROM order_item WHERE order_id = ? AND name_snapshot = 'Dal Makhani'").pluck().get(orderId) as string;
    o.run('ModifyFiredItem', orderId, { orderItemId: dal, newQty: 1, reason: 'Guest changed mind' });
    expect(board().tickets.map((t) => [t.kind, t.reason, t.lines[0]!.qty])).toEqual([
      ['new', null, 2],
      ['modify', 'Guest changed mind', -1],
    ]);
    o.run('PrintBill', orderId, {});
    const bill = h.db.prepare('SELECT id, total_paise FROM bill WHERE order_id = ?').get(orderId) as { id: string; total_paise: number };
    o.run('Settle', orderId, { billId: bill.id, tenders: [{ mode: 'cash', amountPaise: bill.total_paise }] });
    expect(board().tickets).toEqual([]);
  });

  it('kitchen speed report: average and slowest to ready, over the amber time, never bumped', () => {
    h.run('MarkKotReady', { kotId });
    // Fired 12 min 30 s before it was bumped: over the 10-minute amber time.
    h.db.prepare('UPDATE kot SET fired_at = ? WHERE id = ?').run(new Date(TEST_NOW().getTime() - 750_000).toISOString(), kotId);
    const r = runReport(h.db, 'kitchen', '2026-11-02', '2026-11-02', 'Asia/Kolkata');
    expect(r.rows).toEqual([
      { station: 'Kitchen', tickets: 1, avg: '12 min 30 s', slowest: '12 min 30 s', late: 1, onTime: '0%', notBumped: 0 },
      { station: 'Tandoor', tickets: 0, avg: '', slowest: '', late: 0, onTime: '', notBumped: 1 },
    ]);
    expect(r.columns.find((c) => c.key === 'late')!.label).toBe('Over 10 min');
    expect(r.totals).toMatchObject({ tickets: 1, late: 1, notBumped: 1, avg: '12 min 30 s' });
  });
});
