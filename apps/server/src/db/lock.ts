import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { StartupError } from '../core/errors.js';

export const LOCK_FILE = 'dinepos.lock';

interface LockInfo {
  pid: number;
  host: string;
  startedAt: string;
}

// Locks held by this process. A lock file with our own pid that is not in here was left by an earlier
// process that had the same pid (pids are reused), so it is stale.
const heldHere = new Set<string>();

export interface DataDirLock {
  readonly file: string;
  release(): void;
}

/**
 * Claims the data directory for this process so a second server can never open the same database
 * (single-writer rule). A lock left by a crashed process (pid no longer running) is taken over.
 */
export function acquireDataDirLock(dataDir: string, now: () => Date = () => new Date()): DataDirLock {
  const file = path.resolve(dataDir, LOCK_FILE);
  if (heldHere.has(file)) {
    throw new StartupError('DATA_DIR_LOCKED', `This process already runs a DinePOS server on ${dataDir}.`);
  }
  const info: LockInfo = { pid: process.pid, host: hostname(), startedAt: now().toISOString() };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(file, JSON.stringify(info), { flag: 'wx' });
      heldHere.add(file);
      let released = false;
      return {
        file,
        release: () => {
          if (released) return;
          released = true;
          heldHere.delete(file);
          releaseIfOurs(file);
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const holder = readLock(file);
      if (holder && holder.pid !== process.pid && holder.host === info.host && isRunning(holder.pid)) {
        throw new StartupError(
          'DATA_DIR_LOCKED',
          `Another DinePOS server (pid ${holder.pid}, started ${holder.startedAt}) is using ${dataDir}. ` +
            'Stop it before starting a new one.',
        );
      }
      if (holder && holder.host !== info.host) {
        throw new StartupError(
          'DATA_DIR_LOCKED',
          `${dataDir} is locked by host "${holder.host}". The database must live on the master PC's own disk, ` +
            'never on a shared folder.',
        );
      }
      // Stale (crashed process) or unreadable lock: remove and try once more.
      unlinkSync(file);
    }
  }
  throw new StartupError('DATA_DIR_LOCKED', `Could not lock ${dataDir}.`);
}

function readLock(file: string): LockInfo | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<LockInfo>;
    if (typeof parsed.pid === 'number' && typeof parsed.host === 'string') {
      return { pid: parsed.pid, host: parsed.host, startedAt: String(parsed.startedAt ?? 'unknown') };
    }
  } catch {
    // Missing or corrupt lock file counts as stale.
  }
  return null;
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to another user.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function releaseIfOurs(file: string): void {
  if (readLock(file)?.pid !== process.pid) return;
  try {
    unlinkSync(file);
  } catch {
    // Already gone.
  }
}
