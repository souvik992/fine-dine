import { recordOnlinePublishSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';

/** Internal (P4-06): the hub took this menu (by its hash), so an unchanged menu is not sent again. */
export const recordOnlinePublish = defineCommand({
  type: 'RecordOnlinePublish',
  schema: recordOnlinePublishSchema,
  right: null,
  needsOrder: false,
  allowWhenDayClosed: true,
  internal: true,
  apply(ctx, p) {
    ctx.db.prepare('UPDATE online_link SET menu_hash = ?, menu_version = ? WHERE id = 1').run(p.hash, p.version);
    ctx.emit('online', 'online.published', { version: p.version });
    return { result: { version: p.version } };
  },
});
