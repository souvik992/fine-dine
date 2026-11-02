// Outlet settings from the `config` table, with safe defaults (docs/08; keys in shared configSchemas).
import { configSchemas, DEFAULT_BILL_PREFIX, type ConfigKey, type OutletConfig } from '@dinepos/shared';
import type { Db } from '../db/connection.js';

export const CONFIG_DEFAULTS: OutletConfig = {
  'outlet.name': 'Restaurant',
  'outlet.addressLines': [],
  'outlet.gstin': null,
  'outlet.fssai': null,
  'outlet.phone': null,
  'bill.prefix': DEFAULT_BILL_PREFIX,
  'bill.footerLines': ['Thank you! Please visit again.'],
  'bill.roundOffStep': 100,
  'bill.roundOffTie': 'up',
  'bill.serviceChargeBp': 0,
  'bill.upiVpa': null,
  'bill.upiPayeeName': null,
  'bill.printerId': null,
  'kot.default_station_id': null,
};

const KEYS = Object.keys(configSchemas) as ConfigKey[];

/**
 * Reads every known key. Values are stored as JSON; a value that no longer passes its schema (hand-edited
 * database, older format) falls back to the default instead of breaking billing.
 */
export function getConfig(db: Db): OutletConfig {
  const rows = db.prepare(`SELECT key, value FROM config WHERE key IN (${KEYS.map(() => '?').join(',')})`).all(...KEYS) as Array<{
    key: ConfigKey;
    value: string;
  }>;
  const out: Record<string, unknown> = { ...CONFIG_DEFAULTS };
  for (const r of rows) {
    let raw: unknown;
    try {
      raw = JSON.parse(r.value);
    } catch {
      // Older plain-text values (e.g. kot.default_station_id written before P1-10).
      raw = r.value;
    }
    const parsed = configSchemas[r.key].safeParse(raw);
    if (parsed.success) out[r.key] = parsed.data;
  }
  return out as OutletConfig;
}

export function setConfigValue(db: Db, key: ConfigKey, value: unknown): void {
  db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
}
