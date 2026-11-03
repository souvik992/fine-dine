// P4-02 acceptance in a real browser: a kitchen screen opens /kds?station=<kitchen> on the outlet server, pairs (a
// manager approves the code) and — with nobody signed in — shows a KOT the moment a terminal fires it; a change slip
// sits on its ticket; the cook bumps it to Ready, then Served, and undoes a mistaken Served.
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { _electron, type ElectronApplication } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const repo = path.resolve(here, '..', '..');
const PORT = 7481;
const SERVER = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;
let dataDir: string;
let screen: ElectronApplication;
let approver = '';
let manager = '';
let kitchenId = '';

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
const get = async <T,>(url: string) => (await (await fetch(`${SERVER}${url}`, { headers: { authorization: `Device ${approver}`, 'x-user-session': manager } })).json()) as T;
async function send(type: string, payload: unknown, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const res = await fetch(`${SERVER}/v1/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Device ${approver}`, 'x-user-session': manager, ...headers },
    body: JSON.stringify({ commandId: ulid(), type, payload, createdAt: new Date().toISOString(), ...extra }),
  });
  return (await res.json()) as { ok: boolean; error?: unknown; order?: { id: string; version: number } };
}

describe('kitchen display', () => {
  beforeAll(async () => {
    execSync('npm run build -w @dinepos/kds', { cwd: repo, stdio: 'ignore' });
    dataDir = mkdtempSync(path.join(tmpdir(), 'dinepos-kds-'));
    server = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], {
      cwd: repo,
      env: cleanEnv({ DATA_DIR: dataDir, DINEPOS_PORT: String(PORT), DINEPOS_HOST: '127.0.0.1', LOG_LEVEL: 'warn', DINEPOS_TRUST_LOOPBACK: '0' }),
      stdio: 'ignore',
    });
    for (let i = 0; i < 150; i++) {
      try {
        if ((await fetch(`${SERVER}/v1/health`)).ok) break;
      } catch {
        // starting
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    approver = randomBytes(32).toString('base64url');
    const db = new Database(path.join(dataDir, 'dev.db'));
    db.pragma('busy_timeout = 5000');
    db.prepare("INSERT INTO device (id, name, kind, token_hash, paired_at) VALUES (?, 'Counter 1', 'terminal', ?, ?)").run(ulid(), createHash('sha256').update(`device:${approver}`).digest('hex'), new Date().toISOString());
    db.close();
    execSync(`"${process.execPath}" --import tsx apps/server/src/seed/cli.ts`, { cwd: repo, env: cleanEnv({ DINEPOS_URL: SERVER, DINEPOS_DEVICE_TOKEN: approver }), stdio: 'ignore' });
    const users = (await get<{ users: Array<{ id: string; name: string }> }>('/v1/setup-state')).users;
    const vikram = users.find((u) => u.name.startsWith('Vikram'))!;
    manager = (
      (await (
        await fetch(`${SERVER}/v1/sessions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Device ${approver}` }, body: JSON.stringify({ userId: vikram.id, pin: '2345' }) })
      ).json()) as { token: string }
    ).token;
    kitchenId = (await get<{ stations: Array<{ id: string; name: string }> }>('/v1/menu')).stations.find((s) => s.name === 'Kitchen')!.id;

    const electron = createRequire(import.meta.url)('electron') as unknown as string;
    screen = await _electron.launch({
      executablePath: electron,
      args: [path.join(here, 'e2e', 'phone-browser.cjs')],
      env: cleanEnv({ OPEN_URL: `${SERVER}/kds/?station=${kitchenId}`, WINDOW_SIZE: '1280x800', DINEPOS_USER_DATA_DIR: path.join(dataDir, 'screen') }),
    });
  }, 240_000);

  afterAll(async () => {
    await screen?.close();
    server?.kill();
    await new Promise((r) => setTimeout(r, 500));
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('pairs with a code a manager approves, and opens on the station from the address with no sign-in', async () => {
    const page = await screen.firstWindow();
    await page.getByRole('heading', { name: 'Pair this kitchen screen' }).waitFor({ timeout: 20_000 });
    await page.getByLabel('Kitchen screen name').fill('Kitchen screen');
    await page.getByRole('button', { name: 'Get a pairing code' }).click();
    const code = (await page.getByTestId('pairing-code').innerText()).trim();
    expect((await send('PairDevice', { code }, {}, { 'x-manager-pin': '2345' })).ok).toBe(true);

    await page.getByRole('heading', { name: 'Kitchen' }).waitFor({ timeout: 10_000 });
    await page.getByText('Nothing to cook.').waitFor();
  });

  it('a KOT fired at a terminal appears at once; a change slip sits on it; Ready, then Served; Undo brings it back', async () => {
    const page = await screen.firstWindow();
    const floor = await get<{ tables: Array<{ id: string; label: string }> }>('/v1/floor');
    const menu = await get<{ items: Array<{ id: string; shortCode?: string }> }>('/v1/menu');
    const item = (code: string) => menu.items.find((i) => i.shortCode === code)!.id;
    const opened = await send('OpenTable', { tableId: floor.tables.find((t) => t.label === 'T2')!.id, covers: 3 });
    const added = await send(
      'AddItems',
      { items: [{ id: ulid(), itemId: item('DM'), qty: 2, note: 'less spicy' }, { id: ulid(), itemId: item('JR'), qty: 1, course: 2 }] },
      { orderId: opened.order!.id, expectedVersion: opened.order!.version },
    );
    const fired = await send('FireKOT', { all: true }, { orderId: opened.order!.id, expectedVersion: added.order!.version });

    // Live, no refresh: the ticket with its table, guests, note and courses; the all-day count.
    const fresh = page.getByRole('region', { name: 'New' }).locator('[data-kot]');
    await fresh.first().waitFor({ timeout: 5_000 });
    await expect.poll(() => fresh.count()).toBe(1);
    const ticket = fresh.first();
    await ticket.getByText('T2', { exact: true }).waitFor();
    await ticket.getByText('! less spicy').waitFor();
    await ticket.getByText('Course 2').waitFor();
    expect(await ticket.getByTestId('age').innerText()).toMatch(/^0:\d\d/);
    await page.locator('[data-all-day="Dal Makhani"]').getByText('2').waitFor();

    // The guest wants one dal less: the change slip appears on the same ticket and the all-day count drops.
    const dal = (await get<{ items: Array<{ id: string; name: string }> }>(`/v1/orders/${opened.order!.id}`)).items.find((i) => i.name === 'Dal Makhani')!;
    expect((await send('ModifyFiredItem', { orderItemId: dal.id, newQty: 1, reason: 'Guest changed mind' }, { orderId: opened.order!.id, expectedVersion: fired.order!.version })).ok).toBe(true);
    await ticket.locator('[data-slip]').getByText('Reason: Guest changed mind').waitFor({ timeout: 5_000 });
    expect(await fresh.count()).toBe(1); // still one card
    await page.locator('[data-all-day="Dal Makhani"]').getByText('1').waitFor();

    await ticket.getByRole('button', { name: 'Ready' }).click();
    const ready = page.getByRole('region', { name: 'Ready' }).locator('[data-kot]');
    await ready.first().waitFor({ timeout: 5_000 });
    expect(await fresh.count()).toBe(0);
    const board = await get<{ tickets: Array<{ readyAt?: string }> }>(`/v1/kds/tickets?stationId=${kitchenId}`);
    expect(board.tickets.map((t) => Boolean(t.readyAt))).toEqual([true, true]); // the ticket and its slip
    expect(await page.locator('[data-all-day]').count()).toBe(0); // nothing left to cook

    await ready.first().getByRole('button', { name: 'Served' }).click();
    await page.getByRole('status').getByText(/KOT \d{4} served\./).waitFor();
    await expect.poll(() => ready.count()).toBe(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await fresh.first().waitFor({ timeout: 5_000 }); // back to New after a mistaken Served
    expect((await get<{ tickets: unknown[] }>(`/v1/kds/tickets?stationId=${kitchenId}`)).tickets).toHaveLength(2);
  });

  it('the kitchen speed report counts the bumped ticket', async () => {
    const page = await screen.firstWindow();
    await page.getByRole('region', { name: 'New' }).getByRole('button', { name: 'Ready' }).click();
    const report = await get<{ rows: Array<{ station: string; tickets: number }> }>('/v1/reports/kitchen');
    expect(report.rows.find((r) => r.station === 'Kitchen')!.tickets).toBe(1);
  });
});
