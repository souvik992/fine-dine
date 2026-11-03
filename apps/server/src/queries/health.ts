import { isoInZone } from '@dinepos/shared';
import { currentBusinessDate } from '../core/business-day.js';
import type { Db } from '../db/connection.js';
import { schemaVersion } from '../db/migrate.js';
import { SERVER_VERSION } from '../version.js';
import type { BackupStatus } from '../backup/scheduler.js';

export interface Health {
  ok: boolean;
  service: 'dinepos-server';
  version: string;
  schemaVersion: number;
  businessDate: string | null;
  timeZone: string;
  serverTime: string;
  uptimeSec: number;
  /** P2-08: newest backup and whether backups are healthy (one in the last hour, no error). */
  backup?: { lastAt: string | null; ageMin: number | null; ok: boolean; error: string | null };
}

export interface HealthDeps {
  db: Db;
  timeZone: string;
  now: () => Date;
  startedAt: Date;
  backupStatus?: () => BackupStatus;
}

export function getHealth({ db, timeZone, now, startedAt, backupStatus }: HealthDeps): Health {
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
    ...(backupStatus ? { backup: backupHealth(backupStatus()) } : {}),
  };
}

function backupHealth(s: BackupStatus): NonNullable<Health['backup']> {
  return { lastAt: s.last?.at ?? null, ageMin: s.ageMin, ok: s.ageMin !== null && s.ageMin <= 60 && !s.lastError, error: s.lastError ?? s.copyError };
}
