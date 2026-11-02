import { upsertMenuItemSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { auditUpsert, bool, menuChanged, requireRef, upsertById, type UpsertResult } from './admin-support.js';

export const upsertMenuItem = defineCommand({
  type: 'UpsertMenuItem',
  schema: upsertMenuItemSchema,
  right: 'admin',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    const { db } = ctx;
    requireRef(db, 'category', p.categoryId, 'categoryId');
    requireRef(db, 'station', p.stationId, 'stationId');
    const groupIds = [...new Set(p.addonGroupIds)];
    for (const id of groupIds) requireRef(db, 'addon_group', id, 'addonGroupIds');

    if (p.shortCode) {
      const other = db.prepare('SELECT name FROM menu_item WHERE short_code = ? AND id <> ?').pluck().get(p.shortCode, p.id) as
        | string
        | undefined;
      if (other) throw new PosError('INVALID_STATE', `Short code ${p.shortCode} is already used by ${other}.`, { shortCode: p.shortCode });
    }
    const variantOwner = db.prepare('SELECT item_id FROM variant WHERE id = ?').pluck();
    for (const v of p.variants) {
      const owner = variantOwner.get(v.id) as string | undefined;
      if (owner !== undefined && owner !== p.id) {
        throw new PosError('INVALID_STATE', `Variant ${v.name} belongs to another item.`, { variantId: v.id });
      }
    }

    const row = {
      id: p.id,
      category_id: p.categoryId,
      name: p.name,
      short_code: p.shortCode,
      veg: bool(p.veg),
      base_price_paise: p.basePricePaise,
      tax_rate_bp: p.taxRateBp,
      hsn_sac: p.hsnSac,
      station_id: p.stationId,
      available: bool(p.available),
      active: bool(p.active),
      sort: p.sort,
    };
    const before = upsertById(db, 'menu_item', row);
    for (const v of p.variants) upsertById(db, 'variant', { id: v.id, item_id: p.id, name: v.name, price_paise: v.pricePaise, sort: v.sort });
    // Link rows are configuration, replaced as a set. Variants and addons are never deleted.
    db.prepare('DELETE FROM item_addon_group WHERE item_id = ?').run(p.id);
    const link = db.prepare('INSERT INTO item_addon_group (item_id, group_id) VALUES (?, ?)');
    for (const id of groupIds) link.run(p.id, id);

    auditUpsert(ctx, 'menu_item', p.id, before, { ...row, variants: p.variants, addonGroupIds: groupIds });
    menuChanged(ctx, [p.id]);
    return { result: { id: p.id, created: !before } satisfies UpsertResult };
  },
});
