// Payload schemas for the order commands in docs/03-command-api.md (OpenTable … FireKOT).
import { z } from 'zod';
import { ulidSchema } from '../envelope.js';

const qty = z.number().int().min(1).max(999);
const course = z.number().int().min(1).max(9);
const note = z.string().trim().min(1).max(140);

export const orderAddonSchema = z.object({ addonId: ulidSchema, qty: z.number().int().min(1).max(20).default(1) }).strict();

export const openTableSchema = z
  .object({
    tableId: ulidSchema,
    covers: z.number().int().min(1).max(99),
    captainId: ulidSchema.nullable().default(null),
    /** Client-made id (offline OpenTable, docs/05); the server makes one when omitted. */
    orderId: ulidSchema.optional(),
  })
  .strict();

export const addItemsSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            /** Client-made order_item id. */
            id: ulidSchema,
            itemId: ulidSchema,
            variantId: ulidSchema.nullable().default(null),
            qty,
            addons: z.array(orderAddonSchema).max(20).default([]),
            note: note.nullable().default(null),
            course: course.default(1),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine((p) => new Set(p.items.map((i) => i.id)).size === p.items.length, { message: 'item ids must be unique', path: ['items'] });

export const updateHeldItemSchema = z
  .object({
    orderItemId: ulidSchema,
    qty: qty.optional(),
    note: note.nullable().optional(),
    course: course.optional(),
    addons: z.array(orderAddonSchema).max(20).optional(),
  })
  .strict()
  .refine((p) => p.qty !== undefined || p.note !== undefined || p.course !== undefined || p.addons !== undefined, {
    message: 'nothing to change',
  });

export const removeHeldItemSchema = z.object({ orderItemId: ulidSchema }).strict();

/** Exactly one selector: specific held items, one course, or everything held. */
export const fireKotSchema = z.union([
  z.object({ itemIds: z.array(ulidSchema).min(1).max(200) }).strict(),
  z.object({ course }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);

export type OpenTablePayload = z.infer<typeof openTableSchema>;
export type AddItemsPayload = z.infer<typeof addItemsSchema>;
export type UpdateHeldItemPayload = z.infer<typeof updateHeldItemSchema>;
export type RemoveHeldItemPayload = z.infer<typeof removeHeldItemSchema>;
export type FireKotPayload = z.infer<typeof fireKotSchema>;
