import { randomBytes } from 'node:crypto';
import { newId } from '@dinepos/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildApp, type DinePosApp } from '../app.js';
import { ensureBusinessDay } from '../core/business-day.js';
import type { Db } from '../db/connection.js';
import { CLOSE, rawText } from '../realtime/hub.js';
import { DEV_OWNER, devSeedCommands, devSetupCommand, seedId } from '../seed/dev-seed.js';
import { createTestDb } from '../testing/test-db.js';
import { resetApprovalLimiter } from './approval.js';
import { deviceTokenHash } from './devices.js';

// P2-02 acceptance: an unpaired device gets 401; revoke works instantly. The app runs with loopback NOT trusted, so
// every request here must prove its device, as from another PC on the shop network.
const now = () => new Date('2026-11-03T08:00:00Z');
let db: Db;
let app: DinePosApp;
let ownerDevice: string; // a paired device token (the manager's terminal)
let owner: string; // a sign-in on it

/** Pairs a device straight in the database (the first terminal in a test). */
function seedDevice(name: string): string {
  const token = randomBytes(32).toString('base64url');
  db.prepare("INSERT INTO device (id, name, kind, token_hash, paired_at) VALUES (?, ?, 'terminal', ?, ?)").run(newId(), name, deviceTokenHash(token), now().toISOString());
  return token;
}
const dev = (token: string) => ({ authorization: `Device ${token}` });

async function send(type: string, payload: unknown, headers: Record<string, string>) {
  const res = await app.inject({ method: 'POST', url: '/v1/commands', headers, payload: { commandId: newId(), type, payload, createdAt: now().toISOString() } });
  return { status: res.statusCode, body: res.json<{ ok: boolean; error?: { code: string; details?: Record<string, unknown> }; result?: Record<string, unknown> }>() };
}
const signIn = async (deviceToken: string, userId = DEV_OWNER.id, pin = '1234') =>
  (await app.inject({ method: 'POST', url: '/v1/sessions', headers: dev(deviceToken), payload: { userId, pin } })).json<{ token: string }>().token;

beforeEach(async () => {
  resetApprovalLimiter();
  db = createTestDb();
  ensureBusinessDay(db, 'Asia/Kolkata', now);
  app = buildApp({ db, timeZone: 'Asia/Kolkata', now, trustLoopback: false, hub: { helloTimeoutMs: 2000 } });
  ownerDevice = seedDevice('Counter 1');
  await send(devSetupCommand().type, devSetupCommand().payload, dev(ownerDevice));
  owner = await signIn(ownerDevice);
  for (const c of devSeedCommands()) await send(c.type, c.payload, { ...dev(ownerDevice), 'x-user-session': owner });
});
afterEach(async () => {
  await app.close();
  db.close();
});

/** A new device asks to pair; returns its code and how to collect the token. */
async function request(name = 'Counter 2') {
  const r = (await app.inject({ method: 'POST', url: '/v1/pairing-requests', payload: { name } })).json<{ requestId: string; secret: string; code: string }>();
  const collect = async () => (await app.inject({ method: 'POST', url: `/v1/pairing-requests/${r.requestId}/collect`, payload: { secret: r.secret } })).json<{ status: string; deviceToken?: string; deviceId?: string }>();
  return { ...r, collect };
}

describe('device pairing', () => {
  it('an unpaired device gets 401 everywhere except health and pairing (acceptance)', async () => {
    for (const url of ['/v1/floor', '/v1/menu', '/v1/setup-state', '/v1/config', '/v1/orders/01JX0000000000000000000000']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
      expect(res.json<{ error: { details: { reason: string } } }>().error.details.reason).toBe('device_not_paired');
    }
    expect((await app.inject({ method: 'GET', url: '/v1/floor', headers: { authorization: 'Device not-a-real-token-at-all-xxxx' } })).statusCode).toBe(401);
    expect((await send('OpenTable', { tableId: seedId('table:main:1'), covers: 2 }, {})).status).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/health' })).statusCode).toBe(200);
  });

  it('pair: code on the new device, a manager approves with a PIN, the device collects its token once', async () => {
    const r = await request('Bar terminal');
    expect(r.code).toMatch(/^\d{6}$/);
    expect(await r.collect()).toEqual({ status: 'pending' });
    const approve = (pin?: string) => send('PairDevice', { code: r.code }, { ...dev(ownerDevice), 'x-user-session': owner, ...(pin ? { 'x-manager-pin': pin } : {}) });
    expect((await approve()).body.error?.code).toBe('PIN_REQUIRED'); // a PIN even for the Owner
    const ok = await approve('1234');
    expect(ok.body.result).toMatchObject({ name: 'Bar terminal', kind: 'terminal' });
    const got = await r.collect();
    expect(got).toMatchObject({ status: 'paired', deviceId: ok.body.result!.deviceId });
    expect(await r.collect()).toEqual({ status: 'expired' }); // handed out once
    expect((await app.inject({ method: 'GET', url: '/v1/floor', headers: dev(got.deviceToken!) })).statusCode).toBe(200);
    // Sessions are tied to the device they were made on.
    await signIn(got.deviceToken!);
    expect(db.prepare('SELECT count(*) FROM user_session WHERE device_id = ?').pluck().get(got.deviceId)).toBe(1);
    expect(db.prepare('SELECT token_hash FROM device WHERE id = ?').pluck().get(got.deviceId)).toBe(deviceTokenHash(got.deviceToken!)); // only the hash
  });

  it('a wrong or expired code is refused; the master PC and the device itself cannot be revoked', async () => {
    const h = { ...dev(ownerDevice), 'x-user-session': owner, 'x-manager-pin': '1234' };
    expect((await send('PairDevice', { code: '000000' }, h)).body.error?.code).toBe('NOT_FOUND'); // nothing is waiting
    const r = await request();
    db.prepare("UPDATE pairing_request SET expires_at = '2000-01-01T00:00:00Z'").run();
    expect((await send('PairDevice', { code: r.code }, h)).body.error?.code).toBe('NOT_FOUND');
    expect((await send('RevokeDevice', { deviceId: '01JD0000000000000000000001' }, h)).body.error?.code).toBe('INVALID_STATE');
    const self = db.prepare('SELECT id FROM device WHERE name = ?').pluck().get('Counter 1') as string;
    expect((await send('RevokeDevice', { deviceId: self }, h)).body.error?.code).toBe('INVALID_STATE');
  });

  it('revoke works instantly: requests get 401, sign-ins end and the live stream closes (acceptance)', async () => {
    const r = await request('Captain phone');
    await send('PairDevice', { code: r.code }, { ...dev(ownerDevice), 'x-user-session': owner, 'x-manager-pin': '1234' });
    const { deviceToken, deviceId } = (await r.collect()) as { deviceToken: string; deviceId: string };
    await signIn(deviceToken, seedId('user:captain'), '3333');

    const url = (await app.listen({ host: '127.0.0.1', port: 0 })).replace('http', 'ws');
    const ws = new WebSocket(`${url}/v1/stream`);
    const messages: Array<{ type?: string }> = [];
    ws.on('message', (raw) => messages.push(JSON.parse(rawText(raw)) as { type?: string }));
    const closed = new Promise<number>((res) => ws.on('close', (code) => res(code)));
    await new Promise((res) => ws.once('open', res));
    ws.send(JSON.stringify({ type: 'hello', deviceToken, resumeFrom: null, topics: ['floor'] }));
    await expect.poll(() => messages.some((m) => m.type === 'ready')).toBe(true);

    const res = await send('RevokeDevice', { deviceId }, { ...dev(ownerDevice), 'x-user-session': owner });
    expect(res.body.result).toEqual({ deviceId, sessionsEnded: 1 });
    expect(await closed).toBe(CLOSE.REVOKED);
    expect((await app.inject({ method: 'GET', url: '/v1/floor', headers: dev(deviceToken) })).statusCode).toBe(401);
  });

  it('a stream hello without a valid device token is refused', async () => {
    const url = (await app.listen({ host: '127.0.0.1', port: 0 })).replace('http', 'ws');
    const ws = new WebSocket(`${url}/v1/stream`);
    const closed = new Promise<number>((res) => ws.on('close', (code) => res(code)));
    await new Promise((res) => ws.once('open', res));
    ws.send(JSON.stringify({ type: 'hello', deviceToken: null, resumeFrom: null, topics: ['floor'] }));
    expect(await closed).toBe(CLOSE.UNPAIRED);
  });
});
