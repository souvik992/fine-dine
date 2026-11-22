// Coupons and offers (as quickPOS, product owner 2026-11-22). The owner makes codes in Settings › Coupons / Offers; a
// cashier types one in the bill dialog. A coupon becomes the bill discount (an amount), so GST is worked out exactly as
// for a manual discount: before tax, shared out to the lines (docs/08). It needs no manager PIN: the owner approved it
// when making it. Checked when the bill is printed: switched on, dates (business date), minimum bill, number of uses.
import { z } from 'zod';
import { mulDivRound } from './money.js';
import { ulidSchema } from './schemas/envelope.js';

export const COUPON_CODE_RE = /^[A-Z0-9-]{3,20}$/;
const MAX_PAISE = 10_000_000_00; // ₹1 crore
const day = z.iso.date();

export const couponCodeSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(COUPON_CODE_RE, 'a coupon code is 3 to 20 letters, numbers or dashes (for example SAVE10)'));

export const upsertCouponSchema = z
  .object({
    /** Absent: a new coupon. */
    couponId: ulidSchema.optional(),
    code: couponCodeSchema,
    description: z.string().trim().max(80).nullable().default(null),
    /** pct: basis points (1000 = 10%); amount: paise. */
    kind: z.enum(['pct', 'amount']),
    value: z.number().int().min(1).max(MAX_PAISE),
    /** A percent coupon's most it takes off, in paise (null = no limit). */
    maxDiscountPaise: z.number().int().min(1).max(MAX_PAISE).nullable().default(null),
    /** The bill total before the coupon must be at least this (0 = any bill). */
    minBillPaise: z.number().int().min(0).max(MAX_PAISE).default(0),
    validFrom: day.nullable().default(null),
    validTo: day.nullable().default(null),
    /** Bills it can be used on (null = no limit); a void bill gives its use back. */
    maxUses: z.number().int().min(1).max(1_000_000).nullable().default(null),
    active: z.boolean().default(true),
  })
  .strict()
  .refine((c) => c.kind !== 'pct' || c.value <= 10_000, { message: 'a percent coupon can take off at most 100%', path: ['value'] })
  .refine((c) => !c.validFrom || !c.validTo || c.validFrom <= c.validTo, { message: 'the end date is before the start date', path: ['validTo'] })
  .transform((c) => ({ ...c, description: c.description || null, maxDiscountPaise: c.kind === 'pct' ? c.maxDiscountPaise : null }));
export type UpsertCoupon = z.infer<typeof upsertCouponSchema>;

export type CouponStatus = 'active' | 'off' | 'not_started' | 'expired' | 'used_up';

export interface CouponView {
  id: string;
  code: string;
  description: string | null;
  kind: 'pct' | 'amount';
  value: number;
  maxDiscountPaise: number | null;
  minBillPaise: number;
  validFrom: string | null;
  validTo: string | null;
  maxUses: number | null;
  active: boolean;
  /** Bills it is on that are not void. */
  uses: number;
  /** Today (business date): 'active' or why it cannot be used. */
  status: CouponStatus;
}

type CouponRule = Pick<CouponView, 'code' | 'kind' | 'value' | 'maxDiscountPaise' | 'minBillPaise' | 'validFrom' | 'validTo' | 'maxUses' | 'active'>;

export function couponStatus(c: CouponRule, uses: number, today: string): CouponStatus {
  if (!c.active) return 'off';
  if (c.validFrom && today < c.validFrom) return 'not_started';
  if (c.validTo && today > c.validTo) return 'expired';
  if (c.maxUses !== null && uses >= c.maxUses) return 'used_up';
  return 'active';
}

const rupees = (p: number) => `₹${(p / 100).toFixed(2)}`;

/** Why this coupon cannot go on a bill of this total (before the coupon) today, or null when it can. */
export function couponProblem(c: CouponRule, uses: number, today: string, billTotalPaise: number): string | null {
  const s = couponStatus(c, uses, today);
  if (s === 'off') return `Coupon ${c.code} is switched off.`;
  if (s === 'not_started') return `Coupon ${c.code} starts on ${c.validFrom}.`;
  if (s === 'expired') return `Coupon ${c.code} ended on ${c.validTo}.`;
  if (s === 'used_up') return `Coupon ${c.code} has been used the most times allowed.`;
  if (billTotalPaise < c.minBillPaise) return `Coupon ${c.code} needs a bill of at least ${rupees(c.minBillPaise)}.`;
  return null;
}

/**
 * What the coupon takes off a bill whose items come to `subtotalPaise` (before GST): a percent of it (half up), at most
 * its cap, never more than the subtotal.
 */
export function couponOff(c: Pick<CouponRule, 'kind' | 'value' | 'maxDiscountPaise'>, subtotalPaise: number): number {
  let off = c.kind === 'pct' ? mulDivRound(subtotalPaise, c.value, 10_000) : c.value;
  if (c.kind === 'pct' && c.maxDiscountPaise !== null) off = Math.min(off, c.maxDiscountPaise);
  return Math.max(0, Math.min(off, subtotalPaise));
}

/** "10% off, up to ₹100.00" / "₹50.00 off". */
export const couponOffText = (c: Pick<CouponRule, 'kind' | 'value' | 'maxDiscountPaise'>) =>
  c.kind === 'pct' ? `${c.value / 100}% off${c.maxDiscountPaise ? `, up to ${rupees(c.maxDiscountPaise)}` : ''}` : `${rupees(c.value)} off`;
