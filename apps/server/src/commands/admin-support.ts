// Helpers shared by the Upsert* admin handlers. Table and column names come from code only, never input.
import type { CommandContext } from '../core/context.js';
import { PosError } from '../core/errors.js';
import type { Db } from '../db/connection.js';

type SqlValue = string | number | null;
export type Row = Record<string, SqlValue>;

export type AdminTable =
  | 'area'
  | 'dining_table'
  | 'printer'
  | 'station'
  | 'category'
  | 'addon_group'
  | 'addon'
  | 'menu_item'
  | 'variant'
  | 'price_list'
  | 'tax_profile';

export const bool = (b: boolean): number => (b ? 1 : 0);

export function findById(db: Db, table: AdminTable, id: string): Row | undefined {
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Row | undefined;
}

/** NOT_FOUND unless `id` exists in `table`. Null ids pass (optional references). */
export function requireRef(db: Db, table: AdminTable, id: string | null, field: string): void {
  if (id === null) return;
  if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)) {
    throw new PosError('NOT_FOUND', `${field} does not exist.`, { field, id });
  }
}

/** Insert-or-update by primary key `id`. Returns the row as it was before (undefined when new). */
export function upsertById(db: Db, table: AdminTable, row: Row & { id: string }): Row | undefined {
  const before = findById(db, table, row.id);
  const cols = Object.keys(row);
  const updates = cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`);
  db.prepare(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})
     ON CONFLICT(id) DO UPDATE SET ${updates.join(', ')}`,
  ).run(row);
  return before;
}

/** Audits an upsert as `<entity>.create` or `<entity>.update`, with before/after. */
export function auditUpsert(ctx: CommandContext, entity: string, id: string, before: Row | undefined, after: unknown): void {
  ctx.audit({ entity, entityId: id, action: `${entity}.${before ? 'update' : 'create'}`, before, after });
}

/** Bumps the outlet menu version (counter `menu_version`) and announces `menu.changed`. */
export function menuChanged(ctx: CommandContext, itemIds: string[] = []): number {
  ctx.db.prepare("INSERT INTO counter (name, value) VALUES ('menu_version', 1) ON CONFLICT(name) DO UPDATE SET value = value + 1").run();
  const menuVersion = ctx.db.prepare("SELECT value FROM counter WHERE name = 'menu_version'").pluck().get() as number;
  ctx.emit('menu', 'menu.changed', { menuVersion, itemIds });
  return menuVersion;
}

export function currentMenuVersion(db: Db): number {
  return (db.prepare("SELECT value FROM counter WHERE name = 'menu_version'").pluck().get() as number | undefined) ?? 0;
}

/** Floor layout (areas/tables) changed: clients refetch GET /v1/floor. */
export function floorChanged(ctx: CommandContext, data: { areaId?: string; tableId?: string }): void {
  ctx.emit('floor', 'floor.changed', data);
}

export interface UpsertResult {
  id: string;
  created: boolean;
}
