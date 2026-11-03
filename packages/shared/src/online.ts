// Online orders through the order hub (P4-06). The hub's contract v1 lives in pos-backend/contract; these are the
// parts DinePOS uses, copied as they are there (field names, states, paise, ms since epoch). Never rename: v1 only adds.
import { z } from 'zod';

export const HUB_ORDER_STATES = [
  'PLACED', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'SENT_TO_STORE', 'RECEIVED',
  'ACCEPTED', 'REJECTED', 'AUTO_REJECTED', 'PREPARING', 'READY',
  'OUT_FOR_DELIVERY', 'DELIVERED', 'PICKED_UP', 'CANCELLED',
] as const;
export type HubOrderState = (typeof HUB_ORDER_STATES)[number];
export const HUB_TERMINAL: readonly HubOrderState[] = ['REJECTED', 'AUTO_REJECTED', 'CANCELLED', 'DELIVERED', 'PICKED_UP'];

export const REJECT_REASONS = ['ITEM_UNAVAILABLE', 'TOO_BUSY', 'CLOSING', 'OUT_OF_DELIVERY_AREA', 'OTHER'] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export interface HubOrderLine {
  itemId: string;
  name: string;
  qtyMilli: number;
  unitPrice: number;
  modifiers: Array<{ id: string; name: string; price: number }>;
  note: string | null;
  lineTotal: number;
}

/** An order as the hub sends it (contract `Order`; Swiggy/Zomato fields not used here). */
export interface HubOrder {
  id: string;
  number: string;
  storeId: string;
  channel: 'app' | 'website' | 'swiggy' | 'zomato';
  state: HubOrderState;
  fulfilment: 'PICKUP' | 'DELIVERY';
  payment: 'ONLINE' | 'COD';
  paid: boolean;
  customer: { name: string | null; mobile: string; verified: boolean };
  address: { line1: string; line2: string | null; landmark: string | null; city: string; pincode: string } | null;
  lines: HubOrderLine[];
  note: string | null;
  itemsTotal: number;
  deliveryFee: number;
  packagingFee: number;
  total: number;
  distanceKm: number | null;
  location: { lat: number; lng: number } | null;
  prepMinutes: number | null;
  etaAt: number | null;
  menuVersion: number;
  placedAt: number;
  acceptBy: number | null;
  rider: { name: string; phone: string | null } | null;
  posBillNo: string | null;
  rejectReason: RejectReason | null;
  reasonText: string | null;
}

/** Events down the POS's stream (contract `PosEvent`; rider/notice events are for Swiggy/Zomato and are ignored). */
export type HubEvent =
  | { seq: number; type: 'order.created'; at: number; order: HubOrder }
  | { seq: number; type: 'order.cancelled'; at: number; orderId: string; by: 'customer' | 'aggregator'; reasonText: string | null }
  | { seq: number; type: 'order.auto_rejected'; at: number; orderId: string }
  | { seq: number; type: 'order.updated'; at: number; orderId: string; state: HubOrderState; by: 'pos' | 'aggregator' }
  | { seq: number; type: 'order.rider' | 'order.notice'; at: number; orderId: string };

// ---------------------------------------------------------------- settings

const paise = z.number().int().min(0).max(10_000_00);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'a time like 10:00');
const slots = z.array(z.object({ open: time, close: time }).strict()).max(2);

/** Where the store delivers, what it charges and when it is open (contract `ServiceabilityConfig`; the hub checks it too). */
export const serviceabilitySchema = z
  .object({
    location: z.object({ lat: z.number().min(6).max(38), lng: z.number().min(68).max(98), label: z.string().max(200) }).strict().nullable(),
    zones: z
      .array(
        z
          .object({ upToKm: z.number().positive().max(25), deliveryFee: paise, minOrder: paise, freeDeliveryAbove: paise.nullable(), etaMinutes: z.number().int().min(5).max(240) })
          .strict(),
      )
      .max(6),
    packagingFee: z.number().int().min(0).max(500_00),
    pickup: z.object({ minOrder: paise, etaMinutes: z.number().int().min(5).max(240) }).strict(),
    hours: z.object({ 0: slots, 1: slots, 2: slots, 3: slots, 4: slots, 5: slots, 6: slots }).strict(),
    roadFactor: z.number().min(1).max(2).default(1.3),
  })
  .strict()
  .refine((s) => s.zones.every((z, i) => i === 0 || z.upToKm > s.zones[i - 1]!.upToKm), { message: 'distance bands must go up', path: ['zones'] });
export type Serviceability = z.infer<typeof serviceabilitySchema>;

const everyDay = (open: string, close: string) => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [{ open, close }]])) as Serviceability['hours'];
export const DEFAULT_SERVICEABILITY: Serviceability = {
  location: null,
  zones: [
    { upToKm: 3, deliveryFee: 2000, minOrder: 10000, freeDeliveryAbove: 50000, etaMinutes: 35 },
    { upToKm: 6, deliveryFee: 4000, minOrder: 20000, freeDeliveryAbove: null, etaMinutes: 50 },
  ],
  packagingFee: 0,
  pickup: { minOrder: 0, etaMinutes: 25 },
  hours: everyDay('12:00', '23:00'),
  roadFactor: 1.3,
};

/** Online-order settings (Settings › Online orders); stored in `config` like the other outlet settings. */
export const onlineSettingsSchema = z
  .object({
    enabled: z.boolean(),
    acceptMode: z.enum(['manual', 'auto']),
    acceptTimeoutMin: z.number().int().min(2).max(15),
    channels: z.object({ app: z.boolean(), website: z.boolean() }).strict(),
    fulfilment: z.object({ pickup: z.boolean(), delivery: z.boolean() }).strict(),
    payments: z.object({ online: z.boolean(), cod: z.boolean() }).strict(),
    /** GST on delivery and packaging charges (basis points). Null: no fees can be charged (the hub refuses them). */
    feeTaxBp: z.number().int().min(0).max(2800).nullable(),
    /** Kitchen time used when accepting without changing it. */
    prepMinutes: z.number().int().min(1).max(180),
    serviceability: serviceabilitySchema,
  })
  .strict();
export type OnlineSettings = z.infer<typeof onlineSettingsSchema>;

export const DEFAULT_ONLINE_SETTINGS: OnlineSettings = {
  enabled: false,
  acceptMode: 'manual',
  acceptTimeoutMin: 5,
  channels: { app: true, website: true },
  fulfilment: { pickup: true, delivery: false },
  payments: { online: true, cod: true },
  feeTaxBp: null,
  prepMinutes: 20,
  serviceability: DEFAULT_SERVICEABILITY,
};

/** `GET /v1/online` for Settings and the Online orders screen. */
export interface OnlineStatus {
  paired: boolean;
  hubUrl: string | null;
  store: { slug: string; name: string } | null;
  connection: 'off' | 'not-paired' | 'connecting' | 'connected' | 'retrying';
  lastError: string | null;
  lastEventAt: string | null;
  /** Taking orders now (online on, paired, a business day open). */
  accepting: boolean;
  pendingActions: number;
  menuVersion: number;
}

/** An online order as the terminals show it. */
export interface OnlineOrderView {
  id: string;
  number: string;
  state: HubOrderState;
  order: HubOrder;
  receivedAt: string;
  localOrderId: string | null;
  billId: string | null;
  billNo: string | null;
  posTotalPaise: number | null;
  prepMinutes: number | null;
  alert: string | null;
}

// ---------------------------------------------------------------- commands

const onlineOrderId = z.string().min(1).max(100);
const reasonText = z.string().trim().min(1).max(200);

/** Staff: accept = KOT + GST bill now (settled as Online when paid online), then the hub is told. */
export const acceptOnlineOrderSchema = z
  .object({ onlineOrderId, prepMinutes: z.number().int().min(1).max(180).optional(), acceptPriceChange: z.boolean().default(false) })
  .strict();
export const rejectOnlineOrderSchema = z.object({ onlineOrderId, reason: z.enum(REJECT_REASONS), reasonText: reasonText.nullable().default(null) }).strict();
/** Staff: move an accepted order on. Out for delivery needs the rider; delivered / picked up settles a cash-on-delivery bill in cash. */
export const advanceOnlineOrderSchema = z
  .object({
    onlineOrderId,
    to: z.enum(['PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'PICKED_UP']),
    rider: z.object({ name: z.string().trim().min(1).max(60), phone: z.string().trim().max(20).nullable().default(null) }).strict().nullable().default(null),
  })
  .strict();
/** Staff: cancel after accepting — the bill is voided (bill.void, with a manager PIN when the role needs one). */
export const cancelOnlineOrderSchema = z.object({ onlineOrderId, reason: reasonText }).strict();

// Internal (the server's hub connector; never accepted over /v1/commands).
export const applyHubEventSchema = z.object({ event: z.record(z.string(), z.unknown()) }).strict();
export const recordOnlinePublishSchema = z.object({ hash: z.string().length(64), version: z.number().int().min(1) }).strict();
export const recordHubActionSchema = z
  .object({ outboxId: z.number().int().min(1), outcome: z.enum(['done', 'failed', 'refused']), message: z.string().max(300).nullable().default(null), state: z.enum(HUB_ORDER_STATES).nullable().default(null) })
  .strict();
export const saveOnlineLinkSchema = z.object({ hubUrl: z.string().url().max(200), deviceKey: z.string().min(10).max(500), storeSlug: z.string().max(80), storeName: z.string().max(120) }).strict();
export const unlinkOnlineHubSchema = z.object({}).strict();
