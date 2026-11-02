import { isoInZone } from '@dinepos/shared';
import { currentBusinessDate } from '../core/business-day.js';
import type { Db } from '../db/connection.js';
import { schemaVersion } from '../db/migrate.js';
import { SERVER_VERSION } from '../version.js';

export interface Health {
  ok: boolean;
  service: 'dinepos-server';
  version: string;
  schemaVersion: number;
  businessDate: string | null;
  timeZone: string;
  serverTime: string;
  uptimeSec: number;
}

export interface HealthDeps {
  db: Db;
  timeZone: string;
  now: () => Date;
  startedAt: Date;
}

export function getHealth({ db, timeZone, now, startedAt }: HealthDeps): Health {
  const at = now();
  const businessDate = currentBusinessDate(db);
  return {
    ok: businessDate !== null,
    service: 'dinepos-server',
    version: SERVER_VERSION,
    schemaVersion: schemaVersion(db),
    businessDate,
    timeZone,
    serverTime: isoInZone(at, timeZone),
    uptimeSec: Math.max(0, Math.floor((at.getTime() - startedAt.getTime()) / 1000)),
  };
}
