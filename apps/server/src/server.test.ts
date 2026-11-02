import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerConfig } from './config.js';
import { loadMigrations } from './db/migrate.js';
import { startServer, type RunningServer } from './server.js';
import { SERVER_VERSION } from './version.js';

// P1-02 acceptance: fresh start creates DB and applies 0001; restart does not re-apply;
// health returns version + businessDate.

const now = () => new Date('2026-11-02T06:30:00Z'); // 12:00 IST
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
  dataDir = path.join(mkdtempSync(path.join(tmpdir(), 'dinepos-srv-')), 'data');
});
afterEach(async () => {
  await running?.close();
  running = undefined;
  rmSync(path.dirname(dataDir), { recursive: true, force: true });
});

describe('startServer', () => {
  it('fresh start creates the data dir and database and applies every migration', async () => {
    running = await startServer(config(), { now, logger: false });
    expect(existsSync(path.join(dataDir, 'test.db'))).toBe(true);
    expect(existsSync(path.join(dataDir, 'backups'))).toBe(true);
    const all = loadMigrations().map((m) => m.version);
    expect(all[0]).toBe(1);
    expect(running.migrations.applied).toEqual(all);
    expect(running.businessDate).toBe('2026-11-02');
  });

  it('restart does not re-apply migrations or open a second business day', async () => {
    running = await startServer(config(), { now, logger: false });
    await running.close();
    running = await startServer(config(), { now, logger: false });
    expect(running.migrations.applied).toEqual([]);
    expect(running.db.prepare('SELECT count(*) FROM schema_migrations').pluck().get()).toBe(loadMigrations().length);
    expect(running.db.prepare('SELECT count(*) FROM business_day').pluck().get()).toBe(1);
  });

  it('health over HTTP returns version and businessDate', async () => {
    running = await startServer(config(), { now, logger: false });
    const res = await fetch(`${running.url}/v1/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      version: SERVER_VERSION,
      businessDate: '2026-11-02',
      schemaVersion: loadMigrations().length,
      timeZone: 'Asia/Kolkata',
      serverTime: '2026-11-02T12:00:00.000+05:30',
    });
  });

  it('refuses a second server on the same data dir and leaves the first running', async () => {
    running = await startServer(config(), { now, logger: false });
    await expect(startServer(config(), { now, logger: false })).rejects.toMatchObject({ code: 'DATA_DIR_LOCKED' });
    const res = await fetch(`${running.url}/v1/health`);
    expect(res.status).toBe(200);
    expect(running.db.open).toBe(true);
  });

  it('releases the lock and closes the database on close', async () => {
    running = await startServer(config(), { now, logger: false });
    const db = running.db;
    await running.close();
    expect(db.open).toBe(false);
    expect(existsSync(path.join(dataDir, 'dinepos.lock'))).toBe(false);
    running = undefined;
  });
});
