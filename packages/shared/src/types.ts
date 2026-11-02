// Wire types shared by the server and every client (docs/03-command-api.md).

export const ERROR_CODES = [
  'VALIDATION',
  'UNAUTHENTICATED',
  'PIN_REQUIRED',
  'LICENSE',
  'FORBIDDEN',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'INVALID_STATE',
  'DAY_CLOSED',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type OrderState = 'open' | 'billed' | 'settled' | 'void' | 'merged';
export type OrderType = 'dine_in' | 'takeaway' | 'delivery' | 'online';
export type OrderItemStatus = 'held' | 'fired' | 'cancelled';

export interface OrderItemAddonSnapshot {
  addonId: string;
  name: string;
  qty: number;
  pricePaise: number;
}

export interface OrderItemSnapshot {
  id: string;
  itemId: string;
  variantId?: string;
  name: string;
  qty: number;
  unitPricePaise: number;
  taxRateBp: number;
  addons: OrderItemAddonSnapshot[];
  note?: string;
  course: number;
  stationId?: string;
  status: OrderItemStatus;
  kotId?: string;
  kotNo?: number;
}

export interface KotSnapshot {
  id: string;
  kotNo: number;
  stationId: string;
  kind: 'new' | 'modify' | 'cancel' | 'move_notice';
  firedAt: string;
  readyAt?: string;
  servedAt?: string;
}

export interface BillSnapshot {
  id: string;
  billNo?: number;
  fy: string;
  splitNo: number;
  totalPaise: number;
  state: 'printed' | 'superseded' | 'settled' | 'void';
  paidPaise: number;
}

export interface OrderSnapshot {
  id: string;
  version: number;
  state: OrderState;
  type: OrderType;
  businessDate: string;
  table?: { id: string; label: string; areaId: string };
  covers: number;
  captainId?: string;
  openedAt: string;
  lastKotAt?: string;
  billPrintedAt?: string;
  items: OrderItemSnapshot[];
  kots: KotSnapshot[];
  bills: BillSnapshot[];
  /** Running totals of non-cancelled items, before discount/service charge/round-off. */
  totals: { subtotalPaise: number; taxPaise: number; totalPaise: number };
}

export interface CommandSuccess<R = unknown> {
  ok: true;
  commandId: string;
  /** True when this is a replay of an already processed commandId (code DUPLICATE). */
  duplicate?: true;
  order?: OrderSnapshot;
  version?: number;
  result: R;
}

export interface CommandFailure {
  ok: false;
  error: { code: ErrorCode; message: string; details?: unknown };
  order?: OrderSnapshot;
}

export type CommandResponse<R = unknown> = CommandSuccess<R> | CommandFailure;
