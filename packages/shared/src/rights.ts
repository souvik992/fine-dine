// Permission strings from docs/03-command-api.md (Right column) and docs/07-security-licensing.md.

export const RIGHTS = [
  'order.create',
  'order.edit',
  'kot.fire',
  'kot.modify',
  'kot.cancel',
  'table.move',
  'table.merge',
  'item.transfer',
  'bill.print',
  'bill.split',
  'bill.settle',
  'bill.void',
  'reprint',
  'kds.bump',
  'menu.stock',
  'stock.manage',
  'drawer.open',
  'cash.move',
  'dayend',
  'admin',
  'users.manage',
] as const;

export type Right = (typeof RIGHTS)[number];

export function isRight(value: string): value is Right {
  return (RIGHTS as readonly string[]).includes(value);
}

/** Plain-language names for the roles screen. */
export const RIGHT_LABELS: Record<Right, string> = {
  'order.create': 'Seat tables and open orders',
  'order.edit': 'Add and change items not yet sent',
  'kot.fire': 'Send orders to the kitchen (KOT)',
  'kot.modify': 'Change items already sent to the kitchen',
  'kot.cancel': 'Cancel items already sent to the kitchen',
  'table.move': 'Move a table',
  'table.merge': 'Merge tables',
  'item.transfer': 'Move items to another table',
  'bill.print': 'Print bills (discount up to the role limit)',
  'bill.split': 'Split bills',
  'bill.settle': 'Take payment and settle bills',
  'bill.void': 'Void a settled bill',
  reprint: 'Reprint bills and KOTs',
  'kds.bump': 'Mark kitchen tickets ready or served',
  'menu.stock': 'Mark items sold out or back on',
  'stock.manage': 'Manage stock: materials, purchases, wastage, counts and recipes',
  'drawer.open': 'Open the cash drawer',
  'cash.move': 'Cash pay-in and pay-out',
  dayend: 'Close the day (day end)',
  admin: 'Change menu, tables, printers and outlet settings',
  'users.manage': 'Manage staff, PINs and roles',
};

/** Ids of the default roles and device created by migration 0004. Roles stay editable; Owner cannot lose users.manage. */
export const OWNER_ROLE_ID = '01JR0000000000000000000001';
export const MANAGER_ROLE_ID = '01JR0000000000000000000002';
export const CASHIER_ROLE_ID = '01JR0000000000000000000003';
export const CAPTAIN_ROLE_ID = '01JR0000000000000000000004';
export const KITCHEN_ROLE_ID = '01JR0000000000000000000005';
export const UNPAIRED_DEVICE_ID = '01JD0000000000000000000001';
