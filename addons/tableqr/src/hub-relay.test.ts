import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { newId } from '@dinepos/shared';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

// P5-03 end to end with the real order hub (pos-backend/hub, next to this repository): DinePOS connects out to the hub
// as it does for online orders; a guest's phone talks only to the hub; each request goes down the outlet's connection
// and the answer comes back. Skipped where the hub's code is not beside this repository.
const here = path.dirname(fileURLToPath(import.meta.url));
const hubSrc = path.resolve(here, '..', '..', '..', '..', 'pos-backend', 'hub', 'src');
const HAS_HUB = existsSync(path.join(hubSrc, 'relay.ts'));

interface HubModule {
  Hub: new (o: { dbPath: string; devOtp?: boolean }) => { close(): void; connected(storeId: string): boolean; store(q: { slug: string }): { id: string } };
}
interface HttpModule {
  createHubServer: (hub: unknown, o: { adminKey: string; heartbeatMs: number }) => Server;
}

describe.runIf(HAS_HUB)('Table QR through the real order hub', () => {
  let dir: string;
  let db: Db;
  let app: DinePosApp;
  let hubServer: Server;
  let hub: InstanceType<HubModule['Hub']>;
  let hubBase = '';
  let token = '';
  let storeId = '';
  const now = () => new Date();

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'dinepos-hubrelay-'));
    const { Hub } = (await import(pathToFileURL(path.join(hubSrc, 'hub.ts')).href)) as HubModule;
    const { createHubServer } = (await import(pathToFileURL(path.join(hubSrc, 'http.ts')).href)) as HttpModule;
    hub = new Hub({ dbPath: path.join(dir, 'hub.db'), devOtp: true });
    hubServer = createHubServer(hub, { adminKey: 'admin-key', heartbeatMs: 200 });
    await new Promise<void>((r) => hubServer.listen(0, '127.0.0.1', () => r()));
    hubBase = `http://127.0.0.1:${(hubServer.address() as { port: number }).port}`;
    const store = (await (await fetch(`${hubBase}/v1/admin/stores`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': 'admin-key' }, body: JSON.stringify({ slug: 'spice-garden', name: 'Spice Garden' }) })).json()) as { storeId: string; pairingCode: string };
    storeId = store.storeId;
    const paired = (await (await fetch(`${hubBase}/v1/pos/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: store.pairingCode, deviceName: 'DinePOS' }) })).json()) as { deviceKey: string };

    // the outlet: DinePOS with the Table QR add-on, paired with that hub (online orders stay off)
    db = createTestDb();
    ensureBusinessDay(db, 'Asia/Kolkata', now);
    const deps = { db, registry: commandRegistry, rights: allowAllRights, bus: new EventBus(), printWaker: noopPrintWaker, timeZone: 'Asia/Kolkata', now };
    for (const c of [devSetupCommand(), ...devSeedCommands()]) executeCommand(deps, { commandId: newId(), type: c.type, payload: c.payload, createdAt: now().toISOString() }, { deviceId: null, userId: null });
    db.prepare('UPDATE online_link SET hub_url = ?, device_key = ?, store_slug = ? WHERE id = 1').run(hubBase, paired.deviceKey, 'spice-garden');
    const ownerId = db.prepare("SELECT u.id FROM app_user u JOIN role r ON r.id = u.role_id WHERE r.name = 'Owner' LIMIT 1").pluck().get() as string;
    const auth: Authenticator = { mode: 'test', authenticate: () => ({ deviceId: null, deviceKind: 'master', userId: ownerId }) };
    const backend = (await build({ entryPoints: [path.join(here, 'backend.ts')], bundle: true, platform: 'node', format: 'cjs', target: 'node22', write: false, logLevel: 'silent' })).outputFiles[0]!.text;
    const keys = testKeys();
    writePackage(path.join(dir, 'addons'), { 'backend.cjs': backend, 'web/index.html': '<!doctype html><title>Order at your table</title>', 'web/app.js': 'console.log(1)', 'web/app.css': '' }, keys, { id: 'tableqr', commandPrefix: 'TableQr', rights: ['order.create', 'order.edit', 'kot.fire'] });
    const addons = loadAddons({ db, dir: path.join(dir, 'addons'), dataDir: dir, posVersion: '0.1.0', timeZone: 'Asia/Kolkata', now, trustKeys: keys.trust, reservedTypes: new Set(coreHandlers.map((h) => h.type)) });
    app = buildApp({ db, timeZone: 'Asia/Kolkata', now, addons, devices: 'off', rights: roleRights, auth, port: 7420 });
    app.online.start();
    const post = (url: string, body: unknown) => app.inject({ method: 'POST', url: `/v1/addons/tableqr${url}`, payload: body as object });
    await post('/settings', { enabled: true, acceptMode: 'staff', payOnline: false, baseUrl: '', codeAddress: 'hub', welcome: '' });
    await post('/codes', {});
    const settings = (await app.inject({ method: 'GET', url: '/v1/addons/tableqr/settings' })).json<{ tables: Array<{ label: string; url: string }> }>();
    const url = new URL(settings.tables.find((t) => t.label === 'T2')!.url);
    expect(url.pathname).toBe('/s/spice-garden/a/tableqr/');
    token = url.searchParams.get('t')!;
    for (let i = 0; i < 400 && !hub.connected(storeId); i++) await new Promise((r) => setTimeout(r, 50));
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await new Promise<void>((r) => {
      hubServer?.close(() => r());
      hubServer?.closeAllConnections();
    });
    hub?.close();
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('with online orders off, the outlet still connects to the hub because the codes point there', async () => {
    await expect.poll(() => hub.connected(storeId), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => app.online.status().connection, { timeout: 20_000 }).toBe('connected');
  }, 30_000);

  it('a guest on mobile data opens the page, reads the table and orders, all through the hub', { timeout: 30_000 }, async () => {
    const page = await fetch(`${hubBase}/s/spice-garden/a/tableqr/?t=${token}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<title>Order at your table</title>');
    expect(page.headers.get('content-security-policy')).toContain("connect-src 'self'");

    const table = await fetch(`${hubBase}/s/spice-garden/a/tableqr/api/table?t=${token}`);
    expect(await table.json()).toMatchObject({ table: 'T2', seated: false });

    const menu = (await (await fetch(`${hubBase}/s/spice-garden/a/tableqr/api/menu?t=${token}`)).json()) as { items: Array<{ id: string; variants: unknown[]; addonGroupIds: unknown[] }> };
    const dish = menu.items.find((i) => !i.variants.length && !i.addonGroupIds.length)!;
    const placed = await fetch(`${hubBase}/s/spice-garden/a/tableqr/api/order`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ t: token, guestId: 'phone-on-4g-01', covers: 2, lines: [{ itemId: dish.id, qty: 2 }] }),
    });
    expect(placed.status).toBe(200);
    expect(await placed.json()).toMatchObject({ status: 'pending' });
    // it is on the outlet, waiting for staff; nothing about it is kept on the hub
    expect(db.prepare("SELECT count(*) FROM tableqr_request WHERE kind = 'order' AND status = 'pending' AND guest_id = 'phone-on-4g-01'").pluck().get()).toBe(1);

    // the guest page's own errors come back as they are
    const bad = await fetch(`${hubBase}/s/spice-garden/a/tableqr/api/table?t=not-a-valid-token-xyz`);
    expect(bad.status).toBe(404);
    expect(((await bad.json()) as { error: { message: string } }).error.message).toMatch(/no longer valid/);
  });

  it('codes switched back to Wi-Fi (online orders off): the outlet leaves the hub, so guests there are told it is offline', { timeout: 30_000 }, async () => {
    await app.inject({ method: 'POST', url: '/v1/addons/tableqr/settings', payload: { enabled: true, acceptMode: 'staff', payOnline: false, baseUrl: '', codeAddress: 'wifi', welcome: '' } });
    await expect.poll(() => app.online.status().connection, { timeout: 20_000 }).toBe('off');
    // and a request still arriving is refused by the outlet itself
    const answer = await app.guestRelay({ id: 'late', method: 'GET', path: '/a/tableqr/api/table', query: `t=${token}`, body: null, ip: '203.0.113.9' });
    expect(answer.status).toBe(404);
  });
});
