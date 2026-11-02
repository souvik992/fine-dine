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
  'drawer.open',
  'cash.move',
  'dayend',
  'admin',
] as const;

export type Right = (typeof RIGHTS)[number];

export function isRight(value: string): value is Right {
  return (RIGHTS as readonly string[]).includes(value);
}
