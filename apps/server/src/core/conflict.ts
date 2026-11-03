// "Table changed by <user>" (docs/05, P2-07): when a command arrives on an older version of an order, the conflict
// says who changed it last, what they did and when, so the other terminal can check before trying again.
import { isoInZone } from '@dinepos/shared';
import type { Db } from '../db/connection.js';

const WHAT: Record<string, string> = {
  'order.items.add': 'added items',
  'order.item.update': 'changed an item',
  'order.item.remove': 'removed an item',
  'kot.fire': 'sent items to the kitchen',
  'item.modify_fired': 'reduced a sent item',
  'item.cancel_fired': 'cancelled a sent item',
  'order.move_table': 'moved the table',
  'order.merge_in': 'merged another table in',
  'order.merged': 'merged this table into another',
  'order.transfer_items': 'moved items',
  'bill.print': 'printed the bill',
  'bill.reissue': 'printed the bill again',
  'bill.split': 'split the bill',
  'bill.settle': 'took payment',
  'bill.void': 'voided the bill',
  'order.reopen': 'reopened the bill',
  'order.open': 'seated the table',
};

export interface LastChange {
  by: string | null;
  what: string;
  /** Local "HH:MM". */
  at: string;
}

/** The latest audited change to the order, its items, bills or KOTs. */
export function lastChange(db: Db, orderId: string, timeZone: string): LastChange | null {
  const row = db
    .prepare(
      `SELECT a.action, a.ts, u.name FROM audit_event a LEFT JOIN app_user u ON u.id = a.user_id
       WHERE a.entity_id = @o
          OR a.entity_id IN (SELECT id FROM order_item WHERE order_id = @o)
          OR a.entity_id IN (SELECT id FROM bill WHERE order_id = @o)
          OR a.entity_id IN (SELECT id FROM kot WHERE order_id = @o)
       ORDER BY a.seq DESC LIMIT 1`,
    )
    .get({ o: orderId }) as { action: string; ts: string; name: string | null } | undefined;
  if (!row) return null;
  return { by: row.name, what: WHAT[row.action] ?? 'changed the order', at: isoInZone(new Date(row.ts), timeZone).slice(11, 16) };
}

/** "T7 was changed by Ravi (moved the table) at 20:14. Check the order and try again." */
export function conflictMessage(table: string | null, change: LastChange | null): string {
  const where = table ? `Table ${table}` : 'This order';
  if (!change) return `${where} was changed on another terminal. Check the order and try again.`;
  return `${where} was changed by ${change.by ?? 'another terminal'} (${change.what}) at ${change.at}. Check the order and try again.`;
}
