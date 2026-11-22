import { couponCodeSchema } from '@dinepos/shared';
import type { FastifyInstance } from 'fastify';
import { requireRight } from '../auth/require-right.js';
import { PosError } from '../core/errors.js';
import type { Db } from '../db/connection.js';
import { couponToday, findCoupon, listCoupons } from '../queries/coupons.js';

/** Coupon reads (docs/03 "Coupons"). Writes are the UpsertCoupon command. */
export function couponRoutes(app: FastifyInstance, deps: { db: Db; now: () => Date; timeZone: string }): void {
  const { db, now, timeZone } = deps;
  const noStore = { 'cache-control': 'no-store' };

  // Settings › Coupons / Offers: every coupon with its uses and today's status
  app.get('/v1/coupons', (req, reply) => {
    requireRight(db, req, 'admin', now());
    return reply.headers(noStore).send({ coupons: listCoupons(db, couponToday(db, now(), timeZone)) });
  });

  // The bill dialog: what a typed code takes off (for the preview)
  app.get<{ Params: { code: string } }>('/v1/coupons/:code', (req, reply) => {
    requireRight(db, req, 'bill.print', now());
    const code = couponCodeSchema.safeParse(req.params.code);
    if (!code.success) throw new PosError('VALIDATION', 'A coupon code is 3 to 20 letters, numbers or dashes.');
    const coupon = findCoupon(db, code.data, couponToday(db, now(), timeZone));
    if (!coupon) throw new PosError('NOT_FOUND', 'No coupon with this code. Check the spelling.', { code: code.data });
    return reply.headers(noStore).send({ coupon, today: couponToday(db, now(), timeZone) });
  });
}
