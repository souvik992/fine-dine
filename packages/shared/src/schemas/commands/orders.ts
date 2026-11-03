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
    /** P4-04: seat a walk-in on a table held for a booking anyway (the person was told whose booking it is). */
    ignoreReservation: z.boolean().default(false),
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

/** Guests at the table (P3-02). Only while the order is open: the printed bill shows them. */
export const setCoversSchema = z.object({ covers: z.number().int().min(1).max(99) }).strict();

/** P3-04: the captain looking after this order (null = nobody). */
export const assignCaptainSchema = z.object({ captainId: ulidSchema.nullable() }).strict();
/** P3-04: a captain asks the counter for this table's bill. */
export const requestBillSchema = z.object({}).strict();

/** Exactly one selector: specific held items, one course, or everything held. */
export const fireKotSchema = z.union([
  z.object({ itemIds: z.array(ulidSchema).min(1).max(200) }).strict(),
  z.object({ course }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);

// ---- after the KOT (P2-04): every change is a slip to the kitchen, audited with a reason, and a leakage flag ----

const reason = z.string().trim().min(1).max(120);
/** "Not prepared": what the removed portions would have used goes back to stock (ADR-0003). */
const returnToStock = z.boolean().default(false);

/** Reduce a fired line. To add more, add the item again and fire it. */
export const modifyFiredItemSchema = z.object({ orderItemId: ulidSchema, newQty: qty, reason, returnToStock }).strict();
export const cancelFiredItemSchema = z.object({ orderItemId: ulidSchema, reason, returnToStock }).strict();
export const reprintKotSchema = z.object({ kotId: ulidSchema }).strict();
/** P4-02 kitchen display: bump a ticket to ready, to served, or back (recall). */
export const kotStatusSchema = z.object({ kotId: ulidSchema }).strict();
export const reprintBillSchema = z.object({ billId: ulidSchema }).strict();

// ---- tables (P2-03): the order moves, never its KOT history ----

/** On the order being moved: to a free table. */
export const moveTableSchema = z.object({ toTableId: ulidSchema }).strict();
/** On the order that stays: the other table's order joins it and that table is freed. */
export const mergeTablesSchema = z.object({ sourceOrderId: ulidSchema }).strict();
/** On the order the lines leave: whole lines (held or sent) go to another open order. */
export const transferItemsSchema = z
  .object({ itemIds: z.array(ulidSchema).min(1).max(200), toOrderId: ulidSchema })
  .strict()
  .refine((p) => new Set(p.itemIds).size === p.itemIds.length, { message: 'an item appears twice', path: ['itemIds'] });

export type OpenTablePayload = z.infer<typeof openTableSchema>;
export type AddItemsPayload = z.infer<typeof addItemsSchema>;
export type UpdateHeldItemPayload = z.infer<typeof updateHeldItemSchema>;
export type RemoveHeldItemPayload = z.infer<typeof removeHeldItemSchema>;
export type SetCoversPayload = z.infer<typeof setCoversSchema>;
export type FireKotPayload = z.infer<typeof fireKotSchema>;
