import { setItemAvailabilitySchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { menuChanged } from './admin-support.js';

/** Sold out / back on (docs/03). Orders already taken keep their items; new ones cannot add it. */
export const setItemAvailability = defineCommand({
  type: 'SetItemAvailability',
  schema: setItemAvailabilitySchema,
  right: 'menu.stock',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    const item = ctx.db.prepare('SELECT name, available FROM menu_item WHERE id = ?').get(p.itemId) as { name: string; available: number } | undefined;
    if (!item) throw new PosError('NOT_FOUND', 'That menu item does not exist.', { itemId: p.itemId });
    const available = p.available ? 1 : 0;
    if (item.available !== available) {
      ctx.db.prepare('UPDATE menu_item SET available = ? WHERE id = ?').run(available, p.itemId);
      ctx.audit({ entity: 'menu_item', entityId: p.itemId, action: p.available ? 'menu_item.available' : 'menu_item.sold_out', before: { available: item.available === 1 }, after: { available: p.available } });
      menuChanged(ctx, [p.itemId]);
    }
    return { result: { itemId: p.itemId, available: p.available } };
  },
});
