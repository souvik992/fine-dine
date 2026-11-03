// Captains' sections and bill requests (P3-04).
import type { Db } from '../db/connection.js';
import { PosError } from '../core/errors.js';

/** An active staff member, or NOT_FOUND. */
export function requireActiveUser(db: Db, userId: string): { id: string; name: string } {
  const u = db.prepare('SELECT id, name FROM app_user WHERE id = ? AND active = 1').get(userId) as { id: string; name: string } | undefined;
  if (!u) throw new PosError('NOT_FOUND', 'That person is not on the active staff list.', { userId });
  return u;
}

/** Captains whose section holds this table: listed for the table itself, or for its area. */
export function sectionCaptains(db: Db, tableId: string): string[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT s.user_id FROM captain_section s JOIN app_user u ON u.id = s.user_id AND u.active = 1
         WHERE s.table_id = @tableId OR s.area_id = (SELECT area_id FROM dining_table WHERE id = @tableId)
         ORDER BY s.user_id`,
      )
      .pluck()
      .all({ tableId }) as string[]
  );
}

/**
 * The captain a new order gets when nobody is named: the one whose section lists this table, else the only captain
 * whose section holds its area. Null when nobody, or more than one, looks after it.
 */
export function defaultCaptain(db: Db, tableId: string): string | null {
  const byTable = db
    .prepare('SELECT DISTINCT s.user_id FROM captain_section s JOIN app_user u ON u.id = s.user_id AND u.active = 1 WHERE s.table_id = ?')
    .pluck()
    .all(tableId) as string[];
  if (byTable.length) return byTable.length === 1 ? byTable[0]! : null;
  const byArea = sectionCaptains(db, tableId);
  return byArea.length === 1 ? byArea[0]! : null;
}
