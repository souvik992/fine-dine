// Payload schemas for the admin (setup) commands in docs/03-command-api.md "Admin endpoints".
// Each command upserts one record by its id; the id is a ULID made by the client or the seed.
import { z } from 'zod';
import { ulidSchema } from '../envelope.js';

const name = z.string().trim().min(1).max(80);
const sort = z.number().int().min(0).max(1_000_000).default(0);
const paise = z.number().int().min(0).max(100_000_000_000);
/** GST rates in basis points: 0% to 28%. */
const taxRateBp = z.number().int().min(0).max(2800);

export const upsertAreaSchema = z
  .object({
    id: ulidSchema,
    name,
    sort,
    priceListId: ulidSchema.nullable().default(null),
    taxProfileId: ulidSchema.nullable().default(null),
  })
  .strict();

export const upsertTableSchema = z
  .object({
    id: ulidSchema,
    areaId: ulidSchema,
    label: z.string().trim().min(1).max(12),
    seats: z.number().int().min(1).max(100).nullable().default(null),
    layoutX: z.number().int().min(0).max(10_000).nullable().default(null),
    layoutY: z.number().int().min(0).max(10_000).nullable().default(null),
    status: z.enum(['active', 'reserved', 'blocked']).default('active'),
  })
  .strict();

export const upsertPrinterSchema = z
  .object({
    id: ulidSchema,
    name,
    transport: z.enum(['tcp', 'usb', 'fake']),
    host: z.string().trim().min(1).max(253).nullable().default(null),
    port: z.number().int().min(1).max(65_535).default(9100),
    windowsName: z.string().trim().min(1).max(200).nullable().default(null),
    widthMm: z.union([z.literal(58), z.literal(80)]).default(80),
    bitmapText: z.boolean().default(false),
    copies: z.number().int().min(1).max(5).default(1),
    cutter: z.boolean().default(true),
    backupPrinterId: ulidSchema.nullable().default(null),
    role: z.enum(['kot', 'bill', 'both']).default('kot'),
  })
  .strict()
  .refine((p) => p.transport !== 'tcp' || p.host !== null, { message: 'a TCP printer needs host', path: ['host'] })
  .refine((p) => p.transport !== 'usb' || p.windowsName !== null, {
    message: 'a USB printer needs windowsName',
    path: ['windowsName'],
  })
  .refine((p) => p.backupPrinterId !== p.id, { message: 'a printer cannot back itself up', path: ['backupPrinterId'] });

export const upsertStationSchema = z
  .object({
    id: ulidSchema,
    name,
    hasKds: z.boolean().default(false),
    /** Replaces the station's printer links. */
    printerIds: z.array(ulidSchema).max(10).default([]),
  })
  .strict();

export const upsertCategorySchema = z
  .object({
    id: ulidSchema,
    name,
    parentId: ulidSchema.nullable().default(null),
    stationId: ulidSchema.nullable().default(null),
    sort,
  })
  .strict()
  .refine((c) => c.parentId !== c.id, { message: 'a category cannot be its own parent', path: ['parentId'] });

export const upsertAddonGroupSchema = z
  .object({
    id: ulidSchema,
    name,
    minSelect: z.number().int().min(0).max(20).default(0),
    maxSelect: z.number().int().min(1).max(20).default(1),
    /** Upserted by id; addons left out are kept (never deleted). */
    addons: z.array(z.object({ id: ulidSchema, name, pricePaise: paise }).strict()).max(50).default([]),
  })
  .strict()
  .refine((g) => g.minSelect <= g.maxSelect, { message: 'minSelect cannot exceed maxSelect', path: ['minSelect'] });

export const upsertMenuItemSchema = z
  .object({
    id: ulidSchema,
    categoryId: ulidSchema,
    name,
    shortCode: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{1,8}$/, 'letters and digits, up to 8')
      .transform((s) => s.toUpperCase())
      .nullable()
      .default(null),
    veg: z.boolean(),
    basePricePaise: paise,
    taxRateBp,
    hsnSac: z.string().trim().regex(/^\d{4,8}$/, '4 to 8 digits').nullable().default(null),
    stationId: ulidSchema.nullable().default(null),
    available: z.boolean().default(true),
    active: z.boolean().default(true),
    sort,
    /** Upserted by id; variants left out are kept (never deleted). */
    variants: z.array(z.object({ id: ulidSchema, name, pricePaise: paise, sort }).strict()).max(20).default([]),
    /** Replaces the item's addon-group links. */
    addonGroupIds: z.array(ulidSchema).max(10).default([]),
  })
  .strict();

export type UpsertAreaPayload = z.infer<typeof upsertAreaSchema>;
export type UpsertTablePayload = z.infer<typeof upsertTableSchema>;
/** P6-03: a print agent. The terminal makes the key, shows it once and sends only its hash (sha256 of 'agent:' + key). */
export const createPrintAgentSchema = z
  .object({ id: ulidSchema, name: z.string().trim().min(1).max(40), keyHash: z.string().regex(/^[0-9a-f]{64}$/, 'must be a SHA-256 hash') })
  .strict();
export const revokePrintAgentSchema = z.object({ agentId: ulidSchema }).strict();
/** Which agent prints this printer's tickets; null: the server prints them itself. */
export const setPrinterAgentSchema = z.object({ printerId: ulidSchema, agentId: ulidSchema.nullable() }).strict();

export type UpsertPrinterPayload = z.infer<typeof upsertPrinterSchema>;
export type UpsertStationPayload = z.infer<typeof upsertStationSchema>;
export type UpsertCategoryPayload = z.infer<typeof upsertCategorySchema>;
export type UpsertAddonGroupPayload = z.infer<typeof upsertAddonGroupSchema>;
export type UpsertMenuItemPayload = z.infer<typeof upsertMenuItemSchema>;
