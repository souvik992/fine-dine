import { newId, upsertCouponSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { couponUses, couponView, type CouponRow } from './coupon-support.js';

/**
 * Settings › Coupons / Offers (as quickPOS): add or change a coupon. Owner / admin only, since a coupon gives money away
 * without a manager PIN. A coupon already used keeps its code (bills and reports name it): switch it off and add a new
 * one. Changes apply to bills printed from now on.
 */
export const upsertCoupon = defineCommand({
  type: 'UpsertCoupon',
  schema: upsertCouponSchema,
  right: 'admin',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    const { db } = ctx;
    const old = p.couponId ? (db.prepare('SELECT * FROM coupon WHERE id = ?').get(p.couponId) as CouponRow | undefined) : undefined;
    if (p.couponId && !old) throw new PosError('NOT_FOUND', 'Coupon not found.', { couponId: p.couponId });
    const id = old?.id ?? newId();
    const clash = db.prepare('SELECT id FROM coupon WHERE code = ? AND id <> ?').pluck().get(p.code, id);
    if (clash) throw new PosError('INVALID_STATE', `There is already a coupon ${p.code}.`, { code: p.code });
    if (old && old.code !== p.code && couponUses(db, id) > 0) {
      throw new PosError('INVALID_STATE', `Coupon ${old.code} has been used, so its code cannot change. Switch it off and add a new one.`, { code: old.code });
    }
    const values = [p.code, p.description, p.kind, p.value, p.maxDiscountPaise, p.minBillPaise, p.validFrom, p.validTo, p.maxUses, p.active ? 1 : 0, ctx.nowIso];
    if (old) {
      db.prepare(
        `UPDATE coupon SET code = ?, description = ?, kind = ?, value = ?, max_discount_paise = ?, min_bill_paise = ?, valid_from = ?, valid_to = ?,
                max_uses = ?, active = ?, updated_at = ? WHERE id = ?`,
      ).run(...values, id);
    } else {
      db.prepare(
        `INSERT INTO coupon (code, description, kind, value, max_discount_paise, min_bill_paise, valid_from, valid_to, max_uses, active, updated_at, created_at, id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(...values, ctx.nowIso, id);
    }
    const { couponId: _omit, ...after } = p;
    ctx.audit({ entity: 'coupon', entityId: id, action: old ? 'coupon.update' : 'coupon.create', ...(old ? { before: old } : {}), after });
    ctx.emit('system', 'coupon.changed', { couponId: id });
    const row = db.prepare('SELECT * FROM coupon WHERE id = ?').get(id) as CouponRow;
    return { result: { coupon: couponView(db, row, ctx.businessDate), created: !old } };
  },
});
