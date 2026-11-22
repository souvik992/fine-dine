import { localDate, type CouponView } from '@dinepos/shared';
import { currentBusinessDate } from '../core/business-day.js';
import type { Db } from '../db/connection.js';
import { couponByCode, couponView, type CouponRow } from '../commands/coupon-support.js';

/** The date coupons are checked against: the open business date, else today in the outlet's time zone. */
export const couponToday = (db: Db, now: Date, timeZone: string) => currentBusinessDate(db) ?? localDate(now, timeZone);

/** Settings › Coupons / Offers: switched-on coupons first, then by code. */
export function listCoupons(db: Db, today: string): CouponView[] {
  return (db.prepare('SELECT * FROM coupon ORDER BY active DESC, code').all() as CouponRow[]).map((c) => couponView(db, c, today));
}

/** One coupon by its code, for the bill dialog's preview (the server checks it again when the bill is printed). */
export function findCoupon(db: Db, code: string, today: string): CouponView | null {
  const c = couponByCode(db, code);
  return c ? couponView(db, c, today) : null;
}
