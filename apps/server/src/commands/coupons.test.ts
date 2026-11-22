import { calculateBill, newId } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { denyAll, useHarness } from '../testing/command-harness.js';
import { line, orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';

type PrintResult = { billId: string; billNo: string; totalPaise: number };
type CouponResult = { coupon: { id: string; code: string; uses: number; status: string }; created: boolean };

// Coupons and offers (as quickPOS): Settings › Coupons / Offers makes them, the bill dialog uses them.
describe('UpsertCoupon', () => {
  const h = useHarness();
  const save = (p: Record<string, unknown>, opts?: Parameters<typeof h.run>[2]) => h.run('UpsertCoupon', { kind: 'pct', value: 1000, ...p }, opts).result as CouponResult;

  it('adds a coupon (code in capitals) and changes it; its status says whether it can be used today', () => {
    const a = save({ code: ' save10 ', description: 'Diwali offer', maxDiscountPaise: 10_000 });
    expect(a).toMatchObject({ created: true, coupon: { code: 'SAVE10', uses: 0, status: 'active' } });
    const b = save({ couponId: a.coupon.id, code: 'SAVE10', active: false });
    expect(b).toMatchObject({ created: false, coupon: { status: 'off' } });
    expect(save({ code: 'OLD', validTo: '2001-01-31' }).coupon.status).toBe('expired');
    expect(save({ code: 'LATER', validFrom: '2099-01-01' }).coupon.status).toBe('not_started');
    expect(h.count('audit_event', "entity = 'coupon'")).toBe(4);
  });

  it('INVALID_STATE for a code another coupon has; VALIDATION for a bad code, over 100% or dates the wrong way round', () => {
    save({ code: 'SAVE10' });
    h.fail('UpsertCoupon', { code: 'save10', kind: 'amount', value: 5000 }, 'INVALID_STATE');
    h.fail('UpsertCoupon', { code: 'NO', kind: 'amount', value: 5000 }, 'VALIDATION');
    h.fail('UpsertCoupon', { code: 'BAD CODE', kind: 'amount', value: 5000 }, 'VALIDATION');
    h.fail('UpsertCoupon', { code: 'ALL', kind: 'pct', value: 10_001 }, 'VALIDATION');
    h.fail('UpsertCoupon', { code: 'DATES', kind: 'pct', value: 500, validFrom: '2026-12-31', validTo: '2026-12-01' }, 'VALIDATION');
    h.fail('UpsertCoupon', { couponId: newId(), code: 'GONE', kind: 'pct', value: 500 }, 'NOT_FOUND');
  });

  it('FORBIDDEN without the admin right; a replay returns the first result', () => {
    h.fail('UpsertCoupon', { code: 'SAVE10', kind: 'pct', value: 1000 }, 'FORBIDDEN', { rights: denyAll });
    const commandId = newId();
    const first = h.run('UpsertCoupon', { code: 'SAVE10', kind: 'pct', value: 1000 }, { commandId });
    expect(h.run('UpsertCoupon', { code: 'SAVE10', kind: 'pct', value: 1000 }, { commandId })).toEqual({ ...first, duplicate: true });
    expect(h.count('coupon')).toBe(1);
  });
});

describe('PrintBill with a coupon', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  let orderId: string;
  const coupon = (p: Record<string, unknown>) => (h.run('UpsertCoupon', { kind: 'pct', value: 1000, ...p }).result as CouponResult).coupon;
  const newOrder = () => {
    const id = o.open(S.t2, 2).order!.id;
    o.run('AddItems', id, { items: [line(S.dalMakhani)] });
    o.run('FireKOT', id, { all: true });
    return id;
  };

  beforeEach(() => {
    seedOutlet(h);
    orderId = o.open(S.t1, 4).order!.id;
    // ₹1,140 of food at 5%: Paneer Tikka 2 × ₹320, Dal Makhani ₹280, Butter Naan 3 × ₹60 + cheese ₹40
    o.run('AddItems', orderId, {
      items: [line(S.paneerTikka, { qty: 2, addons: [{ addonId: S.mild }] }), line(S.dalMakhani), line(S.butterNaan, { qty: 3, addons: [{ addonId: S.cheese }] })],
    });
    o.run('FireKOT', orderId, { all: true });
  });

  const print = (id: string, payload: unknown) => o.run('PrintBill', id, payload).result as PrintResult;
  const bill = (id: string) => h.db.prepare('SELECT * FROM bill WHERE id = ?').get(id) as Record<string, number | string | null>;

  it('takes the coupon off as the bill discount, before GST, capped, with "Coupon CODE" as the reason', () => {
    coupon({ code: 'SAVE10', maxDiscountPaise: 10_000 }); // 10% of ₹1,140 = ₹114, at most ₹100
    const r = print(orderId, { coupon: 'save10' });
    const expected = calculateBill(
      [
        { id: 'a', qty: 2, unitPricePaise: 32_000, taxRateBp: 500 },
        { id: 'b', qty: 1, unitPricePaise: 28_000, taxRateBp: 500 },
        { id: 'c', qty: 3, unitPricePaise: 6_000, taxRateBp: 500, addons: [{ qty: 1, pricePaise: 4_000 }] },
      ],
      { discount: { kind: 'amount', valuePaise: 10_000 }, serviceChargeBp: 0, roundOffStep: 100, roundOffTie: 'up' },
    );
    expect(r.totalPaise).toBe(expected.total);
    expect(bill(r.billId)).toMatchObject({ discount_paise: 10_000, discount_reason: 'Coupon SAVE10', cgst_paise: expected.cgst, sgst_paise: expected.sgst });
    expect(h.db.prepare('SELECT code, discount_paise FROM coupon_use WHERE bill_id = ?').get(r.billId)).toEqual({ code: 'SAVE10', discount_paise: 10_000 });
    const doc = JSON.parse(h.db.prepare('SELECT doc_json FROM bill_document WHERE bill_id = ?').pluck().get(r.billId) as string) as { discountReason: string };
    expect(doc.discountReason).toBe('Coupon SAVE10');
  });

  it('an amount coupon never takes off more than the bill', () => {
    coupon({ code: 'BIG', kind: 'amount', value: 500_000 });
    const r = print(orderId, { coupon: 'BIG' });
    expect(bill(r.billId)).toMatchObject({ discount_paise: 114_000, total_paise: 0 });
  });

  it('refused (INVALID_STATE, no bill number used) when unknown, switched off, out of dates, below the minimum bill or used up', () => {
    coupon({ code: 'OFF', active: false });
    coupon({ code: 'OLD', validTo: '2001-01-31' });
    coupon({ code: 'MIN', kind: 'amount', value: 5_000, minBillPaise: 500_000 });
    expect(h.fail('PrintBill', { coupon: 'NOPE' }, 'INVALID_STATE', { orderId, expectedVersion: 3 }).message).toMatch(/No coupon with this code/);
    expect(h.fail('PrintBill', { coupon: 'OFF' }, 'INVALID_STATE', { orderId, expectedVersion: 3 }).message).toMatch(/switched off/);
    expect(h.fail('PrintBill', { coupon: 'OLD' }, 'INVALID_STATE', { orderId, expectedVersion: 3 }).message).toMatch(/ended on 2001-01-31/);
    expect(h.fail('PrintBill', { coupon: 'MIN' }, 'INVALID_STATE', { orderId, expectedVersion: 3 }).message).toMatch(/at least ₹5000\.00/);
    expect(h.count('bill')).toBe(0);
  });

  it('counts a use per bill: printing the same bill again keeps one use; another bill is refused once used up', () => {
    coupon({ code: 'ONCE', kind: 'amount', value: 5_000, maxUses: 1 });
    const first = print(orderId, { coupon: 'ONCE' });
    // items added after the print: the bill is printed again with the same coupon, still one use
    o.run('AddItems', orderId, { items: [line(S.dalMakhani)] });
    o.run('FireKOT', orderId, { all: true });
    const again = print(orderId, { coupon: 'ONCE' });
    expect(again.billId).toBe(first.billId);
    expect(h.count('coupon_use')).toBe(1);
    const other = newOrder();
    expect(h.fail('PrintBill', { coupon: 'ONCE' }, 'INVALID_STATE', { orderId: other, expectedVersion: 3 }).message).toMatch(/used the most times/);
  });

  it('printing again without the coupon gives the use back', () => {
    coupon({ code: 'ONCE', kind: 'amount', value: 5_000, maxUses: 1 });
    print(orderId, { coupon: 'ONCE' });
    o.run('AddItems', orderId, { items: [line(S.dalMakhani)] });
    o.run('FireKOT', orderId, { all: true });
    print(orderId, {});
    expect(h.count('coupon_use')).toBe(0);
    expect(print(newOrder(), { coupon: 'ONCE' }).totalPaise).toBeGreaterThan(0);
  });

  it('VALIDATION for a coupon and a discount together; a used coupon keeps its code', () => {
    const c = coupon({ code: 'SAVE10' });
    h.fail('PrintBill', { coupon: 'SAVE10', discount: { kind: 'pct', value: 500, reason: 'x' } }, 'VALIDATION', { orderId, expectedVersion: 3 });
    print(orderId, { coupon: 'SAVE10' });
    expect(h.fail('UpsertCoupon', { couponId: c.id, code: 'SAVE20', kind: 'pct', value: 2000 }, 'INVALID_STATE').message).toMatch(/cannot change/);
    expect((h.run('UpsertCoupon', { couponId: c.id, code: 'SAVE10', kind: 'pct', value: 2000 }).result as CouponResult).coupon.uses).toBe(1);
  });
});
