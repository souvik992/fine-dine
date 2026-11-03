import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newId } from '@dinepos/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerConfig } from '../config.js';
import { DEV_OWNER, devSeedCommands, devSetupCommand, seedId } from '../seed/dev-seed.js';
import { startServer, type RunningServer } from '../server.js';
import { applyPendingRestore, listBackups, pruneBackups, stageRestore, verifyBackup } from './backups.js';

// P2-08 acceptance: restore from a 15-min backup reproduces open orders.

let clock = new Date('2026-11-03T06:30:00Z');
const now = () => clock;
let dataDir: string;
let running: RunningServer | undefined;
const config = (): ServerConfig => ({
  env: 'test',
  host: '127.0.0.1',
  port: 0,
  dataDir,
  dbFile: 'test.db',
  timeZone: 'Asia/Kolkata',
  logLevel: 'silent',
  allowedOrigins: ['app://dinepos'],
  logToFile: false,
});

beforeEach(() => {
  clock = new Date('2026-11-03T06:30:00Z');
  dataDir = path.join(mkdtempSync(path.join(tmpdir(), 'dinepos-bak-')), 'data');
});
afterEach(async () => {
  await running?.close();
  running = undefined;
  rmSync(path.dirname(dataDir), { recursive: true, force: true });
});

const start = (requestRestart = () => undefined) => startServer(config(), { now, logger: false, requestRestart, backupIntervalMs: 3_600_000 });

async function send(s: RunningServer, type: string, payload: unknown, token?: string, order?: { orderId: string; expectedVersion: number }) {
  const res = await s.app.inject({
    method: 'POST',
    url: '/v1/commands',
    headers: token ? { 'x-user-session': token } : {},
    payload: { commandId: newId(), type, payload, createdAt: clock.toISOString(), ...order },
  });
  const body = res.json<{ ok: boolean; order?: { id: string; version: number }; error?: { code: string } }>();
  if (!body.ok) throw new Error(`${type}: ${JSON.stringify(body.error)}`);
  return body;
}

async function seeded(s: RunningServer): Promise<string> {
  await send(s, devSetupCommand().type, devSetupCommand().payload);
  const token = (await s.app.inject({ method: 'POST', url: '/v1/sessions', payload: { userId: DEV_OWNER.id, pin: '1234' } })).json<{ token: string }>().token;
  for (const c of devSeedCommands()) await send(s, c.type, c.payload, token);
  return token;
}

const floorOrders = async (s: RunningServer, token: string) =>
  (await s.app.inject({ method: 'GET', url: '/v1/floor', headers: { 'x-user-session': token } }))
    .json<{ tables: Array<{ label: string; orderId?: string; state: string; amountPaise?: number }> }>()
    .tables.filter((t) => t.orderId)
    .map((t) => ({ label: t.label, orderId: t.orderId, state: t.state, amountPaise: t.amountPaise }));

describe('backups and restore', () => {
  it('restoring a backup brings back exactly the open orders it held (acceptance)', async () => {
    const restart = vi.fn();
    running = await start(restart);
    const token = await seeded(running);
    // Two tables running at the time of the backup.
    const t1 = await send(running, 'OpenTable', { tableId: seedId('table:main:1'), covers: 2 }, token);
    await send(running, 'AddItems', { items: [{ id: newId(), itemId: seedId('item:DM'), qty: 2 }] }, token, { orderId: t1.order!.id, expectedVersion: 1 });
    await send(running, 'FireKOT', { all: true }, token, { orderId: t1.order!.id, expectedVersion: 2 });
    await send(running, 'OpenTable', { tableId: seedId('table:main:2'), covers: 4 }, token);
    const atBackup = await floorOrders(running, token);
    expect(atBackup).toHaveLength(2);

    clock = new Date(clock.getTime() + 15 * 60_000);
    const made = (await running.app.inject({ method: 'POST', url: '/v1/admin/backups', headers: { 'x-user-session': token } })).json<{ backup: { file: string } }>().backup;
    // Later work that the restore takes back: T3 opened, T2 moved.
    await send(running, 'OpenTable', { tableId: seedId('table:main:3'), covers: 2 }, token);
    expect(await floorOrders(running, token)).toHaveLength(3);

    // The restore needs the Owner's PIN; it keeps a safety backup and asks for a restart.
    const ask = (pin?: string) =>
      running!.app.inject({ method: 'POST', url: '/v1/admin/restore', headers: { 'x-user-session': token, ...(pin ? { 'x-manager-pin': pin } : {}) }, payload: { file: made.file } });
    expect((await ask()).json<{ error: { code: string } }>().error.code).toBe('PIN_REQUIRED');
    const staged = (await ask('1234')).json<{ restoring: string; safetyBackup: string; restarting: boolean }>();
    expect(staged).toMatchObject({ restoring: made.file, restarting: true });
    await vi.waitFor(() => expect(restart).toHaveBeenCalledOnce(), { timeout: 5_000 });

    await running.close();
    running = await start();
    expect(running.restored?.restored).toBe(made.file);
    expect(readdirSync(running.restored!.aside)).toContain('test.db'); // the replaced database is kept, never deleted
    const login = (await running.app.inject({ method: 'POST', url: '/v1/sessions', payload: { userId: DEV_OWNER.id, pin: '1234' } })).json<{ token: string }>().token;
    expect(await floorOrders(running, login)).toEqual(atBackup);
    expect(listBackups(path.join(dataDir, 'backups')).some((b) => b.file === staged.safetyBackup)).toBe(true);
  }, 60_000);

  it('a backup is checked; a damaged file or a non-DinePOS file is refused for a restore', async () => {
    running = await start();
    await seeded(running);
    const dir = path.join(dataDir, 'backups');
    const made = await running.backups.run('manual');
    expect(verifyBackup(path.join(dir, made.file)).ok).toBe(true);
    const fake = 'manual-20261103T000000000Z.db';
    writeFileSync(path.join(dir, fake), 'not a database');
    expect(verifyBackup(path.join(dir, fake)).ok).toBe(false);
    expect(() => stageRestore(dataDir, dir, fake, null, clock)).toThrow(/cannot be used/);
    expect(() => stageRestore(dataDir, dir, '../test.db', null, clock)).toThrow(/not a backup file/);
  }, 30_000);

  it('a failed restore at start puts the previous database back and keeps the marker aside', () => {
    const dir = path.join(dataDir, 'backups');
    mkdtempDir(dir);
    writeFileSync(path.join(dataDir, 'test.db'), 'current');
    writeFileSync(path.join(dataDir, 'restore-pending.json'), JSON.stringify({ file: 'manual-20261103T000000000Z.db', requestedAt: 'x', requestedBy: null }));
    writeFileSync(path.join(dir, 'manual-20261103T000000000Z.db'), 'broken');
    expect(() => applyPendingRestore(dataDir, 'test.db', clock)).toThrow(/failed its check/);
    expect(readFileSync(path.join(dataDir, 'test.db'), 'utf8')).toBe('current'); // the current database is untouched
    expect(readdirSync(dataDir).some((f) => f.startsWith('restore-pending.json.failed-'))).toBe(true);
  });

  it('retention: everything from the last 2 hours, then one per hour for 7 days, one per day for 30 days', () => {
    const dir = mkdtempDir(path.join(dataDir, 'prune'));
    const at = (h: number) => new Date(clock.getTime() - h * 3_600_000);
    const name = (d: Date) => `auto-${d.toISOString().replace(/[-:.]/g, '')}.db`;
    const files = [0.25, 0.5, 1.75, 3, 3.25, 50, 50.5, 24 * 10, 24 * 10 + 1, 24 * 40].map((h) => name(at(h)));
    for (const f of files) writeFileSync(path.join(dir, f), '');
    for (let i = 0; i < 35; i++) writeFileSync(path.join(dir, `manual-2026110${i % 3}T0000${String(i).padStart(2, '0')}000Z.db`), '');
    const removed = pruneBackups(dir, clock);
    const left = new Set(listBackups(dir).filter((b) => b.kind === 'auto').map((b) => b.file));
    expect([0, 1, 2].every((i) => left.has(files[i]!))).toBe(true); // last 2 hours: all
    expect(left.has(files[9]!)).toBe(false); // older than 30 days
    expect(left.size).toBe(6); // 3 recent + one of each hour pair (3h, 50h) + one of the day (10 days)
    expect(listBackups(dir).filter((b) => b.kind === 'manual')).toHaveLength(30);
    expect(removed.length).toBe(files.length - 6 + 5);
  });

  it('health reports the newest backup', async () => {
    running = await start();
    await running.backups.run('manual');
    const h = (await running.app.inject({ method: 'GET', url: '/v1/health' })).json<{ backup: { ok: boolean; lastAt: string } }>();
    expect(h.backup.ok).toBe(true);
    expect(h.backup.lastAt).toBe(clock.toISOString());
  }, 30_000);
});

/** An empty folder at `dir`. */
function mkdtempDir(dir: string): string {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}
