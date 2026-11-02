import { newId } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { getOrderSnapshot } from '../queries/order-snapshot.js';
import { denyAll, useHarness } from '../testing/command-harness.js';
import { line, orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';

// P2-04 acceptance: delta slips render; leakage flags; PIN rules (PIN paths over HTTP in auth.test.ts).
describe('after the KOT: ModifyFiredItem, CancelFiredItem, ReprintKOT, ReprintBill', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  let orderId: string;
  let naan: string;
  let dal: string;
  beforeEach(() => {
    seedOutlet(h);
    orderId = o.open(S.t1, 4).order!.id;
    naan = newId();
    dal = newId();
    o.run('AddItems', orderId, { items: [line(S.butterNaan, { id: naan, qty: 4, addons: [{ addonId: S.butter }] }), line(S.dalMakhani, { id: dal, qty: 2 })] });
    o.run('FireKOT', orderId, { all: true });
  });

  const slip = (kind: string) => h.db.prepare(`SELECT preview_text FROM print_job j JOIN kot k ON k.id = j.ref_id WHERE k.kind = ? ORDER BY j.rowid DESC LIMIT 1`).pluck().get(kind) as string;
  const leakage = (action: string) => h.db.prepare('SELECT leakage_flag, reason FROM audit_event WHERE action = ?').get(action) as { leakage_flag: number; reason: string };
  const snapshot = () => getOrderSnapshot(h.db, orderId)!;

  it('reducing a fired line prints a modify slip; the removed part stays on the KOT as cancelled and leaves the bill', () => {
    const before = snapshot().totals.subtotalPaise;
    const res = o.run('ModifyFiredItem', orderId, { orderItemId: naan, newQty: 1, reason: 'Guest changed mind' });
    expect(res.result).toMatchObject({ orderItemId: naan, qty: 1, kotNo: 3 });
    const p = slip('modify');
    expect(p).toContain('MODIFIED KOT 0003');
    expect(p).toContain('Changes KOT 0002'); // Tandoor's KOT (Kitchen fired as 0001)
    expect(p).toMatch(/-3 Butter Naan/);
    expect(p).toContain('now 1');
    expect(p).toContain('Reason: Guest changed mind');
    const items = snapshot().items.filter((i) => i.itemId === S.butterNaan);
    expect(items.map((i) => [i.qty, i.status, i.kotNo])).toEqual([
      [1, 'fired', 2],
      [3, 'cancelled', 2],
    ]);
    expect(items[0]!.addons).toHaveLength(1); // add-ons are per line: they stay with what is left
    expect(snapshot().totals.subtotalPaise).toBe(before - 3 * 6_000);
    expect(leakage('item.modify_fired')).toEqual({ leakage_flag: 1, reason: 'Guest changed mind' });
  });

  it('ModifyFiredItem cannot raise the quantity, or touch a held, cancelled or unknown line', () => {
    const at = () => ({ orderId, expectedVersion: snapshot().version });
    expect(h.fail('ModifyFiredItem', { orderItemId: naan, newQty: 4, reason: 'x' }, 'INVALID_STATE', at()).message).toMatch(/add the item again/);
    h.fail('ModifyFiredItem', { orderItemId: naan, newQty: 0, reason: 'x' }, 'VALIDATION', at()); // 0 = cancel instead
    const held = newId();
    o.run('AddItems', orderId, { items: [line(S.dalMakhani, { id: held })] });
    h.fail('ModifyFiredItem', { orderItemId: held, newQty: 1, reason: 'x' }, 'INVALID_STATE', at());
    h.fail('CancelFiredItem', { orderItemId: newId(), reason: 'x' }, 'NOT_FOUND', at());
    h.fail('ModifyFiredItem', { orderItemId: naan, newQty: 1, reason: '' }, 'VALIDATION', at()); // a reason is required
  });

  it('cancelling prints a cancel slip with the add-ons; the line is kept as cancelled', () => {
    o.run('CancelFiredItem', orderId, { orderItemId: naan, reason: 'Wrong order' });
    const p = slip('cancel');
    expect(p).toContain('CANCELLED KOT');
    expect(p).toMatch(/-4 Butter Naan/);
    expect(p).toContain('+ Extra butter');
    expect(snapshot().items.find((i) => i.id === naan)!.status).toBe('cancelled');
    expect(leakage('item.cancel_fired').leakage_flag).toBe(1);
    h.fail('CancelFiredItem', { orderItemId: naan, reason: 'again' }, 'INVALID_STATE', { orderId, expectedVersion: snapshot().version });
  });

  it('changing a fired item after the bill was printed supersedes the bill (same number at the next print)', () => {
    o.run('PrintBill', orderId, {});
    o.run('CancelFiredItem', orderId, { orderItemId: dal, reason: 'Not served' });
    expect(snapshot().state).toBe('open');
    expect(h.db.prepare('SELECT state FROM bill').pluck().get()).toBe('superseded');
  });

  it('settled orders cannot change; version conflicts and replays behave like every order command', () => {
    const commandId = newId();
    const v = snapshot().version;
    o.run('CancelFiredItem', orderId, { orderItemId: dal, reason: 'x' }, { commandId });
    expect(o.run('CancelFiredItem', orderId, { orderItemId: dal, reason: 'x' }, { commandId, expectedVersion: v }).duplicate).toBe(true);
    expect(h.count('kot', "kind = 'cancel'")).toBe(1);
    h.fail('ModifyFiredItem', { orderItemId: naan, newQty: 1, reason: 'x' }, 'VERSION_CONFLICT', { orderId, expectedVersion: v });
  });

  it('FORBIDDEN without kot.modify / kot.cancel / reprint', () => {
    const v = snapshot().version;
    expect(h.fail('ModifyFiredItem', { orderItemId: naan, newQty: 1, reason: 'x' }, 'FORBIDDEN', { orderId, expectedVersion: v, rights: denyAll }).details).toEqual({ right: 'kot.modify' });
    expect(h.fail('CancelFiredItem', { orderItemId: naan, reason: 'x' }, 'FORBIDDEN', { orderId, expectedVersion: v, rights: denyAll }).details).toEqual({ right: 'kot.cancel' });
    const kotId = h.db.prepare('SELECT id FROM kot LIMIT 1').pluck().get() as string;
    expect(h.fail('ReprintKOT', { kotId }, 'FORBIDDEN', { rights: denyAll }).details).toEqual({ right: 'reprint' });
  });

  it('"not prepared" puts the removed portions back into stock against the slip', () => {
    const flour = h.db.prepare("SELECT id FROM stock_item WHERE name = 'Maida'").pluck().get() as string;
    const onHand = () => h.db.prepare('SELECT on_hand_milli FROM stock_item WHERE id = ?').pluck().get(flour) as number;
    const afterFire = onHand();
    o.run('ModifyFiredItem', orderId, { orderItemId: naan, newQty: 1, reason: 'Not cooked yet', returnToStock: true });
    expect(onHand()).toBe(afterFire + 3 * 80); // Butter Naan recipe: 80 g maida each
    const back = h.db.prepare("SELECT kind, ref_type, reason FROM stock_movement WHERE delta_milli > 0 AND stock_item_id = ? AND kind = 'adjust'").get(flour);
    expect(back).toMatchObject({ kind: 'adjust', ref_type: 'kot' });
    o.run('CancelFiredItem', orderId, { orderItemId: naan, reason: 'Gone', returnToStock: false });
    expect(onHand()).toBe(afterFire + 240); // food made: nothing comes back
  });

  it('ReprintKOT prints the stored ticket as first printed, marked DUPLICATE, and counts it', () => {
    const kot = h.db.prepare("SELECT id, kot_no FROM kot WHERE kind = 'new' ORDER BY kot_no DESC LIMIT 1").get() as { id: string; kot_no: number };
    o.run('ModifyFiredItem', orderId, { orderItemId: naan, newQty: 1, reason: 'x' }); // the original ticket had 4 naan
    h.run('ReprintKOT', { kotId: kot.id });
    const p = h.db.prepare("SELECT preview_text FROM print_job WHERE ref_id = ? ORDER BY rowid DESC LIMIT 1").pluck().get(kot.id) as string;
    expect(p.split('\n')[0]).toContain('** DUPLICATE **');
    expect(p).toMatch(/4\s+Butter Naan/);
    expect(h.db.prepare('SELECT reprint_count FROM kot WHERE id = ?').pluck().get(kot.id)).toBe(1);
    expect(leakage('kot.reprint').leakage_flag).toBe(1);
    h.fail('ReprintKOT', { kotId: newId() }, 'NOT_FOUND');
  });

  it('ReprintBill prints the stored bill as DUPLICATE with the same number; refused when superseded', () => {
    const billNo = (o.run('PrintBill', orderId, {}).result as { billNo: string }).billNo;
    const billId = h.db.prepare('SELECT id FROM bill').pluck().get() as string;
    expect(h.run('ReprintBill', { billId }).result).toEqual({ billId, billNo, reprint: 1 });
    expect(h.run('ReprintBill', { billId }).result).toMatchObject({ reprint: 2 });
    const p = h.db.prepare("SELECT preview_text FROM print_job WHERE doc_kind = 'bill' ORDER BY rowid DESC LIMIT 1").pluck().get() as string;
    expect(p.split('\n')[0]).toContain('** DUPLICATE **');
    expect(p).toContain(billNo);
    expect(leakage('bill.reprint').leakage_flag).toBe(1);
    o.run('CancelFiredItem', orderId, { orderItemId: dal, reason: 'x' });
    h.fail('ReprintBill', { billId }, 'INVALID_STATE');
  });

  it('a settled bill can still be reprinted; a settled order cannot be changed', () => {
    o.run('PrintBill', orderId, {});
    const bill = h.db.prepare('SELECT id, total_paise FROM bill').get() as { id: string; total_paise: number };
    o.run('Settle', orderId, { billId: bill.id, tenders: [{ mode: 'cash', amountPaise: bill.total_paise }] });
    expect(h.run('ReprintBill', { billId: bill.id }).ok).toBe(true);
    h.fail('CancelFiredItem', { orderItemId: dal, reason: 'x' }, 'INVALID_STATE', { orderId, expectedVersion: snapshot().version });
  });
});
