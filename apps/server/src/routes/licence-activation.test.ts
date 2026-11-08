import { generateKeyPairSync, sign } from 'node:crypto';
import { newId } from '@dinepos/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { currentBusinessDate } from '../core/business-day.js';
import type { Db } from '../db/connection.js';
import { createLicenceGate } from '../licence/gate.js';
import { DEV_OWNER, DEV_STAFF, devSeedCommands, devSetupCommand, seedId } from '../seed/dev-seed.js';
import { createTestDb } from '../testing/test-db.js';

// P7-03: Settings › Licence › Start free trial / Sign in, through a stand-in DinePOS Cloud.
const HW = 'AB12-CD34-EF56-7890-1A2B';
const cloudKey = generateKeyPairSync('ed25519');
const DAY = 86_400_000;

function trialKey(days = 14): string {
  const issuedAt = new Date();
  const payload = { v: 1, kid: 'cloud', licensee: 'Spice Garden', hardwareId: HW, issuedAt: issuedAt.toISOString(), expiresAt: new Date(issuedAt.getTime() + days * DAY).toISOString(), seats: { terminals: 1, captains: 1, kds: 1 }, features: [] };
  const body = Buffer.from(JSON.stringify(payload));
  return `${body.toString('base64url')}.${sign(null, body, cloudKey.privateKey).toString('base64url')}`;
}

let db: Db;
let app: ReturnType<typeof buildApp>;
let owner = '';
let cashier = '';
let calls: Array<{ url: string; body: Record<string, unknown> }> = [];
let answer: () => Promise<Response> = () => Promise.resolve(new Response('{}'));

beforeEach(async () => {
  calls = [];
  db = createTestDb();
  const fakeFetch = ((url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/v1/activate')) {
      calls.push({ url: u, body: JSON.parse(init?.body as string) as Record<string, unknown> });
      return answer();
    }
    return Promise.resolve(new Response('{}', { status: 404 }));
  }) as typeof fetch;
  app = buildApp({
    db, timeZone: 'Asia/Kolkata', trustLoopback: true, cloudUrl: 'https://cloud.test', onlineFetch: fakeFetch,
    licence: createLicenceGate({ keys: [{ id: 'cloud', publicKey: cloudKey.publicKey, maxDays: 400 }], hardwareId: HW }),
  });
  const send = async (type: string, payload: unknown, token?: string) =>
    (await app.inject({ method: 'POST', url: '/v1/commands', headers: token ? { 'x-user-session': token } : {}, payload: { commandId: newId(), type, payload, createdAt: new Date().toISOString() } })).json<{ ok: boolean }>();
  await send(devSetupCommand().type, devSetupCommand().payload);
  owner = (await app.inject({ method: 'POST', url: '/v1/sessions', payload: { userId: DEV_OWNER.id, pin: DEV_OWNER.pin } })).json<{ token: string }>().token;
  for (const c of devSeedCommands()) await send(c.type, c.payload, owner);
  const c = DEV_STAFF.find((s) => s.key === 'cashier')!;
  cashier = (await app.inject({ method: 'POST', url: '/v1/sessions', payload: { userId: seedId('user:cashier'), pin: c.pin } })).json<{ token: string }>().token;
});
afterEach(async () => {
  await app.close();
  db.close();
});

const activate = (payload: Record<string, unknown>, token = owner) => app.inject({ method: 'POST', url: '/v1/licence/activate', headers: { 'x-user-session': token }, payload });
const ok = (j: unknown) => () => Promise.resolve(new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } }));

describe('licence activation through DinePOS Cloud (P7-03)', () => {
  it('a trial: the cloud gets this PC’s hardware id and outlet name; the key is installed, a day opens, the outlet is linked', async () => {
    answer = ok({ kind: 'trial', key: trialKey(), expiresAt: Date.now() + 14 * DAY, store: { slug: 'spice-garden-1234', name: 'Spice Garden' }, deviceKey: 'tpk_device-key' });
    expect(currentBusinessDate(db)).toBeNull();
    const r = await activate({ mode: 'trial', email: 'asha@spicegarden.in', password: 'tandoor-2026' });
    expect(r.statusCode).toBe(200);
    const j = r.json<{ kind: string; linked: boolean; licence: { state: string; seats: unknown } }>();
    expect(j).toMatchObject({ kind: 'trial', linked: true, licence: { state: 'expiring', seats: { terminals: 1, captains: 1, kds: 1 } } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://cloud.test/v1/activate');
    expect(calls[0]!.body).toMatchObject({ mode: 'trial', email: 'asha@spicegarden.in', hardwareId: HW, link: true });
    expect(typeof calls[0]!.body.outletName).toBe('string');
    expect(currentBusinessDate(db)).not.toBeNull();
    const link = db.prepare('SELECT hub_url, device_key, store_slug FROM online_link WHERE id = 1').get();
    expect(link).toEqual({ hub_url: 'https://cloud.test', device_key: 'tpk_device-key', store_slug: 'spice-garden-1234' });
    // the password is passed through only: never in the database or the audit log
    const dump = JSON.stringify(db.prepare('SELECT * FROM audit_event').all()) + JSON.stringify(db.prepare('SELECT * FROM config').all());
    expect(dump).not.toContain('tandoor-2026');
    // signing in again: already linked, so no new device key is asked for
    answer = ok({ kind: 'trial', key: trialKey(), store: { slug: 'spice-garden-1234', name: 'Spice Garden' }, deviceKey: null });
    await activate({ mode: 'signin', email: 'asha@spicegarden.in', password: 'tandoor-2026' });
    expect(calls[1]!.body.link).toBe(false);
  });

  it('the cloud’s refusal is shown as it says; no internet says to connect or paste a key; nothing installed', async () => {
    answer = () => Promise.resolve(new Response(JSON.stringify({ error: { code: 'TRIAL_USED', message: 'This PC has already had a free trial.' } }), { status: 409 }));
    const used = await activate({ mode: 'trial', email: 'a@b.in', password: 'x' });
    expect(used.statusCode).toBe(422);
    expect(used.json()).toMatchObject({ error: { code: 'INVALID_STATE', message: 'This PC has already had a free trial.', details: { reason: 'trial_used' } } });
    answer = () => Promise.resolve(new Response(JSON.stringify({ error: { code: 'BAD_LOGIN', message: 'The email or password is not right.' } }), { status: 401 }));
    expect((await activate({ mode: 'signin', email: 'a@b.in', password: 'x' })).json()).toMatchObject({ error: { code: 'VALIDATION', message: 'The email or password is not right.' } });
    answer = () => Promise.reject(new TypeError('fetch failed'));
    const offline = await activate({ mode: 'trial', email: 'a@b.in', password: 'x' });
    expect(offline.json()).toMatchObject({ error: { code: 'INVALID_STATE', details: { reason: 'cloud_unreachable' } } });
    expect(offline.json<{ error: { message: string } }>().error.message).toMatch(/Connect this PC to the internet to activate, or paste a licence key/);
    // a key that is not genuine is refused by InstallLicence, as when pasted
    answer = ok({ kind: 'trial', key: `${trialKey().split('.')[0]}.AAAA`, store: { slug: 's', name: 'S' }, deviceKey: 'k' });
    expect((await activate({ mode: 'trial', email: 'a@b.in', password: 'x' })).json()).toMatchObject({ error: { code: 'VALIDATION' } });
    expect(db.prepare('SELECT licence_key FROM licence WHERE id = 1').pluck().get()).toBeNull();
    expect(db.prepare('SELECT device_key FROM online_link WHERE id = 1').pluck().get()).toBeNull();
  });

  it('needs the admin right (a cashier cannot) and an email and password', async () => {
    answer = ok({ kind: 'trial', key: trialKey(), store: { slug: 's', name: 'S' }, deviceKey: 'k' });
    expect((await activate({ mode: 'trial', email: 'a@b.in', password: 'x' }, cashier)).json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect((await activate({ mode: 'trial', email: '', password: '' })).json()).toMatchObject({ error: { code: 'VALIDATION' } });
    expect(calls).toHaveLength(0);
  });
});
