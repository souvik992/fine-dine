import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newId, type MenuSnapshot } from '@dinepos/shared';
import { build } from 'esbuild';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAddons } from '../../../apps/server/src/addons/loader.js';
import { buildApp, type DinePosApp } from '../../../apps/server/src/app.js';
import type { Authenticator } from '../../../apps/server/src/auth/authenticate.js';
import { coreHandlers, commandRegistry } from '../../../apps/server/src/commands/registry.js';
import { ensureBusinessDay } from '../../../apps/server/src/core/business-day.js';
import { EventBus, noopPrintWaker } from '../../../apps/server/src/core/events.js';
import { executeCommand } from '../../../apps/server/src/core/execute-command.js';
import { allowAllRights, roleRights } from '../../../apps/server/src/core/rights.js';
import type { Db } from '../../../apps/server/src/db/connection.js';
import { devSeedCommands, devSetupCommand } from '../../../apps/server/src/seed/dev-seed.js';
import { testKeys, writePackage } from '../../../apps/server/src/testing/addon-package.js';
import { createTestDb } from '../../../apps/server/src/testing/test-db.js';

// P5-02 / P5-04: the Table QR add-on inside a real DinePOS server (bundled exactly as the build does, signed with a
// throwaway key). Guests order, call and pay through /a/tableqr/api; staff accept, reject and confirm.
const here = path.dirname(fileURLToPath(import.meta.url));
let backend = '';
beforeAll(async () => {
  const out = await build({ entryPoints: [path.join(here, 'backend.ts')], bundle: true, platform: 'node', format: 'cjs', target: 'node22', write: false, logLevel: 'silent' });
  backend = out.outputFiles[0]!.text;
}, 60_000);

let root: string;
let db: Db;
let app: DinePosApp;
const now = () => new Date('2026-11-05T13:00:00Z');
const keys = testKeys();
/** Staff member for staff routes: the dev seed's owner (has every right). */
let ownerId = '';
const auth: Authenticator = { mode: 'test', authenticate: () => ({ deviceId: null, deviceKind: 'master', userId: ownerId }) };

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'dinepos-tableqr-'));
  db = createTestDb();
  ensureBusinessDay(db, 'Asia/Kolkata', now);
  const deps = { db, registry: commandRegistry, rights: allowAllRights, bus: new EventBus(), printWaker: noopPrintWaker, timeZone: 'Asia/Kolkata', now };
  for (const c of [devSetupCommand(), ...devSeedCommands()]) executeCommand(deps, { commandId: newId(), type: c.type, payload: c.payload, createdAt: now().toISOString() }, { deviceId: null, userId: null });
  ownerId = db.prepare("SELECT u.id FROM app_user u JOIN role r ON r.id = u.role_id WHERE r.name = 'Owner' LIMIT 1").pluck().get() as string;
  writePackage(root, { 'backend.cjs': backend, 'web/index.html': '<!doctype html><title>Order</title>', 'web/app.js': '1', 'web/app.css': '' }, keys, { id: 'tableqr', commandPrefix: 'TableQr', rights: ['order.create', 'order.edit', 'kot.fire'] });
  const addons = loadAddons({ db, dir: root, dataDir: root, posVersion: '0.1.0', timeZone: 'Asia/Kolkata', now, trustKeys: keys.trust, reservedTypes: new Set(coreHandlers.map((h) => h.type)) });
  expect(addons.infos()[0], addons.infos()[0]?.error ?? '').toMatchObject({ status: 'on' });
  app = buildApp({ db, timeZone: 'Asia/Kolkata', now, addons, devices: 'off', rights: roleRights, auth, port: 7420 });
});
afterEach(async () => {
  await app.close();
  db.close();
  rmSync(root, { recursive: true, force: true });
});
afterAll(() => undefined);

interface Err {
  error?: { code: string; message: string };
}
interface Placed extends Err {
  requestId: string;
  status: string;
}
interface Status extends Err {
  requests: Array<{ kind: string; status: string; reason: string | null }>;
  bill: { printed: boolean; asked: boolean; lines: Array<{ qty: number; sent: boolean }> } | null;
  pay: { billId: string; link: string; claimed: boolean } | null;
}
const staff = async <T = Err>(method: 'GET' | 'POST', url: string, payload?: unknown) => {
  const res = await app.inject({ method, url: `/v1/addons/tableqr${url}`, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { status: res.statusCode, body: res.json<T & Err>() };
};
const guest = async <T = Err>(method: 'GET' | 'POST', url: string, payload?: unknown) => {
  const res = await app.inject({ method, url: `/a/tableqr/api${url}`, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { status: res.statusCode, body: res.json<T & Err>() };
};
const GUEST = 'guest-abc-123';

async function setUp(mode: 'staff' | 'auto' = 'staff', payOnline = false) {
  expect((await staff('POST', '/settings', { enabled: true, acceptMode: mode, payOnline, baseUrl: 'http://192.168.1.20:7420', welcome: 'Welcome!' })).status).toBe(200);
  expect((await staff<{ made: number }>('POST', '/codes', {})).body.made).toBeGreaterThan(0);
  const s = await staff<{ tables: Array<{ id: string; label: string; url: string }> }>('GET', '/settings');
  const t2 = s.body.tables.find((t) => t.label === 'T2')!;
  const token = new URL(t2.url).searchParams.get('t')!;
  return { token, tableId: t2.id, url: t2.url };
}
const menu = () => app.inject({ method: 'GET', url: '/v1/menu' }).then((r) => r.json<MenuSnapshot>());
async function anOrder(token: string, covers: number | null = 2) {
  const m = await menu();
  const dish = m.items.find((i) => i.available && i.variants.length === 0 && i.addonGroupIds.length === 0)!;
  return guest<Placed>('POST', '/order', { t: token, guestId: GUEST, covers, lines: [{ itemId: dish.id, qty: 2, note: 'less oil' }] });
}
const tableBadges = async (tableId: string) => (await app.inject({ method: 'GET', url: '/v1/floor' })).json<{ tables: Array<{ id: string; badges?: Array<{ label: string }> }> }>().tables.find((t) => t.id === tableId)!.badges ?? [];

describe('Table QR', () => {
  it('codes per table on the Wi-Fi address; a guest sees the table and the menu (available dishes only)', async () => {
    const { token, url } = await setUp();
    expect(url).toMatch(/^http:\/\/192\.168\.1\.20:7420\/a\/tableqr\/\?t=[A-Za-z0-9_-]{24}$/);
    expect((await guest<{ table: string }>('GET', `/table?t=${token}`)).body).toMatchObject({ table: 'T2', welcome: 'Welcome!', acceptMode: 'staff', seated: false, payOnline: false });
    const m = (await guest<{ items: Array<Record<string, unknown>> }>('GET', `/menu?t=${token}`)).body;
    expect(m.items.length).toBeGreaterThan(0);
    expect(m.items.every((i) => !('hsnSac' in i) && !('taxRateBp' in i))).toBe(true);
    expect((await guest('GET', '/table?t=not-a-real-token-xyz')).status).toBe(404);
    // renewing stops the old code
    await staff('POST', '/codes', { renew: true });
    expect((await guest('GET', `/table?t=${token}`)).body.error?.message).toMatch(/no longer valid/);
  });

  it('staff accepting: the order waits with a QR order mark; Accept seats the table and sends the KOT once', async () => {
    const { token, tableId } = await setUp('staff');
    const placed = await anOrder(token);
    expect(placed.body).toMatchObject({ status: 'pending' });
    expect(await tableBadges(tableId)).toEqual([expect.objectContaining({ label: 'QR order' })]);
    const list = (await staff<{ requests: Array<Record<string, unknown>> }>('GET', '/requests')).body.requests;
    expect(list[0]).toMatchObject({ table: 'T2', kind: 'order', status: 'pending', covers: 2, lines: [expect.objectContaining({ qty: 2, note: 'less oil' })] });

    const acc = await staff('POST', `/requests/${placed.body.requestId}/accept`);
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);
    const order = db.prepare("SELECT id, covers FROM \"order\" WHERE table_id = ? AND state = 'open'").get(tableId) as { id: string; covers: number };
    expect(order.covers).toBe(2);
    expect(db.prepare("SELECT count(*) FROM order_item WHERE order_id = ? AND status = 'fired'").pluck().get(order.id)).toBe(1);
    expect(db.prepare('SELECT count(*) FROM kot WHERE order_id = ?').pluck().get(order.id)).toBe(1);
    expect(await tableBadges(tableId)).toEqual([]);
    // a second Accept (double tap, another terminal) sends nothing more
    expect((await staff('POST', `/requests/${placed.body.requestId}/accept`)).body.error?.message).toMatch(/already accepted/);
    expect(db.prepare('SELECT count(*) FROM kot WHERE order_id = ?').pluck().get(order.id)).toBe(1);
    // the guest sees it accepted and the running bill
    const st = (await guest<Status>('GET', `/status?t=${token}&g=${GUEST}`)).body;
    expect(st.requests[0]).toMatchObject({ kind: 'order', status: 'accepted' });
    expect(st.bill).toMatchObject({ printed: false, lines: [expect.objectContaining({ qty: 2, sent: true })] });
    // audited with the staff member
    expect(db.prepare("SELECT count(*) FROM audit_event WHERE action = 'tableqr.accepted'").pluck().get()).toBe(1);
  });

  it('reject needs a reason, which the guest sees', async () => {
    const { token } = await setUp('staff');
    const placed = await anOrder(token);
    expect((await staff('POST', `/requests/${placed.body.requestId}/reject`, {})).status).toBe(400);
    expect((await staff('POST', `/requests/${placed.body.requestId}/reject`, { reason: 'Kitchen closed for mains' })).status).toBe(200);
    expect((await guest<Status>('GET', `/status?t=${token}&g=${GUEST}`)).body.requests[0]).toMatchObject({ status: 'rejected', reason: 'Kitchen closed for mains' });
  });

  it('automatic accepting sends the order to the kitchen at once (the add-on actor, with its signed rights)', async () => {
    const { token, tableId } = await setUp('auto');
    const placed = await anOrder(token, 3);
    expect(placed.body).toMatchObject({ status: 'accepted' });
    const order = db.prepare("SELECT id FROM \"order\" WHERE table_id = ? AND state = 'open'").get(tableId) as { id: string };
    expect(db.prepare('SELECT count(*) FROM kot WHERE order_id = ?').pluck().get(order.id)).toBe(1);
    // the next order joins the same table's order; no covers needed once seated
    expect((await anOrder(token, null)).body).toMatchObject({ status: 'accepted' });
    expect(db.prepare('SELECT count(*) FROM kot WHERE order_id = ?').pluck().get(order.id)).toBe(2);
  });

  it('guests cannot order dishes that are off, or without saying how many are at the table', async () => {
    const { token } = await setUp('staff');
    expect((await anOrder(token, null)).body.error?.message).toMatch(/How many guests/);
    expect((await guest('POST', '/order', { t: token, guestId: GUEST, covers: 2, lines: [{ itemId: newId(), qty: 1 }] })).body.error?.message).toMatch(/no longer on the menu/);
    expect((await guest('POST', '/order', { t: token, guestId: GUEST, covers: 2, lines: [] })).status).toBe(400);
  });

  it('call waiter shows on the tile until staff mark it done (calling twice is one call)', async () => {
    const { token, tableId } = await setUp();
    const a = await guest<Placed>('POST', '/call', { t: token, guestId: GUEST });
    const b = await guest<Placed>('POST', '/call', { t: token, guestId: 'another-guest-9' });
    expect(b.body.requestId).toBe(a.body.requestId);
    expect((await tableBadges(tableId)).map((x) => x.label)).toEqual(['Waiter called']);
    await staff('POST', `/requests/${a.body.requestId}/done`);
    expect(await tableBadges(tableId)).toEqual([]);
  });

  it('ask for the bill, then pay by UPI: the guest says paid, the cashier confirms and the bill is settled as UPI', async () => {
    const { token, tableId } = await setUp('auto', true);
    // the outlet's UPI id (Settings › Outlet & bills)
    executeCommand(
      { db, registry: commandRegistry, rights: allowAllRights, bus: new EventBus(), printWaker: noopPrintWaker, timeZone: 'Asia/Kolkata', now },
      { commandId: newId(), type: 'SetConfig', payload: { values: { 'bill.upiVpa': 'spice@okbank', 'bill.upiPayeeName': 'Spice Garden' } }, createdAt: now().toISOString() },
      { deviceId: null, userId: ownerId },
    );
    await anOrder(token, 2);
    expect((await guest('POST', '/bill', { t: token, guestId: GUEST })).body).toEqual({ status: 'asked' });
    expect((await guest<Status>('GET', `/status?t=${token}&g=${GUEST}`)).body.bill?.asked).toBe(true);
    const orderRow = db.prepare("SELECT id, version FROM \"order\" WHERE table_id = ? AND state = 'open'").get(tableId) as { id: string; version: number };
    const printed = await app.inject({ method: 'POST', url: '/v1/commands', payload: { commandId: newId(), type: 'PrintBill', orderId: orderRow.id, expectedVersion: orderRow.version, payload: {}, createdAt: now().toISOString() } });
    expect(printed.statusCode, printed.body).toBe(200);
    const st = (await guest<Status>('GET', `/status?t=${token}&g=${GUEST}`)).body;
    const pay = st.pay!;
    expect(pay.claimed).toBe(false);
    expect(pay.link).toMatch(/^upi:\/\/pay\?pa=spice%40okbank&pn=Spice%20Garden&am=\d+\.\d\d&cu=INR/);
    const claim = await guest<Placed>('POST', '/paid', { t: token, guestId: GUEST, billId: pay.billId });
    expect(claim.body).toMatchObject({ status: 'pending' });
    expect((await tableBadges(tableId))[0]!.label).toMatch(/^Paid\? ₹/);
    const confirm = await staff('POST', `/requests/${claim.body.requestId}/confirm-pay`);
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(200);
    expect(db.prepare('SELECT state FROM bill WHERE id = ?').pluck().get(pay.billId)).toBe('settled');
    expect(db.prepare('SELECT mode, ref FROM payment WHERE bill_id = ?').get(pay.billId)).toEqual({ mode: 'upi', ref: 'Table QR' });
    expect(await tableBadges(tableId)).toEqual([]);
  });

  it('switched off: guests are told to ask staff; the internal commands cannot be sent by a client', async () => {
    const { token } = await setUp();
    await staff('POST', '/settings', { enabled: false, acceptMode: 'staff', payOnline: false, baseUrl: '', welcome: '' });
    expect((await guest('GET', `/table?t=${token}`)).body.error?.message).toMatch(/not available right now/);
    const res = await app.inject({ method: 'POST', url: '/v1/commands', payload: { commandId: newId(), type: 'TableQrResolve', payload: { requestId: newId(), status: 'done' }, createdAt: now().toISOString() } });
    expect(res.json<Err>().error?.message).toMatch(/Unknown command type/);
  });
});
