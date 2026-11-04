import { setItemImageSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { menuChanged } from './admin-support.js';
import { dropUnusedPhoto, photoOf, requireItem, storePhoto } from './menu-photo-support.js';

/** Sets a dish's photo (Settings › Menu, one at a time or Bulk photos). The browser has already resized it. */
export const setItemImage = defineCommand({
  type: 'SetItemImage',
  schema: setItemImageSchema,
  right: 'admin',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    const { db } = ctx;
    const dish = requireItem(db, p.itemId);
    const name = storePhoto(db, p.dataBase64, ctx.nowIso);
    const before = photoOf(db, p.itemId);
    if (before === name) return { result: { itemId: p.itemId, image: name } };
    db.prepare(
      'INSERT INTO menu_item_image (item_id, image_name, set_at, set_by) VALUES (?, ?, ?, ?) ON CONFLICT (item_id) DO UPDATE SET image_name = excluded.image_name, set_at = excluded.set_at, set_by = excluded.set_by',
    ).run(p.itemId, name, ctx.nowIso, ctx.actor.userId);
    dropUnusedPhoto(db, before);
    ctx.audit({ entity: 'menu_item', entityId: p.itemId, action: 'item.photo', before: { image: before }, after: { name: dish, image: name } });
    menuChanged(ctx, [p.itemId]);
    return { result: { itemId: p.itemId, image: name } };
  },
});
