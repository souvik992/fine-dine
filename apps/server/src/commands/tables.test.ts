import { newId } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { getOrderSnapshot } from '../queries/order-snapshot.js';
import { seedId } from '../seed/dev-seed.js';
import { denyAll, useHarness } from '../testing/command-harness.js';
import { line, orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';

// P2-03 acceptance: KOT history preserved; move_notice KOT printed; leakage flags set.
describe('MoveTable, MergeTables, TransferItems', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  const t3 = seedId('table:main:3');
  let a: string; // T1: 2 naan (Tandoor) + 1 dal (Kitchen), fired
  let naan: string;
  let dal: string;
  beforeEach(() => {
    seedOutlet(h);
    a = o.open(S.t1, 2).order!.id;
    naan = newId();
    dal = newId();
    o.run('AddItems', a, { items: [line(S.butterNaan, { id: naan, qty: 2 }), line(S.dalMakhani, { id: dal })] });
    o.run('FireKOT', a, { all: true });
  });

  const notices = () =>
    h.db.prepare(`SELECT j.preview_text FROM print_job j JOIN kot k ON k.id = j.ref_id WHERE k.kind = 'move_notice' ORDER BY j.rowid`).pluck().all() as string[];
  const audit = (action: string) => h.db.prepare('SELECT leakage_flag, after_json FROM audit_event WHERE action = ? ORDER BY seq DESC').get(action) as { leakage_flag: number; after_json: string };
  const snap = (id: string) => getOrderSnapshot(h.db, id)!;
  const kotIds = (id: string) => snap(id).items.map((i) => i.kotId);

  describe('MoveTable', () => {
    it('moves the order to a free table; both tables update; KOTs and prices unchanged; a notice per station', () => {
      const before = snap(a);
      const res = o.run('MoveTable', a, { toTableId: t3 });
      expect(res.result).toMatchObject({ fromTableId: S.t1, toTableId: t3 });
      expect(o.tableState(S.t1)).toBe('FREE');
      expect(o.tableState(t3)).toBe('KOT_RUNNING');
      expect(snap(a).items.map((i) => [i.kotId, i.unitPricePaise])).toEqual(before.items.map((i) => [i.kotId, i.unitPricePaise]));
      expect(notices()).toHaveLength(2); // Kitchen and Tandoor
      expect(notices()[0]).toContain('MOVED T1 -> T3');
      expect(notices()[0]).toContain('Table T3');
      expect(audit('order.move_table').leakage_flag).toBe(1);
    });

    it('before any KOT: no notice and no leakage flag', () => {
      const b = o.open(S.t2, 2).order!.id;
      o.run('MoveTable', b, { toTableId: t3 });
      expect(notices()).toHaveLength(0);
      expect(audit('order.move_table').leakage_flag).toBe(0);
    });

    it('refuses an occupied, blocked, unknown or the same table', () => {
      o.open(S.t2, 2);
      const at = () => ({ orderId: a, expectedVersion: snap(a).version });
      expect(h.fail('MoveTable', { toTableId: S.t2 }, 'INVALID_STATE', at()).message).toMatch(/Merge/);
      h.fail('MoveTable', { toTableId: S.t1 }, 'INVALID_STATE', at());
      h.fail('MoveTable', { toTableId: newId() }, 'NOT_FOUND', at());
      h.db.prepare("UPDATE dining_table SET status = 'blocked' WHERE id = ?").run(t3);
      h.fail('MoveTable', { toTableId: t3 }, 'INVALID_STATE', at());
    });

    it('FORBIDDEN without table.move; VERSION_CONFLICT on a stale version; replay is a DUPLICATE', () => {
      const v = snap(a).version;
      expect(h.fail('MoveTable', { toTableId: t3 }, 'FORBIDDEN', { orderId: a, expectedVersion: v, rights: denyAll }).details).toEqual({ right: 'table.move' });
      h.fail('MoveTable', { toTableId: t3 }, 'VERSION_CONFLICT', { orderId: a, expectedVersion: v - 1 });
      const commandId = newId();
      o.run('MoveTable', a, { toTableId: t3 }, { commandId });
      expect(o.run('MoveTable', a, { toTableId: t3 }, { commandId, expectedVersion: v }).duplicate).toBe(true);
      expect(notices()).toHaveLength(2);
    });
  });

  describe('MergeTables', () => {
    let b: string;
    let rice: string;
    beforeEach(() => {
      b = o.open(S.t2, 3).order!.id;
      rice = newId();
      o.run('AddItems', b, { items: [line(S.dalMakhani, { id: rice, qty: 1 })] });
      o.run('FireKOT', b, { all: true });
    });

    it('moves the other order in with its KOT links; covers add up; it becomes merged and its table is freed', () => {
      const bKot = kotIds(b)[0];
      const vB = snap(b).version;
      const res = o.run('MergeTables', a, { sourceOrderId: b });
      expect(res.result).toMatchObject({ orderId: a, mergedOrderId: b, movedItems: 1 });
      const merged = snap(a);
      expect(merged.items.find((i) => i.id === rice)).toMatchObject({ kotId: bKot }); // KOT history kept
      expect(h.db.prepare('SELECT order_id FROM kot WHERE id = ?').pluck().get(bKot)).toBe(b); // the KOT row stays with T2's order
      expect(h.db.prepare('SELECT original_order_id FROM order_item WHERE id = ?').pluck().get(rice)).toBe(b);
      expect(merged.covers).toBe(5);
      expect(snap(b)).toMatchObject({ state: 'merged', version: vB + 1 });
      expect(h.db.prepare('SELECT merged_into FROM "order" WHERE id = ?').pluck().get(b)).toBe(a);
      expect(o.tableState(S.t2)).toBe('FREE');
      expect(o.tableState(S.t1)).toBe('KOT_RUNNING');
      expect(notices()[0]).toContain('MERGED T2 -> T1');
      expect(audit('order.merge_in').leakage_flag).toBe(1);
      expect(audit('order.merged').leakage_flag).toBe(1);
    });

    it('supersedes printed bills on both sides', () => {
      o.run('PrintBill', a, {});
      o.run('PrintBill', b, {});
      o.run('MergeTables', a, { sourceOrderId: b });
      expect(h.db.prepare("SELECT count(*) FROM bill WHERE state = 'superseded'").pluck().get()).toBe(2);
      expect(snap(a).state).toBe('open');
      expect(o.tableState(S.t1)).toBe('KOT_RUNNING'); // not "bill printed": that bill no longer applies
    });

    it('refuses merging an order into itself, or a settled one; FORBIDDEN without table.merge', () => {
      const at = () => ({ orderId: a, expectedVersion: snap(a).version });
      h.fail('MergeTables', { sourceOrderId: a }, 'INVALID_STATE', at());
      h.fail('MergeTables', { sourceOrderId: newId() }, 'NOT_FOUND', at());
      expect(h.fail('MergeTables', { sourceOrderId: b }, 'FORBIDDEN', { ...at(), rights: denyAll }).details).toEqual({ right: 'table.merge' });
      o.run('PrintBill', b, {});
      const bill = h.db.prepare('SELECT id, total_paise FROM bill WHERE order_id = ?').get(b) as { id: string; total_paise: number };
      o.run('Settle', b, { billId: bill.id, tenders: [{ mode: 'cash', amountPaise: bill.total_paise }] });
      h.fail('MergeTables', { sourceOrderId: b }, 'INVALID_STATE', at());
    });
  });

  describe('TransferItems', () => {
    let b: string;
    beforeEach(() => {
      b = o.open(S.t2, 2).order!.id;
    });

    it('moves sent lines with their KOT link; their station gets a notice listing them; leakage flag', () => {
      const naanKot = snap(a).items.find((i) => i.id === naan)!.kotId;
      o.run('TransferItems', a, { itemIds: [naan], toOrderId: b });
      expect(snap(a).items.map((i) => i.id)).toEqual([dal]);
      expect(snap(b).items.find((i) => i.id === naan)).toMatchObject({ kotId: naanKot, status: 'fired' });
      expect(notices()).toHaveLength(1); // Tandoor only
      expect(notices()[0]).toContain('ITEMS T1 -> T2');
      expect(notices()[0]).toMatch(/2\s+Butter Naan/);
      expect(audit('order.transfer_items').leakage_flag).toBe(1);
      expect(o.tableState(S.t2)).toBe('KOT_RUNNING');
    });

    it('moving only held lines sends no notice and is not flagged', () => {
      const held = newId();
      o.run('AddItems', a, { items: [line(S.dalMakhani, { id: held })] });
      o.run('TransferItems', a, { itemIds: [held], toOrderId: b });
      expect(notices()).toHaveLength(0);
      expect(audit('order.transfer_items').leakage_flag).toBe(0);
      expect(snap(b).items.find((i) => i.id === held)!.status).toBe('held');
    });

    it('refuses cancelled or unknown lines and the same order; FORBIDDEN without item.transfer', () => {
      const at = () => ({ orderId: a, expectedVersion: snap(a).version });
      o.run('CancelFiredItem', a, { orderItemId: dal, reason: 'x' });
      h.fail('TransferItems', { itemIds: [dal], toOrderId: b }, 'INVALID_STATE', at());
      h.fail('TransferItems', { itemIds: [newId()], toOrderId: b }, 'NOT_FOUND', at());
      h.fail('TransferItems', { itemIds: [naan], toOrderId: a }, 'INVALID_STATE', at());
      expect(h.fail('TransferItems', { itemIds: [naan], toOrderId: b }, 'FORBIDDEN', { ...at(), rights: denyAll }).details).toEqual({ right: 'item.transfer' });
      h.fail('TransferItems', { itemIds: [naan, naan], toOrderId: b }, 'VALIDATION', at());
    });

    it('the receiving order gets a new version and its printed bill is superseded', () => {
      o.run('AddItems', b, { items: [line(S.dalMakhani)] });
      o.run('FireKOT', b, { all: true });
      o.run('PrintBill', b, {});
      const vB = snap(b).version;
      o.run('TransferItems', a, { itemIds: [dal], toOrderId: b });
      expect(snap(b)).toMatchObject({ state: 'open', version: vB + 1 });
      expect(h.db.prepare("SELECT state FROM bill WHERE order_id = ?").pluck().get(b)).toBe('superseded');
    });
  });
});
