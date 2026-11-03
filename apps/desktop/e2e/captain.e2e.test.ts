// P3-01 acceptance in a real browser: a phone opens /captain on the outlet server, pairs (a manager approves the
// code), signs in with a PIN, sees the tables live and seats one.
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
const PORT = 7471;
const SERVER = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;
let dataDir: string;
let phone: ElectronApplication;
let approver = ''; // a paired terminal's device token
let manager = ''; // Vikram signed in on it

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
const get = async <T,>(url: string) => (await (await fetch(`${SERVER}${url}`, { headers: { authorization: `Device ${approver}` } })).json()) as T;
/** A command from the manager's terminal. */
async function send(type: string, payload: unknown, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const res = await fetch(`${SERVER}/v1/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Device ${approver}`, 'x-user-session': manager, ...headers },
    body: JSON.stringify({ commandId: ulid(), type, payload, createdAt: new Date().toISOString(), ...extra }),
  });
  return (await res.json()) as { ok: boolean; error?: unknown; order?: { id: string; version: number } };
}

describe('captain app on a phone', () => {
  beforeAll(async () => {
    execSync('npm run build -w @dinepos/captain', { cwd: repo, stdio: 'ignore' });
    dataDir = mkdtempSync(path.join(tmpdir(), 'dinepos-captain-'));
    server = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], {
      cwd: repo,
      env: cleanEnv({ DATA_DIR: dataDir, DINEPOS_PORT: String(PORT), DINEPOS_HOST: '127.0.0.1', LOG_LEVEL: 'warn', DINEPOS_TRUST_LOOPBACK: '0' }),
      stdio: 'ignore',
    });
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`${SERVER}/v1/health`)).ok) break;
      } catch {
        // starting
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    // A paired terminal (the manager's) straight in the database, then the demo outlet through it.
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

    const electron = createRequire(import.meta.url)('electron') as unknown as string;
    phone = await _electron.launch({
      executablePath: electron,
      args: [path.join(here, 'e2e', 'phone-browser.cjs')],
      env: cleanEnv({ OPEN_URL: `${SERVER}/captain/`, DINEPOS_USER_DATA_DIR: path.join(dataDir, 'phone') }),
    });
  }, 180_000);

  afterAll(async () => {
    await phone?.close();
    server?.kill();
    await new Promise((r) => setTimeout(r, 500));
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('pairs with a code a manager approves, then the captain signs in with a PIN and sees the tables', async () => {
    const page = await phone.firstWindow();
    await page.getByRole('heading', { name: 'Pair this phone' }).waitFor({ timeout: 20_000 });
    await page.getByLabel('Phone name').fill('Ravi phone');
    await page.getByRole('button', { name: 'Get a pairing code' }).click();
    const code = (await page.getByTestId('pairing-code').innerText()).trim();
    expect((await send('PairDevice', { code }, {}, { 'x-manager-pin': '2345' })).ok).toBe(true);

    await page.getByText('Who is taking orders?').waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Ravi (Captain)' }).click();
    for (const d of '3333') await page.getByRole('button', { name: d, exact: true }).click();
    await page.getByRole('button', { name: 'OK' }).click();
    await page.getByRole('heading', { name: 'Tables' }).waitFor({ timeout: 10_000 });
    expect(await page.locator('[data-table]').count()).toBe(8); // Main Hall
  });

  it('seats a free table from the phone; a KOT sent at a terminal shows on the phone at once', async () => {
    const page = await phone.firstWindow();
    await page.locator('[data-table="T3"]').click();
    const sheet = page.getByRole('dialog', { name: 'Seat T3' });
    await sheet.getByRole('button', { name: 'One more guest' }).click();
    await sheet.getByRole('button', { name: 'One more guest' }).click();
    await sheet.getByRole('button', { name: 'Seat 4 guests' }).click();
    await page.locator('[data-table="T3"][data-state="SEATED"]').waitFor({ timeout: 5_000 });

    const t3 = (await get<{ tables: Array<{ label: string; orderId?: string; orderVersion?: number; covers?: number }> }>('/v1/floor')).tables.find((t) => t.label === 'T3')!;
    expect(t3.covers).toBe(4);
    const dal = (await get<{ items: Array<{ id: string; shortCode?: string }> }>('/v1/menu')).items.find((i) => i.shortCode === 'DM')!;
    const added = await send('AddItems', { items: [{ id: ulid(), itemId: dal.id, qty: 2 }] }, { orderId: t3.orderId, expectedVersion: t3.orderVersion });
    await send('FireKOT', { all: true }, { orderId: t3.orderId, expectedVersion: added.order!.version });
    await page.locator('[data-table="T3"][data-state="KOT_RUNNING"]').waitFor({ timeout: 3_000 }); // live, no refresh
    await page.locator('[data-table="T3"]').click();
    await page.getByRole('dialog', { name: 'Table T3' }).getByText('Dal Makhani').waitFor();
  });
});
