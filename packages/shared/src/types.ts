// Wire types shared by the server and every client (docs/03-command-api.md).
import type { Right } from './rights.js';
import type { TableState } from './table-state.js';
import type { PricingMode } from './tax.js';
import type { StockUnit } from './stock.js';

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
  /** That area's tax pricing (P3-03: the phone totals waiting lines like the server does). */
  pricingMode?: PricingMode;
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

// ---------- staff and sessions (docs/07) ----------

/** One person on the sign-in screen (no PINs, no hashes). */
export interface LoginUser {
  id: string;
  name: string;
  roleName: string;
}

/** `GET /v1/setup-state`: what the terminal shows before anyone signs in. */
export interface SetupState {
  setupNeeded: boolean;
  outletName: string;
  users: LoginUser[];
}

export interface RoleRight {
  right: Right;
  needsPin: boolean;
}

/** `GET /v1/session` and the answer to a sign-in. */
export interface SessionInfo {
  user: { id: string; name: string; roleId: string; roleName: string };
  rights: RoleRight[];
  discountLimitBp: number;
  expiresAt: string;
}

export interface LoginResult extends SessionInfo {
  token: string;
}

export interface StaffMember {
  id: string;
  name: string;
  roleId: string;
  roleName: string;
  active: boolean;
  locked: boolean;
}

export interface RoleInfo {
  id: string;
  name: string;
  discountLimitBp: number;
  rights: RoleRight[];
  members: number;
}

// ---------- stock (docs/02 "Stock") ----------

export type StockMovementKind = 'opening' | 'purchase' | 'purchase_void' | 'sale' | 'wastage' | 'count' | 'adjust';

/** One raw material in `GET /v1/stock`. Quantities in thousandths of `unit`; costs in paise per whole unit. */
export interface StockItemView {
  id: string;
  name: string;
  unit: StockUnit;
  onHandMilli: number;
  reorderLevelMilli: number;
  lastUnitCostPaise: number | null;
  /** On hand at the last cost (display only, not an accounting valuation). */
  valuePaise: number;
  /** Below the reorder level. */
  low: boolean;
  /** More was used than recorded: needs a physical count. */
  negative: boolean;
  active: boolean;
  /** Recipes (items, variants, add-ons) that use it. */
  usedIn: number;
}

export interface StockMovementView {
  id: string;
  kind: StockMovementKind;
  deltaMilli: number;
  /** KOT number or supplier invoice the movement came from. */
  refText: string | null;
  reason: string | null;
  unitCostPaise: number | null;
  businessDate: string;
  at: string;
  userName: string | null;
}

export interface PurchaseLineView {
  stockItemId: string;
  name: string;
  unit: StockUnit;
  qtyMilli: number;
  unitCostPaise: number;
  amountPaise: number;
}

export interface PurchaseView {
  id: string;
  supplierName: string;
  supplierGstin: string | null;
  invoiceNo: string | null;
  invoiceDate: string | null;
  note: string | null;
  totalPaise: number;
  status: 'posted' | 'void';
  businessDate: string;
  createdAt: string;
  createdByName: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  lines: PurchaseLineView[];
}

export interface RecipeLineView {
  ownerKind: 'item' | 'variant' | 'addon';
  ownerId: string;
  stockItemId: string;
  qtyMilli: number;
}

/** `GET /v1/stock/usage?from&to`: one row per material over business dates from..to. */
export interface StockUsageRow {
  stockItemId: string;
  name: string;
  unit: StockUnit;
  openingMilli: number;
  purchasedMilli: number;
  usedMilli: number;
  wastedMilli: number;
  /** Counts and corrections (net). */
  adjustedMilli: number;
  closingMilli: number;
  /** Used quantity at the last cost. */
  usedValuePaise: number;
  wastedValuePaise: number;
}

// ---------- bills and cash of a day (P2-06) ----------

/** `GET /v1/bills?date=`: every numbered bill of a business date (printed, settled or void). */
export interface DayBill {
  billId: string;
  billNo: string;
  orderId: string;
  orderVersion: number;
  orderState: string;
  table: string;
  partNo: number;
  parts: number;
  totalPaise: number;
  state: 'printed' | 'superseded' | 'settled' | 'void';
  /** Net paid per mode (after any void reversal). */
  payments: Array<{ mode: string; amountPaise: number }>;
  printedAt: string | null;
}

export interface CashMovementView {
  id: string;
  kind: 'pay_in' | 'pay_out' | 'opening' | 'closing';
  amountPaise: number;
  reason: string | null;
  userName: string | null;
  at: string;
}
