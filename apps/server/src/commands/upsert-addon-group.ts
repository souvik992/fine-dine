import { upsertAddonGroupSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { auditUpsert, menuChanged, upsertById, type UpsertResult } from './admin-support.js';

export const upsertAddonGroup = defineCommand({
  type: 'UpsertAddonGroup',
  schema: upsertAddonGroupSchema,
  right: 'admin',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    const ownerOf = ctx.db.prepare('SELECT group_id FROM addon WHERE id = ?').pluck();
    const ids = new Set<string>();
    for (const a of p.addons) {
      if (ids.has(a.id)) throw new PosError('VALIDATION', 'An addon is listed twice.', { addonId: a.id });
      ids.add(a.id);
      const owner = ownerOf.get(a.id) as string | undefined;
      if (owner !== undefined && owner !== p.id) {
        throw new PosError('INVALID_STATE', `Addon ${a.name} belongs to another group.`, { addonId: a.id, groupId: owner });
      }
    }

    const row = { id: p.id, name: p.name, min_select: p.minSelect, max_select: p.maxSelect };
    const before = upsertById(ctx.db, 'addon_group', row);
    for (const a of p.addons) upsertById(ctx.db, 'addon', { id: a.id, group_id: p.id, name: a.name, price_paise: a.pricePaise });

    auditUpsert(ctx, 'addon_group', p.id, before, { ...row, addons: p.addons });
    menuChanged(ctx);
    return { result: { id: p.id, created: !before } satisfies UpsertResult };
  },
});
