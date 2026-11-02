// Wire types shared by the server and every client (docs/03-command-api.md).
import type { TableState } from './table-state.js';

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
  /** As printed, e.g. "B/26-27/000123". */
  billNoText?: string;
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

// ---------- floor (GET /v1/floor) ----------

export interface FloorArea {
  id: string;
  name: string;
  sort: number;
}

export interface FloorTable {
  id: string;
  areaId: string;
  label: string;
  seats?: number;
  layoutX?: number;
  layoutY?: number;
  /** Derived with deriveTableState, never stored. */
  state: TableState;
  orderId?: string;
  orderVersion?: number;
  covers?: number;
  captainId?: string;
  /** When the current order was opened. */
  since?: string;
  elapsedMin?: number;
  /** Running total of the open order. */
  amountPaise?: number;
}

export interface FloorSnapshot {
  serverTime: string;
  areas: FloorArea[];
  tables: FloorTable[];
}

// ---------- menu (GET /v1/menu) ----------

export interface MenuStation {
  id: string;
  name: string;
  hasKds: boolean;
}

export interface MenuCategory {
  id: string;
  name: string;
  parentId?: string;
  stationId?: string;
  sort: number;
}

export interface MenuAddon {
  id: string;
  name: string;
  pricePaise: number;
}

export interface MenuAddonGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  addons: MenuAddon[];
}

export interface MenuVariant {
  id: string;
  name: string;
  pricePaise: number;
  sort: number;
}

export interface MenuItem {
  id: string;
  categoryId: string;
  name: string;
  shortCode?: string;
  veg: boolean;
  pricePaise: number;
  taxRateBp: number;
  hsnSac?: string;
  stationId?: string;
  available: boolean;
  sort: number;
  variants: MenuVariant[];
  addonGroupIds: string[];
}

export interface MenuSnapshot {
  menuVersion: number;
  /** Area whose price list was applied, if any. */
  areaId?: string;
  stations: MenuStation[];
  categories: MenuCategory[];
  addonGroups: MenuAddonGroup[];
  items: MenuItem[];
}

/** `GET /v1/menu?since=<menuVersion>` when nothing changed. */
export interface MenuUnchanged {
  menuVersion: number;
  unchanged: true;
}
