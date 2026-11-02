// Payload schemas for inventory and menu-availability commands (docs/03-command-api.md "Stock commands").
import { z } from 'zod';
import { gstinProblem } from '../../gstin.js';
import { MAX_QTY_MILLI, STOCK_UNITS } from '../../stock.js';
import { ulidSchema } from '../envelope.js';

const name = z.string().trim().min(1).max(80);
const reason = z.string().trim().min(1).max(200);
/** Thousandths of the material's unit. */
const qty = z.number().int().min(1).max(MAX_QTY_MILLI);
/** Paise per whole unit; ₹10 crore at most. */
const unitCost = z.number().int().min(0).max(1_000_000_000);

export const upsertStockItemSchema = z
  .object({
    id: ulidSchema,
    name,
    /** Fixed once the material exists. */
    unit: z.enum(STOCK_UNITS),
    reorderLevelMilli: z.number().int().min(0).max(MAX_QTY_MILLI).default(0),
    active: z.boolean().default(true),
    /** Only used when the material is created. */
    opening: z.object({ qtyMilli: qty, unitCostPaise: unitCost.nullable().default(null) }).strict().nullable().default(null),
  })
  .strict();

export const adjustStockSchema = z.discriminatedUnion('kind', [
  /** Spoiled, spilled or thrown away: removes `qtyMilli`. */
  z.object({ kind: z.literal('wastage'), stockItemId: ulidSchema, qtyMilli: qty, reason }).strict(),
  /** Physical count: sets the balance to `qtyMilli`. */
  z.object({ kind: z.literal('count'), stockItemId: ulidSchema, qtyMilli: z.number().int().min(0).max(MAX_QTY_MILLI), reason: reason.nullable().default(null) }).strict(),
  /** Correction: adds (positive) or removes (negative) `qtyMilli`. */
  z
    .object({ kind: z.literal('adjust'), stockItemId: ulidSchema, qtyMilli: z.number().int().min(-MAX_QTY_MILLI).max(MAX_QTY_MILLI), reason })
    .strict()
    .refine((a) => a.qtyMilli !== 0, { message: 'a correction cannot be zero', path: ['qtyMilli'] }),
]);

export const recordPurchaseSchema = z
  .object({
    id: ulidSchema,
    supplierName: name,
    supplierGstin: z
      .string()
      .trim()
      .transform((s) => s.toUpperCase())
      .superRefine((g, ctx) => {
        const problem = gstinProblem(g);
        if (problem) ctx.addIssue({ code: 'custom', message: problem });
      })
      .nullable()
      .default(null),
    invoiceNo: z.string().trim().min(1).max(40).nullable().default(null),
    invoiceDate: z.iso.date().nullable().default(null),
    note: z.string().trim().min(1).max(200).nullable().default(null),
    lines: z
      .array(z.object({ stockItemId: ulidSchema, qtyMilli: qty, unitCostPaise: unitCost }).strict())
      .min(1)
      .max(200)
      .refine((ls) => new Set(ls.map((l) => l.stockItemId)).size === ls.length, { message: 'a material appears twice; combine the lines' }),
  })
  .strict();

export const voidPurchaseSchema = z.object({ purchaseId: ulidSchema, reason }).strict();

/** What a recipe belongs to: a menu item (per unit sold), one of its variants (replaces the item's), or an add-on. */
export const RECIPE_OWNERS = ['item', 'variant', 'addon'] as const;
export type RecipeOwner = (typeof RECIPE_OWNERS)[number];

export const setRecipeSchema = z
  .object({
    ownerKind: z.enum(RECIPE_OWNERS),
    ownerId: ulidSchema,
    /** Replaces the whole recipe; an empty list removes it. Quantities are per one unit sold. */
    lines: z
      .array(z.object({ stockItemId: ulidSchema, qtyMilli: qty }).strict())
      .max(50)
      .refine((ls) => new Set(ls.map((l) => l.stockItemId)).size === ls.length, { message: 'an ingredient appears twice' }),
  })
  .strict();

export const setItemAvailabilitySchema = z.object({ itemId: ulidSchema, available: z.boolean() }).strict();

export type UpsertStockItemPayload = z.infer<typeof upsertStockItemSchema>;
export type AdjustStockPayload = z.infer<typeof adjustStockSchema>;
export type RecordPurchasePayload = z.infer<typeof recordPurchaseSchema>;
export type VoidPurchasePayload = z.infer<typeof voidPurchaseSchema>;
export type SetRecipePayload = z.infer<typeof setRecipeSchema>;
