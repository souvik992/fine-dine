// P4-06 acceptance against the real order hub (pos-backend/hub, contract v1): DinePOS pairs with a connection link,
// publishes its menu, a customer places a pickup order (cash at pickup), it appears on the Online orders screen, staff
// accept it (KOT + GST bill at DinePOS prices), mark it ready and collected — and the customer sees each state.
// Runs only where the hub's code is (HUB_DIR, default C:\Users\PL\Documents\pos-backend\hub) and Node 24+ runs it.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, type ElectronApplication } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const repo = path.resolve(here, '..', '..');
const HUB_DIR = process.env.HUB_DIR ?? 'C:\\Users\\PL\\Documents\\pos-backend\\hub';
const hubThere = existsSync(path.join(HUB_DIR, 'src', 'main.ts')) && Number(process.versions.node.split('.')[0]) >= 24;
/** P4-05: hubs with the DinePOS sync endpoints (pos-backend branch dinepos-sync and later). */
const hubSyncs = existsSync(path.join(HUB_DIR, 'src', 'sync.ts'));
const PORT = 7491;
const HUB_PORT = 4977;
const SERVER = `http://127.0.0.1:${PORT}`;
const HUB = `http://127.0.0.1:${HUB_PORT}`;
const ADMIN_KEY = 'e2e-admin-key-0123456789';
let server: ChildProcess;
let hub: ChildProcess;
let dataDir: string;
let app: ElectronApplication;
let token = '';

function cleanEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  return { ...env, ...extra };
}
const ulid = () => {
  const C = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let s = '01';
  while (s.length < 26) s += C[Math.floor(Math.random() * 32)];
  return s;
};
async function up(url: string): Promise<void> {
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      // starting
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${url} did not start`);
}
const get = async <T,>(url: string) => (await (await fetch(`${SERVER}${url}`, { headers: { 'x-user-session': token } })).json()) as T;
async function command(type: string, payload: unknown) {
  const res = await fetch(`${SERVER}/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-session': token }, body: JSON.stringify({ commandId: ulid(), type, payload, createdAt: new Date().toISOString() }) });
  return (await res.json()) as { ok: boolean; error?: { message: string } };
}
const hubJson = async <T,>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
  (await (await fetch(`${HUB}${url}`, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })).json()) as T;
async function until<T>(check: () => Promise<T | undefined | null | false>, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe.skipIf(!hubThere)('online orders through the real order hub', () => {
  beforeAll(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'dinepos-online-'));
    hub = spawn(process.execPath, ['src/main.ts'], {
      cwd: HUB_DIR,
      env: cleanEnv({ HUB_PORT: String(HUB_PORT), HUB_HOST: '127.0.0.1', HUB_DATA_DIR: path.join(dataDir, 'hub'), HUB_ADMIN_KEY: ADMIN_KEY, HUB_DEV_OTP: '1', HUB_PUBLIC_URL: HUB }),
      stdio: 'ignore',
    });
    server = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], {
      cwd: repo,
      env: cleanEnv({ DATA_DIR: path.join(dataDir, 'pos'), DINEPOS_PORT: String(PORT), DINEPOS_HOST: '127.0.0.1', LOG_LEVEL: 'warn' }),
      stdio: 'ignore',
    });
    await up(`${HUB}/v1/stores/none`);
    await up(`${SERVER}/v1/health`);
    const seed = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/seed/cli.ts'], { cwd: repo, env: cleanEnv({ DINEPOS_URL: SERVER }), stdio: 'ignore' });
    await new Promise((r) => seed.once('exit', r));
    const users = ((await (await fetch(`${SERVER}/v1/setup-state`)).json()) as { users: Array<{ id: string; name: string }> }).users;
    const owner = users.find((u) => u.name.startsWith('Asha'))!;
    token = ((await (await fetch(`${SERVER}/v1/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: owner.id, pin: '1234' }) })).json()) as { token: string }).token;

    // Online orders on: pickup + delivery, cash at pickup and online, open all day, GST on charges 18%.
    const allDay = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [{ open: '00:00', close: '23:59' }]]));
    const cfg = (await get<{ 'online.settings': Record<string, unknown> }>('/v1/config'))['online.settings'];
    const settings = { ...cfg, enabled: true, acceptMode: 'manual', fulfilment: { pickup: true, delivery: true }, payments: { online: true, cod: true }, feeTaxBp: 1800, serviceability: { ...(cfg.serviceability as object), hours: allDay, location: { lat: 22.5726, lng: 88.3639, label: 'Park Street, Kolkata' } } };
    expect((await command('SetConfig', { values: { 'online.settings': settings } })).ok).toBe(true);

    const electron = createRequire(import.meta.url)('electron') as unknown as string;
    app = await _electron.launch({ executablePath: electron, args: [here], cwd: here, env: cleanEnv({ DINEPOS_SERVER_URL: SERVER, DINEPOS_USER_DATA_DIR: path.join(dataDir, 'profile') }) });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    server?.kill();
    hub?.kill();
    await new Promise((r) => setTimeout(r, 800));
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('pairs with a connection link from the hub; the hub gets the menu and sees the restaurant taking orders', async () => {
    const store = await hubJson<{ connectUrl: string }>('POST', '/v1/admin/stores', { slug: 'spice', name: 'Spice Garden' }, { authorization: `Bearer ${ADMIN_KEY}`, 'x-admin-key': ADMIN_KEY });
    expect(store.connectUrl).toMatch(/\/connect\//);
    const page = await app.firstWindow();
    await page.getByRole('button', { name: /Asha \(Owner\)/ }).click({ timeout: 20_000 });
    await page.keyboard.type('1234');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-table="T1"]', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: /^Online orders/ }).click();
    await page.getByLabel('Connection link').fill(store.connectUrl);
    await page.getByRole('button', { name: 'Connect' }).click();
    await page.getByTestId('hub-link').getByText('Connected to Spice Garden').waitFor({ timeout: 15_000 });

    const shop = await until(async () => {
      const s = await hubJson<{ menu?: { version: number; items: Array<{ id: string; name: string }> }; open?: boolean; accepting?: boolean }>('GET', '/v1/stores/spice');
      return s.menu?.items.some((i) => i.name === 'Butter Chicken (Full)') ? s : null;
    });
    expect(shop.menu!.items.find((i) => i.name === 'Dal Makhani')).toBeDefined();
    await page.getByRole('button', { name: 'Floor', exact: true }).click();
  });

  it('a pickup order (cash at pickup) arrives, is accepted (KOT + bill), marked ready and collected; the customer sees it', async () => {
    const page = await app.firstWindow();
    const store = await hubJson<{ menu: { version: number; items: Array<{ id: string; name: string }> } }>('GET', '/v1/stores/spice');
    const dal = store.menu.items.find((i) => i.name === 'Dal Makhani')!;
    const mobile = '9830012345';
    const otp = await hubJson<{ devCode: string }>('POST', '/v1/otp/send', { mobile });
    const verified = await hubJson<{ otpToken: string }>('POST', '/v1/otp/verify', { mobile, otp: otp.devCode });
    const place = (expectedTotal: number) =>
      fetch(`${HUB}/v1/stores/spice/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': `e2e-${expectedTotal}` },
        body: JSON.stringify({ fulfilment: 'PICKUP', payment: 'COD', customer: { name: 'Priya', mobile }, otpToken: verified.otpToken, lines: [{ itemId: dal.id, qtyMilli: 2000 }], menuVersion: store.menu.version, expectedTotal }),
      });
    let res = await place(1);
    let body = (await res.json()) as { error?: { code: string; details?: { total?: number } }; order?: { id: string; number: string; total: number }; accessToken?: string; id?: string; number?: string; total?: number };
    if (res.status === 409 && body.error?.code === 'PRICE_CHANGED') {
      res = await place(body.error.details!.total!); // the app shows the hub's total and asks again
      body = (await res.json()) as typeof body;
    }
    expect(res.status).toBe(201);
    const order = body.order ?? (body as { id: string; number: string; total: number });

    // On the counter: the new order alert, then the Online orders screen.
    await page.getByTestId('online-alert').click({ timeout: 15_000 });
    const card = page.locator(`[data-online="${order.number}"]`);
    await card.getByText('PAY AT PICKUP').waitFor();
    await card.getByText('2 ×').waitFor();
    await card.getByRole('button', { name: 'Accept' }).click();
    await card.getByText(/^Bill B\//).waitFor({ timeout: 10_000 });

    const view = (await get<{ orders: Array<{ number: string; state: string; posTotalPaise: number; order: { total: number }; alert: string | null }> }>('/v1/online/orders')).orders.find((o) => o.number === order.number)!;
    expect(view.state).toBe('ACCEPTED');
    expect(view.posTotalPaise).toBe(view.order.total); // DinePOS bills what the customer was shown
    await card.getByRole('button', { name: 'Ready' }).click();
    await card.getByRole('button', { name: 'Collected' }).click();

    // The customer's view on the hub follows (the outbox delivered every step).
    await until(async () => {
      const r = await fetch(`${HUB}/v1/admin/orders?store=spice`, { headers: { 'x-admin-key': ADMIN_KEY } });
      const j = (await r.json()) as { orders?: Array<{ number: string; state: string; posBillNo: string | null }> };
      const o = j.orders?.find((x) => x.number === order.number);
      return o?.state === 'PICKED_UP' && o.posBillNo?.startsWith('B/') ? o : null;
    });
    const status = await get<{ pendingActions: number }>('/v1/online');
    expect(status.pendingActions).toBe(0);
  });

  it.skipIf(!hubSyncs)('cloud sync: the bill reaches the hub owner’s sales view; nothing is left waiting', async () => {
    const day = await until(async () => {
      const r = await fetch(`${HUB}/v1/admin/stores/spice/sales`, { headers: { 'x-admin-key': ADMIN_KEY } });
      const j = (await r.json()) as { days?: Array<{ businessDate: string; closed: boolean; bills: number; netSalesPaise: number }> };
      return j.days?.[0] && j.days[0].bills >= 1 ? j.days[0] : null;
    });
    expect(day.closed).toBe(false);
    expect(day.netSalesPaise).toBeGreaterThan(0);
    const sync = await until(async () => {
      const s = await get<{ state: string; pending: number; paired: boolean }>('/v1/sync');
      return s.pending === 0 && s.state === 'idle' ? s : null;
    });
    expect(sync.paired).toBe(true);
  });
});
