import { setConfigSchema, type ConfigKey } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { getConfig, setConfigValue } from '../core/outlet-config.js';
import { requireRef } from './admin-support.js';

/** Outlet and billing settings (docs/03 admin `SetConfig`). Only the keys sent are changed. */
export const setConfig = defineCommand({
  type: 'SetConfig',
  schema: setConfigSchema,
  right: 'admin',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    const values = p.values as Partial<Record<ConfigKey, unknown>>;
    if (values['bill.printerId']) requireRef(ctx.db, 'printer', values['bill.printerId'] as string, 'bill.printerId');
    if (values['kot.default_station_id']) requireRef(ctx.db, 'station', values['kot.default_station_id'] as string, 'kot.default_station_id');

    const before = getConfig(ctx.db);
    const changed: Partial<Record<ConfigKey, unknown>> = {};
    for (const [key, value] of Object.entries(values) as Array<[ConfigKey, unknown]>) {
      if (JSON.stringify(before[key]) === JSON.stringify(value)) continue;
      setConfigValue(ctx.db, key, value);
      changed[key] = value;
      ctx.audit({ entity: 'config', entityId: key, action: 'config.set', before: { value: before[key] }, after: { value } });
    }
    if (Object.keys(changed).length > 0) ctx.emit('system', 'config.changed', { keys: Object.keys(changed) });
    return { result: { changed: Object.keys(changed) } };
  },
});
