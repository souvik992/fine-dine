import { setCaptainSectionSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { requireActiveUser } from './captain-support.js';

/** The areas and tables a captain looks after (P3-04). Replaces their whole section; audited before/after. */
export const setCaptainSection = defineCommand({
  type: 'SetCaptainSection',
  schema: setCaptainSectionSchema,
  right: 'staff.sections',
  needsOrder: false,
  apply(ctx, p) {
    const { db } = ctx;
    const user = requireActiveUser(db, p.userId);
    for (const id of p.areaIds) if (!db.prepare('SELECT 1 FROM area WHERE id = ?').get(id)) throw new PosError('NOT_FOUND', 'Area not found.', { areaId: id });
    for (const id of p.tableIds) if (!db.prepare('SELECT 1 FROM dining_table WHERE id = ?').get(id)) throw new PosError('NOT_FOUND', 'Table not found.', { tableId: id });

    const rows = db.prepare('SELECT area_id, table_id FROM captain_section WHERE user_id = ?').all(p.userId) as Array<{ area_id: string | null; table_id: string | null }>;
    const before = { areaIds: rows.flatMap((r) => (r.area_id ? [r.area_id] : [])).sort(), tableIds: rows.flatMap((r) => (r.table_id ? [r.table_id] : [])).sort() };
    db.prepare('DELETE FROM captain_section WHERE user_id = ?').run(p.userId);
    const insert = db.prepare('INSERT INTO captain_section (user_id, area_id, table_id) VALUES (?, ?, ?)');
    for (const id of p.areaIds) insert.run(p.userId, id, null);
    for (const id of p.tableIds) insert.run(p.userId, null, id);

    ctx.audit({ entity: 'app_user', entityId: user.id, action: 'staff.section', before, after: { areaIds: [...p.areaIds].sort(), tableIds: [...p.tableIds].sort() } });
    ctx.emit('floor', 'floor.changed', { captainId: user.id });
    return { result: { userId: user.id } };
  },
});
