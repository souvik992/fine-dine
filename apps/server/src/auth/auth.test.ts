import { CASHIER_ROLE_ID, MANAGER_ROLE_ID, newId, OWNER_ROLE_ID, RIGHTS } from '@dinepos/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { ensureBusinessDay } from '../core/business-day.js';
import type { Db } from '../db/connection.js';
import { DEV_OWNER, devSeedCommands, devSetupCommand, seedId } from '../seed/dev-seed.js';
import { createTestDb } from '../testing/test-db.js';
import { resetApprovalLimiter } from './approval.js';
import { hashPin, verifyPin } from './pin.js';

// P2-01 acceptance: FORBIDDEN and PIN_REQUIRED paths, plus sign-in, lockout and staff rules.

let clock = new Date('2026-11-02T08:00:00Z');
const now = () => clock;
let db: Db;
let app: FastifyInstance;

const ids = {
  owner: DEV_OWNER.id,
  manager: seedId('user:manager'),
  cashier: seedId('user:cashier'),
  captain: seedId('user:captain'),
  t1: seedId('table:main:1'),
  dal: seedId('item:DM'),
};

beforeEach(() => {
  clock = new Date('2026-11-02T08:00:00Z');
  resetApprovalLimiter();
  db = createTestDb();
  ensureBusinessDay(db, 'Asia/Kolkata', now);
  app = buildApp({ db, timeZone: 'Asia/Kolkata', now });
});
afterEach(async () => {
  await app.close();
  db.close();
});

async function send(type: string, payload: unknown, opts: { token?: string; pin?: string; orderId?: string; expectedVersion?: number } = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/commands',
    headers: { ...(opts.token ? { 'x-user-session': opts.token } : {}), ...(opts.pin ? { 'x-manager-pin': opts.pin } : {}) },
    payload: {
      commandId: newId(),
      type,
      payload,
      createdAt: '2026-11-02T13:30:00+05:30',
      ...(opts.orderId ? { orderId: opts.orderId, expectedVersion: opts.expectedVersion } : {}),
    },
  });
  return { status: res.statusCode, body: res.json<{ ok: boolean; error?: { code: string; message: string; details?: Record<string, unknown> }; order?: { id: string; version: number }; result?: Record<string, unknown> }>() };
}

async function login(userId: string, pin: string) {
  const res = await app.inject({ method: 'POST', url: '/v1/sessions', payload: { userId, pin } });
  return { status: res.statusCode, body: res.json<{ token: string; rights: Array<{ right: string; needsPin: boolean }>; error?: { message: string; details?: Record<string, unknown> } }>() };
}

/** The demo outlet with its staff (owner 1234, manager 2345, cashier 1111, captain 3333). */
async function seeded(): Promise<string> {
  await send(devSetupCommand().type, devSetupCommand().payload);
  const owner = (await login(ids.owner, '1234')).body.token;
  for (const c of devSeedCommands()) expect((await send(c.type, c.payload, { token: owner })).body.ok).toBe(true);
  return owner;
}

describe('first-run setup', () => {
  it('is offered while no staff exist, creates the owner once, then is refused', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/setup-state' })).json()).toMatchObject({ setupNeeded: true, users: [] });
    expect((await send(devSetupCommand().type, devSetupCommand().payload)).body.ok).toBe(true);
    const state = (await app.inject({ method: 'GET', url: '/v1/setup-state' })).json<{ setupNeeded: boolean; outletName: string; users: Array<Record<string, unknown>> }>();
    expect(state).toMatchObject({ setupNeeded: false, outletName: 'Spice Garden (DEMO)', users: [{ id: ids.owner, name: 'Asha (Owner)', roleName: 'Owner' }] });
    expect(JSON.stringify(state)).not.toMatch(/pin|hash/i);
    // Once staff exist, setup needs a session like everything else.
    expect((await send(devSetupCommand().type, devSetupCommand().payload)).status).toBe(401);
  });

  it('every other command needs a session (UNAUTHENTICATED)', async () => {
    await seeded();
    const r = await send('OpenTable', { tableId: ids.t1, covers: 2 });
    expect(r.status).toBe(401);
    expect(r.body.error?.code).toBe('UNAUTHENTICATED');
  });
});

describe('sign-in and sessions', () => {
  it('signs in with name + PIN, returns rights, and signs out', async () => {
    await seeded();
    const r = await login(ids.cashier, '1111');
    expect(r.status).toBe(200);
    expect(r.body.rights).toContainEqual({ right: 'bill.print', needsPin: false });
    expect(r.body.rights).toContainEqual({ right: 'reprint', needsPin: true });
    expect(r.body.rights.some((x) => x.right === 'admin')).toBe(false);
    const me = await app.inject({ method: 'GET', url: '/v1/session', headers: { 'x-user-session': r.body.token } });
    expect(me.json()).toMatchObject({ user: { id: ids.cashier, roleName: 'Cashier' }, discountLimitBp: 1000 });
    await app.inject({ method: 'DELETE', url: '/v1/session', headers: { 'x-user-session': r.body.token } });
    expect((await app.inject({ method: 'GET', url: '/v1/session', headers: { 'x-user-session': r.body.token } })).statusCode).toBe(401);
    expect(db.prepare("SELECT action FROM audit_event WHERE entity = 'user' AND entity_id = ? ORDER BY seq").pluck().all(ids.cashier)).toEqual(['user.create', 'auth.login', 'auth.logout']);
  });

  it('stores only a hash of the session token', async () => {
    await seeded();
    const { token } = (await login(ids.cashier, '1111')).body;
    expect(JSON.stringify(db.prepare('SELECT * FROM user_session').all())).not.toContain(token);
  });

  it('locks a person for 5 minutes after 5 wrong PINs, even against the right PIN', async () => {
    await seeded();
    for (let i = 1; i <= 4; i++) expect((await login(ids.cashier, '9999')).body.error?.details).toMatchObject({ attemptsLeft: 5 - i });
    const fifth = await login(ids.cashier, '9999');
    expect(fifth.body.error?.message).toMatch(/locked for 5 minutes/);
    expect((await login(ids.cashier, '1111')).status).toBe(401);
    expect(db.prepare("SELECT count(*) FROM audit_event WHERE action = 'auth.lock'").pluck().get()).toBe(1);
    clock = new Date(clock.getTime() + 5 * 60_000 + 1_000);
    expect((await login(ids.cashier, '1111')).status).toBe(200);
  });

  it('a session expires 12 hours after its last use', async () => {
    await seeded();
    const { token } = (await login(ids.cashier, '1111')).body;
    clock = new Date(clock.getTime() + 11 * 3_600_000);
    expect((await app.inject({ method: 'GET', url: '/v1/session', headers: { 'x-user-session': token } })).statusCode).toBe(200); // slides
    clock = new Date(clock.getTime() + 12 * 3_600_000 + 1_000);
    expect((await app.inject({ method: 'GET', url: '/v1/session', headers: { 'x-user-session': token } })).statusCode).toBe(401);
  });
});

describe('rights (docs/07)', () => {
  it('FORBIDDEN when the role lacks the right', async () => {
    await seeded();
    const cashier = (await login(ids.cashier, '1111')).body.token;
    const r = await send('SetConfig', { values: { 'outlet.name': 'Nope' } }, { token: cashier });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatchObject({ code: 'FORBIDDEN', details: { right: 'admin' } });
  });

  it('PIN_REQUIRED for a right marked "needs PIN"; a manager PIN approves and is recorded', async () => {
    const owner = await seeded();
    // Make "open orders" need a PIN for cashiers, to exercise the rule with an existing command.
    const rights = RIGHTS.filter((x) => ['order.create', 'order.edit', 'kot.fire', 'bill.print', 'bill.settle'].includes(x)).map((right) => ({ right, needsPin: right === 'order.create' }));
    expect((await send('UpsertRole', { id: CASHIER_ROLE_ID, name: 'Cashier', discountLimitBp: 1000, rights }, { token: owner })).body.ok).toBe(true);
    const cashier = (await login(ids.cashier, '1111')).body.token;

    const missing = await send('OpenTable', { tableId: ids.t1, covers: 2 }, { token: cashier });
    expect(missing.status).toBe(401);
    expect(missing.body.error).toMatchObject({ code: 'PIN_REQUIRED', details: { right: 'order.create', reason: 'pin_missing' } });
    expect((await send('OpenTable', { tableId: ids.t1, covers: 2 }, { token: cashier, pin: '1111' })).body.error?.details).toMatchObject({ reason: 'pin_wrong' });

    const ok = await send('OpenTable', { tableId: ids.t1, covers: 2 }, { token: cashier, pin: '2345' });
    expect(ok.body.ok).toBe(true);
    expect(db.prepare("SELECT user_id, approved_by FROM audit_event WHERE action = 'order.open'").get()).toEqual({ user_id: ids.cashier, approved_by: ids.manager });
  });

  it('stops trying manager PINs after 5 wrong ones a minute', async () => {
    const owner = await seeded();
    await send('UpsertRole', { id: CASHIER_ROLE_ID, name: 'Cashier', discountLimitBp: 1000, rights: [{ right: 'order.create', needsPin: true }] }, { token: owner });
    const cashier = (await login(ids.cashier, '1111')).body.token;
    for (let i = 0; i < 5; i++) await send('OpenTable', { tableId: ids.t1, covers: 2 }, { token: cashier, pin: `00${i}0` });
    const r = await send('OpenTable', { tableId: ids.t1, covers: 2 }, { token: cashier, pin: '2345' });
    expect(r.body.error?.details).toMatchObject({ reason: 'too_many_tries' });
  });

  it('a discount above the role limit needs a PIN from someone whose limit covers it, and is flagged', async () => {
    const owner = await seeded();
    const open = await send('OpenTable', { tableId: ids.t1, covers: 2 }, { token: owner });
    const orderId = open.body.order!.id;
    const added = await send('AddItems', { items: [{ id: newId(), itemId: ids.dal, qty: 2 }] }, { token: owner, orderId, expectedVersion: 1 });
    await send('FireKOT', { all: true }, { token: owner, orderId, expectedVersion: added.body.order!.version });
    const cashier = (await login(ids.cashier, '1111')).body.token;
    const bill = (pct: number, pin?: string) =>
      send('PrintBill', { discount: { kind: 'pct', value: pct * 100, reason: 'Regular guest' } }, { token: cashier, orderId, expectedVersion: 3, ...(pin ? { pin } : {}) });

    expect((await bill(15)).body.error).toMatchObject({ code: 'PIN_REQUIRED', details: { discountBp: 1500 } }); // cashier limit 10%
    expect((await bill(25, '2345')).body.error?.code).toBe('PIN_REQUIRED'); // manager limit 20% does not cover 25%
    const ok = await bill(15, '2345');
    expect(ok.body.ok).toBe(true);
    expect(db.prepare("SELECT approved_by, leakage_flag FROM audit_event WHERE action = 'bill.print'").get()).toEqual({ approved_by: ids.manager, leakage_flag: 1 });
  });
});

describe('staff and roles', () => {
  it('needs "manage staff": managers get FORBIDDEN, owners can add people', async () => {
    const owner = await seeded();
    const manager = (await login(ids.manager, '2345')).body.token;
    const person = { id: newId(), name: 'Imran', roleId: CASHIER_ROLE_ID, pin: '4321' };
    expect((await send('UpsertUser', person, { token: manager })).body.error?.code).toBe('FORBIDDEN');
    expect((await app.inject({ method: 'GET', url: '/v1/staff', headers: { 'x-user-session': manager } })).statusCode).toBe(403);
    expect((await send('UpsertUser', person, { token: owner })).body.ok).toBe(true);
    expect((await login(person.id, '4321')).status).toBe(200);
    const staff = (await app.inject({ method: 'GET', url: '/v1/staff', headers: { 'x-user-session': owner } })).json<{ staff: unknown[] }>().staff;
    expect(staff).toHaveLength(5);
    expect(JSON.stringify(staff)).not.toMatch(/pin_hash|s1\$/);
  });

  it('refuses a PIN or name already in use, and a new person without a PIN', async () => {
    const owner = await seeded();
    expect((await send('UpsertUser', { id: newId(), name: 'Zoya', roleId: CASHIER_ROLE_ID, pin: '1111' }, { token: owner })).body.error?.message).toMatch(/already uses this PIN/);
    expect((await send('UpsertUser', { id: newId(), name: 'meena (cashier)', roleId: CASHIER_ROLE_ID, pin: '7777' }, { token: owner })).body.error?.message).toMatch(/already on the staff list/);
    expect((await send('UpsertUser', { id: newId(), name: 'Zoya', roleId: CASHIER_ROLE_ID }, { token: owner })).body.error?.code).toBe('VALIDATION');
  });

  it('a new PIN unlocks the person and signs them out everywhere', async () => {
    const owner = await seeded();
    const old = (await login(ids.cashier, '1111')).body.token;
    for (let i = 0; i < 5; i++) await login(ids.cashier, '0000');
    expect((await send('UpsertUser', { id: ids.cashier, name: 'Meena (Cashier)', roleId: CASHIER_ROLE_ID, pin: '5555' }, { token: owner })).body.ok).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/v1/session', headers: { 'x-user-session': old } })).statusCode).toBe(401);
    expect((await login(ids.cashier, '5555')).status).toBe(200);
  });

  it('nobody can deactivate themselves; the last person who manages staff is protected', async () => {
    const owner = await seeded();
    expect((await send('UpsertUser', { id: ids.owner, name: 'Asha (Owner)', roleId: OWNER_ROLE_ID, active: false }, { token: owner })).body.error?.message).toMatch(/cannot deactivate yourself/);
    // With a second owner, Asha can be made a manager by that owner.
    const second = { id: newId(), name: 'Rahul', roleId: OWNER_ROLE_ID, pin: '8888' };
    await send('UpsertUser', second, { token: owner });
    const rahul = (await login(second.id, '8888')).body.token;
    expect((await send('UpsertUser', { id: ids.owner, name: 'Asha (Owner)', roleId: MANAGER_ROLE_ID }, { token: rahul })).body.ok).toBe(true);
    // Now Rahul is the only owner; Asha (manager) cannot touch users, and Rahul cannot demote himself.
    expect((await send('UpsertUser', { id: second.id, name: 'Rahul', roleId: MANAGER_ROLE_ID }, { token: rahul })).body.error?.code).toBe('INVALID_STATE');
  });

  it('the Owner role keeps "manage staff"; roles are listed with members and rights', async () => {
    const owner = await seeded();
    const r = await send('UpsertRole', { id: OWNER_ROLE_ID, name: 'Owner', discountLimitBp: 10_000, rights: [{ right: 'admin', needsPin: false }] }, { token: owner });
    expect(r.body.error?.message).toMatch(/must keep/);
    const roles = (await app.inject({ method: 'GET', url: '/v1/roles', headers: { 'x-user-session': owner } })).json<{ roles: Array<{ name: string; members: number; rights: unknown[] }> }>().roles;
    expect(roles.map((x) => [x.name, x.members])).toEqual([
      ['Owner', 1],
      ['Manager', 1],
      ['Cashier', 1],
      ['Captain', 1],
      ['Kitchen', 0],
    ]);
    expect(roles[0]!.rights).toHaveLength(RIGHTS.length);
  });
});

describe('PIN hashing', () => {
  it('uses a salted scrypt hash and checks it', () => {
    const a = hashPin('1234', 1024);
    expect(a).toMatch(/^s1\$1024\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(hashPin('1234', 1024)).not.toBe(a);
    expect(verifyPin('1234', a)).toBe(true);
    expect(verifyPin('1235', a)).toBe(false);
    expect(verifyPin('12', a)).toBe(false);
  });
});
