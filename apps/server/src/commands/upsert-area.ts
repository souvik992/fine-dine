import { upsertAreaSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { auditUpsert, floorChanged, requireRef, upsertById, type UpsertResult } from './admin-support.js';

export const upsertArea = defineCommand({
  type: 'UpsertArea',
  schema: upsertAreaSchema,
  right: 'admin',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    requireRef(ctx.db, 'price_list', p.priceListId, 'priceListId');
    requireRef(ctx.db, 'tax_profile', p.taxProfileId, 'taxProfileId');
    const after = { id: p.id, name: p.name, sort: p.sort, price_list_id: p.priceListId, tax_profile_id: p.taxProfileId };
    const before = upsertById(ctx.db, 'area', after);
    auditUpsert(ctx, 'area', p.id, before, after);
    floorChanged(ctx, { areaId: p.id });
    return { result: { id: p.id, created: !before } satisfies UpsertResult };
  },
});
