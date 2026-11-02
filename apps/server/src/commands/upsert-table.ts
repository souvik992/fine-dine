import { upsertTableSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { auditUpsert, floorChanged, requireRef, upsertById, type UpsertResult } from './admin-support.js';

export const upsertTable = defineCommand({
  type: 'UpsertTable',
  schema: upsertTableSchema,
  right: 'admin',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    requireRef(ctx.db, 'area', p.areaId, 'areaId');
    const clash = ctx.db
      .prepare('SELECT id FROM dining_table WHERE area_id = ? AND label = ? COLLATE NOCASE AND id <> ?')
      .get(p.areaId, p.label, p.id);
    if (clash) throw new PosError('INVALID_STATE', `Table ${p.label} already exists in this area.`, { label: p.label });

    const current = ctx.db.prepare('SELECT open_order_id FROM dining_table WHERE id = ?').get(p.id) as
      | { open_order_id: string | null }
      | undefined;
    if (current?.open_order_id && p.status !== 'active') {
      throw new PosError('INVALID_STATE', `Table ${p.label} has an open order; settle or move it first.`, {
        orderId: current.open_order_id,
      });
    }

    // open_order_id is owned by order commands; the upsert never touches it.
    const after = {
      id: p.id,
      area_id: p.areaId,
      label: p.label,
      seats: p.seats,
      layout_x: p.layoutX,
      layout_y: p.layoutY,
      status: p.status,
    };
    const before = upsertById(ctx.db, 'dining_table', after);
    auditUpsert(ctx, 'dining_table', p.id, before, after);
    floorChanged(ctx, { areaId: p.areaId, tableId: p.id });
    return { result: { id: p.id, created: !before } satisfies UpsertResult };
  },
});
