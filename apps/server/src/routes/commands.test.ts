import { newId } from '@dinepos/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { singleTerminalAuth } from '../auth/authenticate.js';
import { allowAllRights } from '../core/rights.js';
import { ensureBusinessDay } from '../core/business-day.js';
import type { Db } from '../db/connection.js';
import { createTestDb } from '../testing/test-db.js';
import { testRegistry } from '../testing/fake-commands.js';

const now = () => new Date('2026-11-02T08:00:00Z');
let db: Db;
let app: FastifyInstance;

beforeEach(() => {
  db = createTestDb();
  ensureBusinessDay(db, 'Asia/Kolkata', now);
  // These tests cover the route and pipeline; sign-in and rights have their own tests (auth/*.test.ts).
  app = buildApp({ db, timeZone: 'Asia/Kolkata', now, registry: testRegistry, auth: singleTerminalAuth, rights: allowAllRights });
});
afterEach(async () => {
  await app.close();
  db.close();
});

const post = (body: unknown) => app.inject({ method: 'POST', url: '/v1/commands', payload: body as object });
const env = (type: string, payload: unknown, extra: object = {}) => ({
  commandId: newId(),
  type,
  payload,
  createdAt: '2026-11-02T13:30:00+05:30',
  ...extra,
});

describe('POST /v1/commands', () => {
  it('returns 200 with the success envelope', async () => {
    const orderId = newId();
    const res = await post(env('TestOpen', { orderId }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, version: 1, result: { orderId }, order: { id: orderId } });
  });

  it('answers a replay with 200 and duplicate: true', async () => {
    const e = env('TestOpen', { orderId: newId() });
    await post(e);
    const res = await post(e);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, duplicate: true });
  });

  it('returns 409 with the current order on VERSION_CONFLICT', async () => {
    const orderId = newId();
    await post(env('TestOpen', { orderId }));
    await post(env('TestNote', { note: 'a' }, { orderId, expectedVersion: 1 }));
    const res = await post(env('TestNote', { note: 'b' }, { orderId, expectedVersion: 1 }));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      ok: false,
      error: { code: 'VERSION_CONFLICT', details: { currentVersion: 2 } },
      order: { id: orderId, version: 2 },
    });
  });

  it('returns 400 VALIDATION for a bad envelope and 422 for INVALID_STATE', async () => {
    expect((await post({ hello: 'world' })).json()).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    const orderId = newId();
    await post(env('TestOpen', { orderId }));
    const res = await post(env('TestFail', {}, { orderId, expectedVersion: 1 }));
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ ok: false, error: { code: 'INVALID_STATE' } });
  });

  it('hides an unexpected handler crash behind INTERNAL', async () => {
    const orderId = newId();
    await post(env('TestOpen', { orderId }));
    const res = await post(env('TestFail', { crash: true }, { orderId, expectedVersion: 1 }));
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('disk on fire');
  });
});
