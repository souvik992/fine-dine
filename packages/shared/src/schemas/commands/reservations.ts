// Payload schemas for bookings and the waitlist (P4-04).
import { z } from 'zod';
import { ulidSchema } from '../envelope.js';

const guestName = z.string().trim().min(1).max(60);
const phone = z
  .string()
  .trim()
  .regex(/^[+\d][\d\s-]{5,19}$/, 'a phone number of 6 to 20 digits')
  .nullable()
  .default(null);
const partySize = z.number().int().min(1).max(99);
const note = z.string().trim().min(1).max(140).nullable().default(null);
/** An instant with its offset, e.g. 2026-11-03T19:30:00+05:30 (stored as UTC). */
const instant = z.string().datetime({ offset: true });

export const createReservationSchema = z
  .object({
    /** Client-made id (optional). */
    id: ulidSchema.optional(),
    guestName,
    phone,
    partySize,
    startsAt: instant,
    durationMin: z.number().int().min(15).max(480).default(90),
    tableIds: z.array(ulidSchema).max(8).default([]),
    note,
  })
  .strict()
  .refine((p) => new Set(p.tableIds).size === p.tableIds.length, { message: 'a table appears twice', path: ['tableIds'] });

/** Change a booking that is still `booked`; fields left out stay as they are. */
export const updateReservationSchema = z
  .object({
    reservationId: ulidSchema,
    guestName: guestName.optional(),
    phone: phone.optional(),
    partySize: partySize.optional(),
    startsAt: instant.optional(),
    durationMin: z.number().int().min(15).max(480).optional(),
    tableIds: z.array(ulidSchema).max(8).optional(),
    note: note.optional(),
  })
  .strict()
  .refine((p) => !p.tableIds || new Set(p.tableIds).size === p.tableIds.length, { message: 'a table appears twice', path: ['tableIds'] });

export const closeReservationSchema = z.object({ reservationId: ulidSchema, outcome: z.enum(['cancelled', 'no_show']) }).strict();

/** Seat the booking: an order opens on `tableId` (default: its first table). */
export const seatReservationSchema = z
  .object({ reservationId: ulidSchema, tableId: ulidSchema.optional(), covers: partySize.optional(), orderId: ulidSchema.optional() })
  .strict();

export const addToWaitlistSchema = z
  .object({ id: ulidSchema.optional(), guestName, phone, partySize, quotedMin: z.number().int().min(0).max(240).nullable().default(null), note })
  .strict();

export const seatFromWaitlistSchema = z
  .object({ entryId: ulidSchema, tableId: ulidSchema, covers: partySize.optional(), orderId: ulidSchema.optional(), ignoreReservation: z.boolean().default(false) })
  .strict();

export const leaveWaitlistSchema = z.object({ entryId: ulidSchema, outcome: z.enum(['left', 'cancelled']) }).strict();

export type CreateReservationPayload = z.infer<typeof createReservationSchema>;
export type UpdateReservationPayload = z.infer<typeof updateReservationSchema>;
