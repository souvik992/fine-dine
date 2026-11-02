import { upsertStationSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { auditUpsert, bool, menuChanged, requireRef, upsertById, type UpsertResult } from './admin-support.js';

export const upsertStation = defineCommand({
  type: 'UpsertStation',
  schema: upsertStationSchema,
  right: 'admin',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    const printerIds = [...new Set(p.printerIds)];
    for (const id of printerIds) requireRef(ctx.db, 'printer', id, 'printerIds');

    const beforeLinks = ctx.db.prepare('SELECT printer_id FROM station_printer WHERE station_id = ? ORDER BY printer_id').pluck().all(p.id);
    const row = { id: p.id, name: p.name, has_kds: bool(p.hasKds) };
    const before = upsertById(ctx.db, 'station', row);
    // Link rows are configuration, replaced as a set.
    ctx.db.prepare('DELETE FROM station_printer WHERE station_id = ?').run(p.id);
    const link = ctx.db.prepare('INSERT INTO station_printer (station_id, printer_id) VALUES (?, ?)');
    for (const id of printerIds) link.run(p.id, id);

    auditUpsert(ctx, 'station', p.id, before && { ...before, printer_ids: JSON.stringify(beforeLinks) }, { ...row, printerIds });
    menuChanged(ctx);
    return { result: { id: p.id, created: !before } satisfies UpsertResult };
  },
});
