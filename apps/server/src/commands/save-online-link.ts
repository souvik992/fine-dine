import { saveOnlineLinkSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';

/**
 * Internal (P4-06): the hub accepted the pairing code (POST /v1/online/pair asked it, as the signed-in admin). Stores the
 * device key (a secret: never sent to a terminal) and starts the stream from the beginning.
 */
export const saveOnlineLink = defineCommand({
  type: 'SaveOnlineLink',
  schema: saveOnlineLinkSchema,
  right: 'admin',
  needsOrder: false,
  allowWhenDayClosed: true,
  internal: true,
  apply(ctx, p) {
    ctx.db
      .prepare('UPDATE online_link SET hub_url = ?, device_key = ?, store_slug = ?, store_name = ?, last_seq = 0, menu_hash = NULL, menu_version = 0, paired_at = ?, paired_by = ? WHERE id = 1')
      .run(p.hubUrl, p.deviceKey, p.storeSlug, p.storeName, ctx.nowIso, ctx.actor.userId);
    ctx.audit({ entity: 'online_link', entityId: 'hub', action: 'online.pair', after: { hubUrl: p.hubUrl, store: p.storeSlug } });
    ctx.emit(['online', 'system'], 'online.linked', { store: p.storeSlug });
    return { result: { store: { slug: p.storeSlug, name: p.storeName } } };
  },
});
