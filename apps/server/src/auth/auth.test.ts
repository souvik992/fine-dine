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
  }, 20_000); // each wrong PIN is checked against every manager's scrypt hash

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

describe('settings reads and test print', () => {
  it('GET /v1/admin/catalog needs admin and includes inactive items and station printers', async () => {
    const owner = await seeded();
    const cashier = (await login(ids.cashier, '1111')).body.token;
    expect((await app.inject({ method: 'GET', url: '/v1/admin/catalog', headers: { 'x-user-session': cashier } })).statusCode).toBe(403);
    await send('UpsertMenuItem', { id: ids.dal, categoryId: seedId('category:mains'), name: 'Dal Makhani', veg: true, basePricePaise: 28_000, taxRateBp: 500, active: false }, { token: owner });
    const cat = (await app.inject({ method: 'GET', url: '/v1/admin/catalog', headers: { 'x-user-session': owner } })).json<{
      items: Array<{ id: string; active: boolean }>;
      stations: Array<{ name: string; printerIds: string[] }>;
      tables: unknown[];
      printers: unknown[];
    }>();
    expect(cat.items).toHaveLength(30);
    expect(cat.items.find((i) => i.id === ids.dal)?.active).toBe(false);
    expect(cat.stations.find((s) => s.name === 'Kitchen')?.printerIds).toEqual([seedId('printer:kitchen')]);
    expect(cat.tables).toHaveLength(12);
    expect(cat.printers).toHaveLength(4);
  });

  it('PrintTestPage queues a test page on that printer', async () => {
    const owner = await seeded();
    const r = await send('PrintTestPage', { printerId: seedId('printer:bill') }, { token: owner });
    expect(r.body.ok).toBe(true);
    const job = db.prepare("SELECT printer_id, preview_text FROM print_job WHERE doc_kind = 'test'").get() as { printer_id: string; preview_text: string };
    expect(job.printer_id).toBe(seedId('printer:bill'));
    expect(job.preview_text).toContain('DinePOS test page');
    expect(job.preview_text).toContain('If you can read this, the printer works.');
  });
});

describe('stock reads', () => {
  it('need stock.manage: Owner and Manager may read, a Cashier or no session gets 403', async () => {
    const owner = await seeded();
    const cashier = (await login(ids.cashier, '1111')).body.token;
    const manager = (await login(ids.manager, '2345')).body.token;
    for (const url of ['/v1/stock', '/v1/purchases', '/v1/recipes', '/v1/stock/usage?from=2026-11-01&to=2026-11-02']) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(401);
      expect((await app.inject({ method: 'GET', url, headers: { 'x-user-session': cashier } })).statusCode, url).toBe(403);
      expect((await app.inject({ method: 'GET', url, headers: { 'x-user-session': manager } })).statusCode, url).toBe(200);
    }
    const id = newId();
    expect((await send('UpsertStockItem', { id, name: 'Ghee', unit: 'kg', opening: { qtyMilli: 2000, unitCostPaise: 60_000 } }, { token: owner })).body.ok).toBe(true);
    const stock = (await app.inject({ method: 'GET', url: '/v1/stock', headers: { 'x-user-session': owner } })).json<{ items: Array<{ id: string; onHandMilli: number; valuePaise: number }> }>();
    expect(stock.items.find((s) => s.id === id)).toMatchObject({ onHandMilli: 2000, valuePaise: 120_000 });
    const moves = (await app.inject({ method: 'GET', url: `/v1/stock/${id}/movements`, headers: { 'x-user-session': owner } })).json<{ movements: Array<{ kind: string; userName: string }> }>();
    expect(moves.movements).toMatchObject([{ kind: 'opening', userName: 'Asha (Owner)' }]);
    expect((await app.inject({ method: 'GET', url: '/v1/stock/usage?from=2026-11-03&to=2026-11-01', headers: { 'x-user-session': owner } })).statusCode).toBe(400);
  });

  it('a Cashier may mark an item sold out (menu.stock) but not record a purchase', async () => {
    await seeded();
    const cashier = (await login(ids.cashier, '1111')).body.token;
    expect((await send('SetItemAvailability', { itemId: ids.dal, available: false }, { token: cashier })).body.ok).toBe(true);
    const r = await send('RecordPurchase', { id: newId(), supplierName: 'X', lines: [{ stockItemId: newId(), qtyMilli: 1, unitCostPaise: 1 }] }, { token: cashier });
    expect(r.body.error?.code).toBe('FORBIDDEN');
  });
});

describe('bill design (Settings › Bill design)', () => {
  const logo = { width: 16, height: 8, bits: '/////////////////////w==' }; // 16 bytes, all black

  it('POST /v1/bill-preview renders the sample bill with unsaved settings; admin only; nothing is stored', async () => {
    const owner = await seeded();
    const cashier = (await login(ids.cashier, '1111')).body.token;
    const preview = (token: string, body: Record<string, unknown>) => app.inject({ method: 'POST', url: '/v1/bill-preview', headers: { 'x-user-session': token }, payload: body });
    expect((await preview(cashier, { widthMm: 80 })).statusCode).toBe(403);
    const plain = (await preview(owner, { widthMm: 80 })).json<{ preview: string }>().preview;
    expect(plain).toContain('SAMPLE - NOT A BILL');
    expect(plain).toContain('Captain: Ravi');
    const changed = (
      await preview(owner, { widthMm: 58, config: { 'bill.display': { showCaptain: false, headerLines: ['A unit of Spice Hospitality'] }, 'bill.logo': logo } })
    ).json<{ preview: string }>().preview;
    expect(changed).not.toContain('Captain');
    expect(changed).toContain('A unit of Spice Hospitality');
    expect(changed).toContain('[logo]');
    expect((await preview(owner, { widthMm: 80, config: { 'bill.display': { hideGstin: true } } })).statusCode).toBe(400);
    expect(db.prepare("SELECT count(*) FROM config WHERE key LIKE 'bill.display%' OR key = 'bill.logo'").pluck().get()).toBe(0);
    expect(db.prepare('SELECT count(*) FROM bill').pluck().get()).toBe(0);
  });

  it('PrintSampleBill prints the saved design on the chosen printer without taking a bill number', async () => {
    const owner = await seeded();
    expect((await send('SetConfig', { values: { 'bill.display': { showCashier: false }, 'bill.logo': logo } }, { token: owner })).body.ok).toBe(true);
    const r = await send('PrintSampleBill', { printerId: seedId('printer:bill') }, { token: owner });
    expect(r.body.ok).toBe(true);
    const job = db.prepare("SELECT preview_text FROM print_job WHERE doc_kind = 'test'").pluck().get() as string;
    expect(job).toContain('SAMPLE - NOT A BILL');
    expect(job).toContain('[logo]');
    expect(job).not.toContain('Cashier');
    expect(db.prepare("SELECT value FROM counter WHERE name LIKE 'bill_no:%'").pluck().get()).toBeUndefined();
    const cashier = (await login(ids.cashier, '1111')).body.token;
    expect((await send('PrintSampleBill', { printerId: seedId('printer:bill') }, { token: cashier })).body.error?.code).toBe('FORBIDDEN');
    expect((await send('PrintSampleBill', { printerId: newId() }, { token: owner })).body.error?.code).toBe('NOT_FOUND');
  });

  it('PrintBill uses the saved display settings and logo, and stores them with the bill', async () => {
    const owner = await seeded();
    await send('SetConfig', { values: { 'bill.display': { showCaptain: false, showItemCount: true }, 'bill.logo': logo } }, { token: owner });
    const open = await send('OpenTable', { tableId: ids.t1, covers: 2 }, { token: owner });
    const orderId = open.body.order!.id;
    const added = await send('AddItems', { items: [{ id: newId(), itemId: ids.dal, qty: 2 }] }, { token: owner, orderId, expectedVersion: 1 });
    await send('FireKOT', { all: true }, { token: owner, orderId, expectedVersion: added.body.order!.version });
    expect((await send('PrintBill', {}, { token: owner, orderId, expectedVersion: 3 })).body.ok).toBe(true);
    const job = db.prepare("SELECT preview_text FROM print_job WHERE doc_kind = 'bill'").pluck().get() as string;
    expect(job).toContain('[logo]');
    expect(job).toContain('Items 1');
    expect(job).not.toContain('SAMPLE');
    const stored = JSON.parse(db.prepare('SELECT doc_json FROM bill_document').pluck().get() as string) as { display: { showCaptain: boolean } };
    expect(stored.display.showCaptain).toBe(false);
  }, 20_000);
});

describe('after the KOT: PIN rules (P2-04)', () => {
  it('a Cashier needs a manager PIN to cancel a sent item or reprint; the approver is recorded', async () => {
    const owner = await seeded();
    const open = await send('OpenTable', { tableId: ids.t1, covers: 2 }, { token: owner });
    const orderId = open.body.order!.id;
    const item = newId();
    await send('AddItems', { items: [{ id: item, itemId: ids.dal, qty: 2 }] }, { token: owner, orderId, expectedVersion: 1 });
    const fired = await send('FireKOT', { all: true }, { token: owner, orderId, expectedVersion: 2 });
    const kotId = (fired.body.result as { kots: Array<{ id: string }> }).kots[0]!.id;
    const cashier = (await login(ids.cashier, '1111')).body.token;

    const cancel = (pin?: string) => send('CancelFiredItem', { orderItemId: item, reason: 'Guest left' }, { token: cashier, orderId, expectedVersion: 3, ...(pin ? { pin } : {}) });
    expect((await cancel()).body.error).toMatchObject({ code: 'PIN_REQUIRED', details: { right: 'kot.cancel', reason: 'pin_missing' } });
    expect((await cancel('2345')).body.ok).toBe(true);
    const row = db.prepare("SELECT user_id, approved_by, leakage_flag FROM audit_event WHERE action = 'item.cancel_fired'").get();
    expect(row).toEqual({ user_id: ids.cashier, approved_by: ids.manager, leakage_flag: 1 });

    expect((await send('ReprintKOT', { kotId }, { token: cashier })).body.error?.code).toBe('PIN_REQUIRED');
    expect((await send('ReprintKOT', { kotId }, { token: cashier, pin: '2345' })).body.ok).toBe(true);
    expect((await send('ReprintKOT', { kotId }, { token: owner })).body.ok).toBe(true); // the Owner needs no PIN
  }, 20_000);

  it('a Captain needs a manager PIN to reduce a sent item', async () => {
    const owner = await seeded();
    const open = await send('OpenTable', { tableId: ids.t1, covers: 2 }, { token: owner });
    const orderId = open.body.order!.id;
    const item = newId();
    await send('AddItems', { items: [{ id: item, itemId: ids.dal, qty: 3 }] }, { token: owner, orderId, expectedVersion: 1 });
    await send('FireKOT', { all: true }, { token: owner, orderId, expectedVersion: 2 });
    const captain = (await login(ids.captain, '3333')).body.token;
    const modify = (pin?: string) => send('ModifyFiredItem', { orderItemId: item, newQty: 1, reason: 'Too much' }, { token: captain, orderId, expectedVersion: 3, ...(pin ? { pin } : {}) });
    expect((await modify()).body.error).toMatchObject({ code: 'PIN_REQUIRED', details: { right: 'kot.modify' } });
    expect((await modify('2345')).body.ok).toBe(true);
  }, 20_000);
});

describe("today's bills and cash (P2-06)", () => {
  it('a Cashier sees the day’s bills (VOID ones too) and cash movements; a Captain does not; void needs a manager PIN for a Cashier', async () => {
    const owner = await seeded();
    const open = await send('OpenTable', { tableId: ids.t1, covers: 2 }, { token: owner });
    const orderId = open.body.order!.id;
    await send('AddItems', { items: [{ id: newId(), itemId: ids.dal, qty: 1 }] }, { token: owner, orderId, expectedVersion: 1 });
    await send('FireKOT', { all: true }, { token: owner, orderId, expectedVersion: 2 });
    const printed = await send('PrintBill', {}, { token: owner, orderId, expectedVersion: 3 });
    const billId = (printed.body.result as { billId: string }).billId;
    const cashier = (await login(ids.cashier, '1111')).body.token;
    const captain = (await login(ids.captain, '3333')).body.token;

    const voidIt = (pin?: string) => send('VoidBill', { billId, reason: 'Guest left' }, { token: cashier, orderId, expectedVersion: 4, ...(pin ? { pin } : {}) });
    expect((await voidIt()).body.error?.code).toBe('PIN_REQUIRED');
    expect((await voidIt('2345')).body.ok).toBe(true);
    await send('PayIn', { amountPaise: 100_000, reason: 'Float' }, { token: owner });

    expect((await app.inject({ method: 'GET', url: '/v1/bills', headers: { 'x-user-session': captain } })).statusCode).toBe(403);
    const day = (await app.inject({ method: 'GET', url: '/v1/bills', headers: { 'x-user-session': cashier } })).json<{ date: string; bills: Array<{ billNo: string; state: string; table: string }> }>();
    expect(day.date).toBe('2026-11-02');
    expect(day.bills).toMatchObject([{ billNo: 'B/26-27/000001', state: 'void', table: 'T1' }]);
    const cash = (await app.inject({ method: 'GET', url: '/v1/cash', headers: { 'x-user-session': cashier } })).json<{ movements: Array<{ kind: string; amountPaise: number; userName: string }> }>();
    expect(cash.movements).toMatchObject([{ kind: 'pay_in', amountPaise: 100_000, userName: 'Asha (Owner)' }]);
  }, 20_000);
});

describe('reports (P4-03)', () => {
  it('need reports.view: a Manager sees them, a Cashier does not', async () => {
    await seeded();
    const manager = (await login(ids.manager, '2345')).body.token;
    const cashier = (await login(ids.cashier, '1111')).body.token;
    expect((await app.inject({ method: 'GET', url: '/v1/reports', headers: { 'x-user-session': cashier } })).statusCode).toBe(403);
    const list = (await app.inject({ method: 'GET', url: '/v1/reports', headers: { 'x-user-session': manager } })).json<{ reports: unknown[]; businessDate: string }>();
    expect(list.reports).toHaveLength(16);
    const daily = await app.inject({ method: 'GET', url: '/v1/reports/daily?from=2026-11-01&to=2026-11-02', headers: { 'x-user-session': manager } });
    expect(daily.json()).toMatchObject({ key: 'daily', from: '2026-11-01', to: '2026-11-02', rows: [] });
    expect((await app.inject({ method: 'GET', url: '/v1/reports/daily?from=x', headers: { 'x-user-session': manager } })).statusCode).toBe(400);
  });
});

describe('leakage dashboard and audit log (P4-01)', () => {
  it('need reports.view; a card drills into its events', async () => {
    await seeded();
    const manager = (await login(ids.manager, '2345')).body.token;
    const cashier = (await login(ids.cashier, '1111')).body.token;
    for (const url of ['/v1/leakage', '/v1/audit']) {
      expect((await app.inject({ method: 'GET', url, headers: { 'x-user-session': cashier } })).statusCode, url).toBe(403);
    }
    const leakage = (await app.inject({ method: 'GET', url: '/v1/leakage', headers: { 'x-user-session': manager } })).json<{ cards: Array<{ key: string }>; unbilled: unknown }>();
    expect(leakage.cards.map((c) => c.key)).toContain('voids');
    const log = (await app.inject({ method: 'GET', url: '/v1/audit?limit=3', headers: { 'x-user-session': manager } })).json<{ entries: Array<{ label: string }>; next: number | null }>();
    expect(log.entries.length).toBe(3);
    expect((await app.inject({ method: 'GET', url: '/v1/audit?card=nope', headers: { 'x-user-session': manager } })).statusCode).toBe(404);
  });
});
