import { couponStatus, type CouponView } from '@dinepos/shared';
import type { Db } from '../db/connection.js';

export interface CouponRow {
  id: string;
  code: string;
  description: string | null;
  kind: 'pct' | 'amount';
  value: number;
  max_discount_paise: number | null;
  min_bill_paise: number;
  valid_from: string | null;
  valid_to: string | null;
  max_uses: number | null;
  active: number;
}

/** Bills the coupon is on that are not void (a void bill gives its use back). `exceptBillId`: the bill being printed again. */
export function couponUses(db: Db, couponId: string, exceptBillId: string | null = null): number {
  return db
    .prepare(`SELECT COUNT(*) FROM coupon_use u JOIN bill b ON b.id = u.bill_id WHERE u.coupon_id = ? AND b.state <> 'void' AND u.bill_id IS NOT ?`)
    .pluck()
    .get(couponId, exceptBillId) as number;
}

export const couponByCode = (db: Db, code: string) => db.prepare('SELECT * FROM coupon WHERE code = ?').get(code) as CouponRow | undefined;

/** The row as the shared rules see it. */
export function couponRule(c: CouponRow) {
  return {
    code: c.code,
    kind: c.kind,
    value: c.value,
    maxDiscountPaise: c.max_discount_paise,
    minBillPaise: c.min_bill_paise,
    validFrom: c.valid_from,
    validTo: c.valid_to,
    maxUses: c.max_uses,
    active: c.active === 1,
  };
}

export function couponView(db: Db, c: CouponRow, today: string): CouponView {
  const uses = couponUses(db, c.id);
  const rule = couponRule(c);
  return { id: c.id, description: c.description, ...rule, uses, status: couponStatus(rule, uses, today) };
}
