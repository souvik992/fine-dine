import { upsertCategorySchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import type { Db } from '../db/connection.js';
import { auditUpsert, menuChanged, requireRef, upsertById, type UpsertResult } from './admin-support.js';

/** True when making `parentId` the parent of `id` would create a loop. */
function wouldLoop(db: Db, id: string, parentId: string): boolean {
  const parentOf = db.prepare('SELECT parent_id FROM category WHERE id = ?').pluck();
  const seen = new Set<string>();
  for (let cur: string | null = parentId; cur !== null; cur = (parentOf.get(cur) as string | null | undefined) ?? null) {
    if (cur === id || seen.has(cur)) return true;
    seen.add(cur);
  }
  return false;
}

export const upsertCategory = defineCommand({
  type: 'UpsertCategory',
  schema: upsertCategorySchema,
  right: 'admin',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    requireRef(ctx.db, 'category', p.parentId, 'parentId');
    requireRef(ctx.db, 'station', p.stationId, 'stationId');
    if (p.parentId && wouldLoop(ctx.db, p.id, p.parentId)) {
      throw new PosError('INVALID_STATE', 'That parent would put the category inside itself.', { parentId: p.parentId });
    }
    const after = { id: p.id, name: p.name, parent_id: p.parentId, station_id: p.stationId, sort: p.sort };
    const before = upsertById(ctx.db, 'category', after);
    auditUpsert(ctx, 'category', p.id, before, after);
    menuChanged(ctx);
    return { result: { id: p.id, created: !before } satisfies UpsertResult };
  },
});
