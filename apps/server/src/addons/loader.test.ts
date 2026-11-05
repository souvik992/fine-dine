import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newId, type AddonInfo, type Right } from '@dinepos/shared';

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type DinePosApp } from '../app.js';
import { coreHandlers } from '../commands/registry.js';
import { allowAllRights, roleRights } from '../core/rights.js';
import type { Db } from '../db/connection.js';
import { testKeys, writePackage, type TestKeys } from '../testing/addon-package.js';
import { createTestDb } from '../testing/test-db.js';
import { ensureBusinessDay } from '../core/business-day.js';
import { executeCommand } from '../core/execute-command.js';
import { commandRegistry } from '../commands/registry.js';
import { EventBus, noopPrintWaker } from '../core/events.js';
import { devSeedCommands, devSetupCommand } from '../seed/dev-seed.js';
import type { Authenticator } from '../auth/authenticate.js';
import { loadAddons, type AddonSet } from './loader.js';
import { sqlProblem } from './sql-guard.js';

// P5-01: signed add-ons. A package runs only when its signature, folder, POS version and every file check out; its
// database steps touch only its own tables; its writes go through the command pipeline; a failure switches only it off.
const BACKEND = `
exports.register = (host) => {
  host.migrations(['CREATE TABLE demo_note (id TEXT PRIMARY KEY, table_id TEXT NOT NULL, text TEXT NOT NULL)']);
  const schema = { safeParse: (v) => v && typeof v.tableId === 'string' && typeof v.text === 'string' && v.text.length > 0
    ? { success: true, data: v } : { success: false, error: { issues: [{ path: ['text'], message: 'Write a note.' }] } } };
  host.command({ type: 'DemoAddNote', right: null, schema, apply(ctx, p) {
    const id = ctx.commandId;
    ctx.db.prepare('INSERT INTO demo_note (id, table_id, text) VALUES (?, ?, ?)').run(id, p.tableId, p.text);
    ctx.audit({ entity: 'demo_note', entityId: id, action: 'demo.note', after: p });
    ctx.emit('floor', 'demo.note', { tableId: p.tableId });
    return { result: { id } };
  } });
  host.command({ type: 'DemoSecret', right: 'reports.view', schema: { safeParse: (v) => ({ success: true, data: v }) }, apply() { return { result: 'ok' }; } });
  host.route('GET', '/notes', () => ({ notes: host.db.all('SELECT table_id AS tableId, text FROM demo_note ORDER BY rowid') }), { access: 'staff' });
  host.route('GET', '/report', () => ({ ok: true }), { access: 'staff', right: 'reports.view' });
  host.route('POST', '/notes', (req) => host.execute('DemoAddNote', req.body, { actor: host.systemActor() }).result, { access: 'guest' });
  host.route('GET', '/hello', () => ({ hello: 'guest', tables: host.floor().tables.length }), { access: 'guest' });
  host.route('POST', '/write', () => host.db.all("INSERT INTO demo_note (id, table_id, text) VALUES ('x', 't', 'y') RETURNING id"), { access: 'guest' });
  host.static('index.html', 'web/index.html');
  host.floorBadges((db) => db.all('SELECT table_id AS tableId, count(*) AS n FROM demo_note GROUP BY table_id').map((r) => ({ tableId: r.tableId, key: 'note', label: r.n + ' note', tone: 'info' })));
};`;

const FILES = { 'backend.cjs': BACKEND, 'web/index.html': '<!doctype html><title>Guest</title>', 'ui/ui.js': 'window.__DINEPOS__ && 1', 'ui/ui.css': '.x{}' };

let root: string;
let db: Db;
let keys: TestKeys;
let app: DinePosApp | undefined;
const now = () => new Date('2026-11-05T06:30:00Z');

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'dinepos-addons-'));
  db = createTestDb();
  keys = testKeys();
});
afterEach(async () => {
  await app?.close();
  app = undefined;
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const load = (posVersion = '0.1.0', trust = keys.trust) =>
  loadAddons({ db, dir: root, dataDir: root, posVersion, timeZone: 'Asia/Kolkata', now, trustKeys: trust, reservedTypes: new Set(coreHandlers.map((h) => h.type)) });
/** A signed-in manager on the master PC (the session check is tested elsewhere). */
const auth: Authenticator = { mode: 'test', authenticate: () => ({ deviceId: null, deviceKind: 'master', userId: 'u-test' }) };
const start = (addons: AddonSet) => (app = buildApp({ db, timeZone: 'Asia/Kolkata', now, addons, devices: 'off', rights: allowAllRights, auth }));
/** An outlet with tables and an open day (the dev seed). */
function seed(): void {
  ensureBusinessDay(db, 'Asia/Kolkata', now);
  const deps = { db, registry: commandRegistry, rights: allowAllRights, bus: new EventBus(), printWaker: noopPrintWaker, timeZone: 'Asia/Kolkata', now };
  for (const c of [devSetupCommand(), ...devSeedCommands()]) executeCommand(deps, { commandId: newId(), type: c.type, payload: c.payload, createdAt: now().toISOString() }, { deviceId: null, userId: null });
}
const info = (s: AddonSet, id = 'demo') => s.infos().find((a) => a.id === id)!;
const tableId = () => db.prepare('SELECT id FROM dining_table LIMIT 1').pluck().get() as string;

describe('add-on loader', () => {
  it('a signed package loads: its database step runs once, its screens are listed with their fingerprints', () => {
    writePackage(root, FILES, keys);
    const s = load();
    expect(info(s)).toMatchObject({ status: 'on', error: null, version: '1.0.0' });
    expect(info(s).ui?.script).toMatch(/^[0-9a-f]{64}$/);
    expect(info(s).ui?.style).toMatch(/^[0-9a-f]{64}$/);
    expect(db.prepare("SELECT count(*) FROM sqlite_master WHERE name = 'demo_note'").pluck().get()).toBe(1);
    expect(db.prepare("SELECT seq FROM addon_migration WHERE addon_id = 'demo'").pluck().all()).toEqual([1]);
    load(); // again: nothing re-run
    expect(db.prepare("SELECT count(*) FROM addon_migration WHERE addon_id = 'demo'").pluck().get()).toBe(1);
    expect(db.prepare("SELECT status, highest_version FROM addon_state WHERE id = 'demo'").get()).toEqual({ status: 'on', highest_version: '1.0.0' });
  });

  it.each([
    ['another key signed it', () => writePackage(root, FILES, testKeys()), /signature is not valid/],
    ['a file changed after signing', () => writeFileSync(path.join(writePackage(root, FILES, keys), 'backend.cjs'), BACKEND + '\n// evil'), /backend\.cjs was changed after it was signed/],
    ['the folder is not its id', () => writePackage(root, FILES, keys, {}, 'other'), /must be in a folder of that name/],
    ['DinePOS is too old', () => writePackage(root, FILES, keys, { minPosVersion: '9.0.0' }), /needs DinePOS 9\.0\.0 or newer/],
    ['backend asks for a package', () => writePackage(root, { ...FILES, 'backend.cjs': "require('fs-extra'); exports.register = () => {}" }, keys), /Node built-in modules only/],
    ['a command without the prefix', () => writePackage(root, { 'backend.cjs': "exports.register = (h) => h.command({ type: 'FireKOT', right: null, schema: { safeParse: () => ({}) }, apply() {} })" }, keys), /must start with Demo/],
    ['a database step on a DinePOS table', () => writePackage(root, { 'backend.cjs': "exports.register = (h) => h.migrations(['DELETE FROM bill'])" }, keys), /only its own tables/],
    ['register throws', () => writePackage(root, { 'backend.cjs': "exports.register = () => { throw new Error('boom') }" }, keys), /boom/],
  ])('switched off with a reason when %s; DinePOS starts anyway', async (_name, make, reason) => {
    make();
    const s = load();
    const a = s.infos()[0]!;
    expect(a.status).toBe('off');
    expect(a.error).toMatch(reason);
    expect(s.commands()).toEqual([]);
    start(s);
    expect((await app!.inject({ method: 'GET', url: '/v1/health' })).statusCode).toBe(200);
    expect((await app!.inject({ method: 'GET', url: '/v1/addons' })).json<{ addons: AddonInfo[] }>().addons[0]).toMatchObject({ status: 'off', ui: null });
  });

  it('an older version than one already run is refused; the same or newer loads', () => {
    writePackage(root, FILES, keys, { version: '1.2.0' });
    expect(info(load()).status).toBe('on');
    rmSync(path.join(root, 'demo'), { recursive: true });
    writePackage(root, FILES, keys, { version: '1.1.9' });
    expect(info(load()).error).toMatch(/older than 1\.2\.0/);
    rmSync(path.join(root, 'demo'), { recursive: true });
    writePackage(root, FILES, keys, { version: '1.3.0' });
    expect(info(load()).status).toBe('on');
  });

  it('a database step changed after it ran switches the add-on off (never re-run, never silently different)', () => {
    writePackage(root, FILES, keys);
    load();
    rmSync(path.join(root, 'demo'), { recursive: true });
    writePackage(root, { ...FILES, 'backend.cjs': BACKEND.replace('text TEXT NOT NULL)', 'text TEXT)') }, keys, { version: '1.0.1' });
    expect(info(load()).error).toMatch(/step 1 changed after it ran/);
  });
});

describe('add-on at work', () => {
  beforeEach(() => {
    seed();
    writePackage(root, FILES, keys);
  });

  it('its command runs through the pipeline (idempotent, audited, event); it marks the floor tile', async () => {
    start(load());
    const t = tableId();
    const body = { commandId: newId(), type: 'DemoAddNote', payload: { tableId: t, text: 'Window seat' }, createdAt: now().toISOString() };
    const res = await app!.inject({ method: 'POST', url: '/v1/commands', payload: body });
    expect(res.statusCode, res.body).toBe(200);
    expect((await app!.inject({ method: 'POST', url: '/v1/commands', payload: body })).json()).toMatchObject({ duplicate: true });
    expect(db.prepare("SELECT count(*) FROM audit_event WHERE action = 'demo.note'").pluck().get()).toBe(1);
    expect(db.prepare("SELECT count(*) FROM event_log WHERE event = 'demo.note' AND topic = 'floor'").pluck().get()).toBe(1);
    const floor = (await app!.inject({ method: 'GET', url: '/v1/floor' })).json<{ tables: Array<{ id: string; badges?: unknown[] }> }>();
    expect(floor.tables.find((x) => x.id === t)!.badges).toEqual([{ addonId: 'demo', key: 'note', label: '1 note', tone: 'info' }]);
    expect((await app!.inject({ method: 'GET', url: '/v1/addons/demo/notes' })).json()).toEqual({ notes: [{ tableId: t, text: 'Window seat' }] });
    const bad = await app!.inject({ method: 'POST', url: '/v1/commands', payload: { ...body, commandId: newId(), payload: { tableId: t, text: '' } } });
    expect(bad.json<ErrorBody>().error).toMatchObject({ code: 'VALIDATION', details: [{ path: 'text', message: 'Write a note.' }] });
  });

  it('guest pages and API are public with a strict content policy; the add-on actor has only its signed rights', async () => {
    start(load());
    const page = await app!.inject({ method: 'GET', url: '/a/demo/' });
    expect(page.body).toContain('<title>Guest</title>');
    expect(page.headers['content-security-policy']).toContain("connect-src 'self'");
    expect((await app!.inject({ method: 'GET', url: '/a/demo/api/hello' })).json()).toMatchObject({ hello: 'guest' });
    // DemoAddNote has no right: the add-on actor may run it
    expect((await app!.inject({ method: 'POST', url: '/a/demo/api/notes', payload: { tableId: tableId(), text: 'From a guest' } })).statusCode).toBe(200);
    // outside a command the add-on cannot write
    expect((await app!.inject({ method: 'POST', url: '/a/demo/api/write', payload: {} })).json<ErrorBody>().error.message).toMatch(/only through their commands/);
    // files not served as pages are not reachable; the package's screens are, with the signed manifest
    expect((await app!.inject({ method: 'GET', url: '/a/demo/backend.cjs' })).statusCode).toBe(404);
    expect((await app!.inject({ method: 'GET', url: '/a/demo/_pkg/ui/ui.js' })).body).toBe(FILES['ui/ui.js']);
    expect((await app!.inject({ method: 'GET', url: '/a/demo/_pkg/manifest.json' })).json<{ id: string; signature: string }>()).toMatchObject({ id: 'demo' });
  });

  it('the add-on actor may use only the rights its signed manifest lists', () => {
    const actor = (addonRights: Right[]) => ({ deviceId: null, userId: null, deviceKind: 'addon' as const, addonId: 'demo', addonRights });
    expect(() => roleRights.check({ db, actor: actor([]), right: 'kot.fire', commandType: 'FireKOT' })).toThrow(/"kot\.fire" right/);
    expect(roleRights.check({ db, actor: actor(['kot.fire']), right: 'kot.fire', commandType: 'FireKOT' })).toBeUndefined();
    rmSync(path.join(root, 'demo'), { recursive: true });
    writePackage(root, FILES, keys, { rights: ['order.edit', 'kot.fire'] });
    expect(load().rightsOf('demo')).toEqual(['order.edit', 'kot.fire']);
  });

  it('the guest API is rate limited per address', async () => {
    start(load());
    let last = 0;
    for (let i = 0; i < 35; i++) last = (await app!.inject({ method: 'GET', url: '/a/demo/api/hello' })).statusCode;
    expect(last).toBe(429);
  });
});

describe('add-on database steps (sqlProblem)', () => {
  it('allow own tables and indexes; refuse anything else', () => {
    expect(sqlProblem('demo', 'CREATE TABLE demo_a (id TEXT); CREATE INDEX demo_a_i ON demo_a(id); ALTER TABLE demo_a ADD COLUMN x INTEGER; INSERT INTO demo_a VALUES (1)')).toBeNull();
    expect(sqlProblem('demo', '-- note\nCREATE TABLE IF NOT EXISTS "demo_b" (id TEXT REFERENCES dining_table(id))')).toBeNull();
    for (const sql of ['CREATE TABLE bill2 (x)', 'DROP TABLE bill', 'UPDATE app_user SET pin_hash = 1', 'CREATE INDEX demo_i ON bill(id)', 'ATTACH DATABASE "x" AS y', 'PRAGMA foreign_keys = OFF', 'CREATE TRIGGER demo_t AFTER INSERT ON bill BEGIN SELECT 1; END', 'ALTER TABLE demo_a RENAME TO bill', 'SELECT 1', '']) {
      expect(sqlProblem('demo', sql), sql).not.toBeNull();
    }
  });
});
