import { describe, expect, it } from 'vitest';
import { couponOff, couponOffText, couponProblem, couponStatus, upsertCouponSchema } from './coupons.js';

const pct = { code: 'SAVE10', kind: 'pct' as const, value: 1000, maxDiscountPaise: null, minBillPaise: 0, validFrom: null, validTo: null, maxUses: null, active: true };

describe('coupons', () => {
  it('takes a percent of the subtotal (half up), at most the cap, never more than the bill', () => {
    expect(couponOff(pct, 114_005)).toBe(11_401); // 11,400.5 → 11,401
    expect(couponOff({ ...pct, maxDiscountPaise: 10_000 }, 114_000)).toBe(10_000);
    expect(couponOff({ kind: 'amount', value: 5_000, maxDiscountPaise: null }, 3_000)).toBe(3_000);
  });

  it('is usable only when on, within its dates (inclusive), under its uses and the bill reaches the minimum', () => {
    expect(couponStatus(pct, 0, '2026-11-22')).toBe('active');
    expect(couponStatus({ ...pct, active: false }, 0, '2026-11-22')).toBe('off');
    expect(couponStatus({ ...pct, validFrom: '2026-11-22', validTo: '2026-11-22' }, 0, '2026-11-22')).toBe('active');
    expect(couponStatus({ ...pct, validFrom: '2026-11-23' }, 0, '2026-11-22')).toBe('not_started');
    expect(couponStatus({ ...pct, validTo: '2026-11-21' }, 0, '2026-11-22')).toBe('expired');
    expect(couponStatus({ ...pct, maxUses: 2 }, 2, '2026-11-22')).toBe('used_up');
    expect(couponProblem({ ...pct, minBillPaise: 50_000 }, 0, '2026-11-22', 49_999)).toBe('Coupon SAVE10 needs a bill of at least ₹500.00.');
    expect(couponProblem({ ...pct, minBillPaise: 50_000 }, 0, '2026-11-22', 50_000)).toBeNull();
  });

  it('reads a coupon: code in capitals, the cap only on a percent coupon', () => {
    expect(upsertCouponSchema.parse({ code: ' diwali-25 ', kind: 'amount', value: 2_500, maxDiscountPaise: 100 })).toMatchObject({ code: 'DIWALI-25', maxDiscountPaise: null, description: null, active: true });
    expect(couponOffText({ kind: 'pct', value: 1250, maxDiscountPaise: 10_000 })).toBe('12.5% off, up to ₹100.00');
  });
});
