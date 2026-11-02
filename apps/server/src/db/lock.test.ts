import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireDataDirLock, LOCK_FILE } from './lock.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'dinepos-lock-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const writeLock = (info: object) => writeFileSync(path.join(dir, LOCK_FILE), JSON.stringify(info));

describe('acquireDataDirLock', () => {
  it('creates the lock and removes it on release', () => {
    const lock = acquireDataDirLock(dir);
    expect(JSON.parse(readFileSync(lock.file, 'utf8'))).toMatchObject({ pid: process.pid, host: hostname() });
    lock.release();
    expect(existsSync(lock.file)).toBe(false);
  });

  it('refuses while another live process holds it', () => {
    // The parent process (the test runner) is alive and is not us.
    writeLock({ pid: process.ppid, host: hostname(), startedAt: 'earlier' });
    expect(() => acquireDataDirLock(dir)).toThrow(expect.objectContaining({ code: 'DATA_DIR_LOCKED' }));
  });

  it('takes over a lock left by a crashed process', () => {
    writeLock({ pid: 2_147_483_000, host: hostname(), startedAt: 'earlier' });
    const lock = acquireDataDirLock(dir);
    expect((JSON.parse(readFileSync(lock.file, 'utf8')) as { pid: number }).pid).toBe(process.pid);
    lock.release();
  });

  it('takes over a corrupt lock file', () => {
    writeFileSync(path.join(dir, LOCK_FILE), 'not json');
    acquireDataDirLock(dir).release();
  });

  it('refuses a lock from another host (database on a shared folder)', () => {
    writeLock({ pid: 1234, host: 'OTHER-PC', startedAt: 'earlier' });
    expect(() => acquireDataDirLock(dir)).toThrow(/shared folder/);
  });

  it('refuses a second lock from the same process', () => {
    const lock = acquireDataDirLock(dir);
    expect(() => acquireDataDirLock(dir)).toThrow(/already runs/);
    lock.release();
    lock.release(); // idempotent
    acquireDataDirLock(dir).release();
  });

  it('does not delete a lock that another process now owns', () => {
    const lock = acquireDataDirLock(dir);
    writeLock({ pid: process.ppid, host: hostname(), startedAt: 'later' });
    lock.release();
    expect(existsSync(lock.file)).toBe(true);
  });
});
