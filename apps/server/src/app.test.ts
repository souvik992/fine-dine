import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { ensureBusinessDay } from './core/business-day.js';
import { PosError } from './core/errors.js';
import type { Db } from './db/connection.js';
import { createTestDb } from './testing/test-db.js';
import { loadMigrations } from './db/migrate.js';
import { SERVER_VERSION } from './version.js';

const now = () => new Date('2026-11-02T06:30:00Z');
let db: Db;
let app: FastifyInstance;

beforeEach(() => {
  db = createTestDb();
  app = buildApp({ db, timeZone: 'Asia/Kolkata', now, startedAt: new Date('2026-11-02T06:29:00Z') });
});
afterEach(async () => {
  await app.close();
  db.close();
});

describe('GET /v1/health', () => {
  it('returns version, schema version and businessDate', async () => {
    ensureBusinessDay(db, 'Asia/Kolkata', now);
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({
      ok: true,
      service: 'dinepos-server',
      version: SERVER_VERSION,
      schemaVersion: loadMigrations().length,
      businessDate: '2026-11-02',
      timeZone: 'Asia/Kolkata',
      serverTime: '2026-11-02T12:00:00.000+05:30',
      uptimeSec: 60,
      // P2-09: the licence in brief (not enforced in a development run or a test).
      licence: { state: 'dev', canOpenDay: true, message: 'Development run: the licence is not enforced.' },
    });
  });

  it('reports not ok when no business date is open', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.json()).toMatchObject({ ok: false, businessDate: null });
  });
});

describe('errors', () => {
  it('answers unknown routes with the standard NOT_FOUND shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/nope?x=1' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'No route for GET /v1/nope.' } });
  });

  it('maps PosError to its status and code', async () => {
    app.get('/test/pos-error', () => {
      throw new PosError('VERSION_CONFLICT', 'Order changed.', { currentVersion: 9 });
    });
    const res = await app.inject({ method: 'GET', url: '/test/pos-error' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      ok: false,
      error: { code: 'VERSION_CONFLICT', message: 'Order changed.', details: { currentVersion: 9 } },
    });
  });

  it('hides internal error details', async () => {
    app.get('/test/boom', () => {
      throw new Error('SQLITE_CORRUPT at /secret/path');
    });
    const res = await app.inject({ method: 'GET', url: '/test/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret');
    expect(res.json()).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
  });

  it('rejects malformed JSON as VALIDATION', async () => {
    app.post('/test/echo', (req) => req.body);
    const res = await app.inject({
      method: 'POST',
      url: '/test/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{bad json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('tags every response with a request id', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});
