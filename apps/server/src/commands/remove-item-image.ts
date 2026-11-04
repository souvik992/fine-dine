import { removeItemImageSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { menuChanged } from './admin-support.js';
import { dropUnusedPhoto, photoOf, requireItem } from './menu-photo-support.js';

/** Removes a dish's photo; the dish then shows its initial. */
export const removeItemImage = defineCommand({
  type: 'RemoveItemImage',
  schema: removeItemImageSchema,
  right: 'admin',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    const { db } = ctx;
    const dish = requireItem(db, p.itemId);
    const before = photoOf(db, p.itemId);
    if (!before) return { result: { itemId: p.itemId, image: null } };
    db.prepare('DELETE FROM menu_item_image WHERE item_id = ?').run(p.itemId);
    dropUnusedPhoto(db, before);
    ctx.audit({ entity: 'menu_item', entityId: p.itemId, action: 'item.photo', before: { image: before }, after: { name: dish, image: null } });
    menuChanged(ctx, [p.itemId]);
    return { result: { itemId: p.itemId, image: null } };
  },
});
