import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, HOST_KEY_HEADER, type DinePosApp } from '../app.js';
import type { Db } from '../db/connection.js';
import { createTestDb } from '../testing/test-db.js';

// P6-04: a hosted outlet's server trusts nobody on loopback; only DinePOS Cloud's own process, with the outlet's host
// key, acts as the master device (the owner's first steps). An outlet PC has no host key, so the header means nothing.
const KEY = 'k'.repeat(43);
let db: Db;
let app: DinePosApp;
afterEach(async () => {
  await app.close();
  db.close();
});

describe('host key (hosted outlets)', () => {
  it('with the right key the cloud is the master; without it, or with a wrong one, a device token is needed', async () => {
    db = createTestDb();
    app = buildApp({ db, timeZone: 'Asia/Kolkata', trustLoopback: false, hostKey: KEY });
    expect((await app.inject({ method: 'GET', url: '/v1/device' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/device', headers: { [HOST_KEY_HEADER]: `${KEY}x` } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/device', headers: { [HOST_KEY_HEADER]: 'k'.repeat(42) + 'j' } })).statusCode).toBe(401);
    const master = await app.inject({ method: 'GET', url: '/v1/device', headers: { [HOST_KEY_HEADER]: KEY } });
    expect(master.statusCode).toBe(200);
    expect(master.json()).toMatchObject({ master: true });
  });

  it('an outlet PC (no host key) ignores the header', async () => {
    db = createTestDb();
    app = buildApp({ db, timeZone: 'Asia/Kolkata', trustLoopback: false });
    expect((await app.inject({ method: 'GET', url: '/v1/device', headers: { [HOST_KEY_HEADER]: KEY } })).statusCode).toBe(401);
  });
});
