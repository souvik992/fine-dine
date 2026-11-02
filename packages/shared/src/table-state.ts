// Table state is DERIVED, never stored (docs/02-domain-model.md "Derived table state").

export type TableState = 'BLOCKED' | 'RESERVED' | 'FREE' | 'SEATED' | 'KOT_RUNNING' | 'BILL_PRINTED';

export interface TableStateTable {
  status: 'active' | 'reserved' | 'blocked';
}

/** The table's open (or billed) order, if any. Times are ISO-8601 UTC strings. */
export interface TableStateOrder {
  hasFiredKot: boolean;
  lastKotAt?: string | null;
  billPrintedAt?: string | null;
}

export function deriveTableState(table: TableStateTable, order: TableStateOrder | null | undefined): TableState {
  if (table.status === 'blocked') return 'BLOCKED';
  if (!order) return table.status === 'reserved' ? 'RESERVED' : 'FREE';
  if (!order.hasFiredKot) return 'SEATED';
  if (!order.billPrintedAt) return 'KOT_RUNNING';
  if (order.lastKotAt && Date.parse(order.lastKotAt) > Date.parse(order.billPrintedAt)) return 'KOT_RUNNING';
  return 'BILL_PRINTED';
}
