import { z } from 'zod';
import { ULID_RE } from '../ids.js';

export const ulidSchema = z.string().regex(ULID_RE, 'must be a ULID');

/** `POST /v1/commands` body (docs/03-command-api.md). The payload is checked against the command's own schema. */
export const commandEnvelopeSchema = z
  .object({
    commandId: ulidSchema,
    type: z.string().regex(/^[A-Z][A-Za-z0-9]{1,63}$/, 'must be a command name such as FireKOT'),
    orderId: ulidSchema.optional(),
    expectedVersion: z.number().int().positive().optional(),
    payload: z.unknown().default({}),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine((e) => (e.orderId === undefined) === (e.expectedVersion === undefined), {
    message: 'orderId and expectedVersion go together',
    path: ['expectedVersion'],
  });

export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;
