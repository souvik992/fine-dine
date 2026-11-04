// Table state is DERIVED, never stored (docs/02-domain-model.md "Derived table state").

export type TableState = 'BLOCKED' | 'RESERVED' | 'FREE' | 'SEATED' | 'KOT_RUNNING' | 'FOOD_READY' | 'SERVED' | 'BILL_PRINTED';

export interface TableStateTable {
  status: 'active' | 'reserved' | 'blocked';
}

/**
 * What the kitchen screens say about the order's tickets (those with food still on it). `unknown`: tickets at
 * stations without a screen, whose food nobody reports; while there are any, the table stays "KOT running".
 */
export interface TableStateKitchen {
  cooking: number;
  ready: number;
  served: number;
  unknown: number;
}

/** The table's open (or billed) order, if any. Times are ISO-8601 UTC strings. */
export interface TableStateOrder {
  hasFiredKot: boolean;
  lastKotAt?: string | null;
  billPrintedAt?: string | null;
  kitchen?: TableStateKitchen | null;
}

export function deriveTableState(table: TableStateTable, order: TableStateOrder | null | undefined): TableState {
  if (table.status === 'blocked') return 'BLOCKED';
  if (!order) return table.status === 'reserved' ? 'RESERVED' : 'FREE';
  if (!order.hasFiredKot) return 'SEATED';
  // a bill printed after the last KOT stands until more food is sent
  if (order.billPrintedAt && !(order.lastKotAt && Date.parse(order.lastKotAt) > Date.parse(order.billPrintedAt))) return 'BILL_PRINTED';
  // the kitchen screens know the food is done: nothing cooking, nothing at a station without a screen
  const k = order.kitchen;
  if (k && k.unknown === 0 && k.cooking === 0 && k.ready + k.served > 0) return k.ready > 0 ? 'FOOD_READY' : 'SERVED';
  return 'KOT_RUNNING';
}
