// Runs the backups (docs/07): every 15 minutes, after every day end, and on request. One at a time; a failure is
// logged and reported in /v1/health, never fatal. Each backup is also copied to the second folder when one is set.
import path from 'node:path';
import type { Db } from '../db/connection.js';
import type { EventBus } from '../core/events.js';
import { copyToFolder, listBackups, pruneBackups, runBackup, type BackupInfo, type BackupKind } from './backups.js';

export const BACKUP_INTERVAL_MS = 15 * 60_000;

export interface BackupStatus {
  /** Newest backup in the folder (survives restarts and restores). */
  last: BackupInfo | null;
  /** Minutes since that backup. */
  ageMin: number | null;
  lastError: string | null;
  copyDir: string | null;
  copyLastAt: string | null;
  copyError: string | null;
}

export interface BackupSchedulerOptions {
  db: Db;
  dataDir: string;
  now: () => Date;
  bus?: EventBus;
  /** The second folder (USB drive), read from settings at each backup. */
  copyDir: () => string | null;
  intervalMs?: number;
  log?: (level: 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>) => void;
}

export class BackupScheduler {
  readonly dir: string;
  private timer: NodeJS.Timeout | undefined;
  private unsubscribe: (() => void) | undefined;
  private chain: Promise<unknown> = Promise.resolve();
  private lastError: string | null = null;
  private copyLastAt: string | null = null;
  private copyError: string | null = null;

  constructor(private readonly opts: BackupSchedulerOptions) {
    this.dir = path.join(opts.dataDir, 'backups');
  }

  start(): void {
    const every = this.opts.intervalMs ?? BACKUP_INTERVAL_MS;
    this.timer = setInterval(() => void this.run('auto').catch(() => undefined), every);
    this.timer.unref();
    // A day end forces a backup of the closed day (docs/07).
    this.unsubscribe = this.opts.bus?.subscribe((e) => {
      if (e.event === 'day.changed') void this.run('dayend').catch(() => undefined);
    });
    // Start with a backup when the newest one is older than the interval (e.g. the PC was off).
    const status = this.status();
    if (status.ageMin === null || status.ageMin * 60_000 >= every) void this.run('auto').catch(() => undefined);
  }

  /** Runs one backup after any running one; resolves with it, or rejects with the reason. */
  run(kind: BackupKind): Promise<BackupInfo> {
    const job = this.chain.then(async () => {
      const now = this.opts.now();
      try {
        const info = await runBackup(this.opts.db, this.dir, kind, now);
        this.lastError = null;
        pruneBackups(this.dir, now);
        this.opts.log?.('info', 'backup made', { file: info.file, bytes: info.bytes });
        const copyDir = this.opts.copyDir();
        if (copyDir) {
          try {
            copyToFolder(this.dir, info.file, copyDir, now);
            this.copyLastAt = now.toISOString();
            this.copyError = null;
          } catch (e) {
            this.copyError = e instanceof Error ? e.message : String(e);
            this.opts.log?.('warn', 'backup copy failed', { error: this.copyError });
          }
        }
        return info;
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : String(e);
        this.opts.log?.('error', 'backup failed', { error: this.lastError });
        throw e;
      }
    });
    this.chain = job.catch(() => undefined);
    return job;
  }

  status(): BackupStatus {
    const last = listBackups(this.dir)[0] ?? null;
    return {
      last,
      ageMin: last ? Math.max(0, Math.floor((this.opts.now().getTime() - Date.parse(last.at)) / 60_000)) : null,
      lastError: this.lastError,
      copyDir: this.opts.copyDir(),
      copyLastAt: this.copyLastAt,
      copyError: this.copyError,
    };
  }

  /** Stops the timer and waits for a running backup to finish. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.unsubscribe?.();
    await this.chain;
  }
}
