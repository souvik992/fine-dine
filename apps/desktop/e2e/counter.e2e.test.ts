// Takeaway and delivery from the floor: "+ Takeaway" / "+ Delivery" start an order without a table, it is punched,
// sent, billed and settled like a table, and its card on the floor shows where it is until it is paid.
// Drives the real Electron app against a real outlet server. Run: npm run test:e2e -w @dinepos/desktop (builds first).
import { spawn, type ChildProcess } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, type ElectronApplication, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const repo = path.resolve(here, '..', '..');
const PORT = 7477;
const SERVER = `http://127.0.0.1:${PORT}`;
/** Screenshots for a person to look at (not compared). */
const SHOTS = process.env.DINEPOS_E2E_SHOTS ?? tmpdir();

let server: ChildProcess;
let dataDir: string;
let app: ElectronApplication;
let page: Page;
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
async function waitForHealth(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${SERVER}/v1/health`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not start');
}
async function run(args: string[], env: Record<string, string>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const p = spawn(process.execPath, args, { cwd: repo, env: cleanEnv(env), stdio: 'ignore' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exited ${code}`))));
  });
}
async function command(type: string, payload: unknown): Promise<void> {
  const res = await fetch(`${SERVER}/v1/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-session': token },
    body: JSON.stringify({ commandId: ulid(), type, payload, createdAt: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`${type}: ${await res.text()}`);
}
const floor = async () => (await (await fetch(`${SERVER}/v1/floor`)).json()) as { counterOrders?: Array<{ type: string; ticketNo: number; stage: string }> };

const keys = generateKeyPairSync('ed25519');
const HARDWARE_ID = 'E2E0-0000-0000-0000-0007';
function testLicence(): string {
  const body = Buffer.from(
    JSON.stringify({
      v: 1,
      licensee: 'Spice Garden (E2E)',
      hardwareId: HARDWARE_ID,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
      seats: { terminals: 3, captains: 4, kds: 2 },
      features: [],
    }),
  );
  return `${body.toString('base64url')}.${sign(null, body, keys.privateKey).toString('base64url')}`;
}

describe('takeaway and delivery from the floor', () => {
  beforeAll(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'dinepos-e2e-counter-'));
    const env = cleanEnv({
      DATA_DIR: dataDir,
      DINEPOS_PORT: String(PORT),
      DINEPOS_HOST: '127.0.0.1',
      LOG_LEVEL: 'warn',
      DINEPOS_LICENCE_PUBLIC_KEY: keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      DINEPOS_HARDWARE_ID: HARDWARE_ID,
    });
    server = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], { cwd: repo, env, stdio: 'ignore' });
    await waitForHealth();
    await run(['--import', 'tsx', 'apps/server/src/seed/cli.ts'], { DINEPOS_URL: SERVER });
    const state = (await (await fetch(`${SERVER}/v1/setup-state`)).json()) as { users: Array<{ id: string; name: string }> };
    const manager = state.users.find((u) => u.name.startsWith('Vikram'))!;
    const res = await fetch(`${SERVER}/v1/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: manager.id, pin: '2345' }) });
    token = ((await res.json()) as { token: string }).token;
    await command('InstallLicence', { key: testLicence() });

    const electron = createRequire(import.meta.url)('electron') as unknown as string;
    app = await _electron.launch({ executablePath: electron, args: [here], cwd: here, env: cleanEnv({ DINEPOS_SERVER_URL: SERVER, DINEPOS_USER_DATA_DIR: path.join(dataDir, 'profile') }) });
    page = await app.firstWindow();
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.getByRole('button', { name: /Asha \(Owner\)/ }).click({ timeout: 20_000 });
    await page.keyboard.type('1234');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-table="T1"]', { timeout: 10_000 });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    server?.kill();
    await new Promise((r) => setTimeout(r, 500));
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('the floor offers new takeaway and delivery orders in the top bar; no strip while none is open', async () => {
    const bar = page.getByRole('banner');
    await bar.getByTestId('new-takeaway').waitFor();
    await bar.getByTestId('new-delivery').waitFor();
    expect(await page.getByTestId('counter-orders').count()).toBe(0);
    expect(await page.locator('[data-table]').count()).toBe(8); // the tables are still there
  });

  it('a takeaway: start it with a name, punch, send to the kitchen; its card shows it cooking', async () => {
    await page.getByTestId('new-takeaway').click();
    const dialog = page.getByRole('dialog', { name: 'New takeaway order' });
    await dialog.waitFor();
    await page.keyboard.type('Meera'); // the name is focused
    await dialog.getByRole('button', { name: 'Start order' }).click();
    await page.getByTestId('order-title').getByText('Takeaway #1').waitFor({ timeout: 5_000 });
    expect(await page.getByRole('button', { name: 'Move', exact: true }).count()).toBe(0); // nothing to move to
    await page.getByRole('button', { name: 'Cancel order' }).waitFor(); // nothing sent yet: it can be cancelled

    await page.getByLabel('Add item').waitFor();
    await page.keyboard.type('dm2');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.getByTestId('held-items').locator('li').count(), { timeout: 5_000 }).toBe(1);
    await page.keyboard.press('F8');
    await expect.poll(() => page.getByTestId('kot-group').count(), { timeout: 5_000 }).toBeGreaterThan(0);
    await page.screenshot({ path: path.join(SHOTS, 'dinepos-takeaway-order.png') });

    await page.keyboard.press('Escape');
    const card = page.locator('[data-counter="Takeaway #1"]');
    await card.waitFor({ timeout: 5_000 });
    expect(await card.getAttribute('data-stage')).toBe('kitchen');
    expect(await card.getAttribute('aria-label')).toMatch(/In the kitchen, Meera, 2 items/);
  });

  it('a delivery needs a phone and an address; they show on the order and print on the bill; paid, its card goes', async () => {
    await page.getByTestId('new-delivery').click();
    const dialog = page.getByRole('dialog', { name: 'New delivery order' });
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Start order' }).click();
    await expect.poll(() => dialog.getByRole('alert').innerText()).toMatch(/phone number/);
    await dialog.getByLabel('Customer name').fill('Ravi');
    await dialog.getByLabel('Phone').fill('98300 12345');
    await dialog.getByRole('button', { name: 'Start order' }).click();
    await expect.poll(() => dialog.getByRole('alert').innerText()).toMatch(/address/);
    await dialog.getByLabel('Delivery address').fill('12 Park Street, near the metro, Kolkata');
    await page.screenshot({ path: path.join(SHOTS, 'dinepos-delivery-dialog.png') });
    await dialog.getByRole('button', { name: 'Start order' }).click();

    await page.getByTestId('order-title').getByText('Delivery #2').waitFor({ timeout: 5_000 });
    await page.getByTestId('delivery-address').getByText(/12 Park Street/).waitFor();
    await page.getByText('Ravi · 98300 12345').waitFor();
    await page.keyboard.type('dm');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.getByTestId('held-items').locator('li').count(), { timeout: 5_000 }).toBe(1);
    await page.keyboard.press('F8');
    await expect.poll(() => page.getByTestId('held-items').locator('li').count(), { timeout: 5_000 }).toBe(0);
    await page.screenshot({ path: path.join(SHOTS, 'dinepos-delivery-order.png') });

    await page.keyboard.press('F9');
    const bill = page.getByRole('dialog', { name: 'Print bill' });
    await bill.waitFor();
    await page.keyboard.press('Enter'); // no discount: print
    await bill.waitFor({ state: 'detached' });
    await page.keyboard.press('F10');
    await page.getByRole('dialog', { name: /^Settle B\// }).waitFor();
    await page.keyboard.type('1000');
    await page.keyboard.press('Enter');
    const done = page.getByRole('dialog', { name: 'Bill settled' });
    await done.waitFor();
    expect(await done.innerText()).not.toMatch(/table is free/);
    await page.keyboard.press('Enter'); // back to the floor
    await page.locator('[data-counter="Takeaway #1"]').waitFor();
    await expect.poll(() => page.locator('[data-counter="Delivery #2"]').count(), { timeout: 5_000 }).toBe(0);
    expect((await floor()).counterOrders?.map((o) => [o.type, o.ticketNo, o.stage])).toEqual([['takeaway', 1, 'kitchen']]);
  });

  it('a takeaway opened by mistake is cancelled from the order', async () => {
    await page.getByTestId('new-takeaway').click();
    await page.getByRole('dialog', { name: 'New takeaway order' }).getByRole('button', { name: 'Start order' }).click();
    await page.getByTestId('order-title').getByText('Takeaway #3').waitFor({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Cancel order' }).click();
    const dialog = page.getByRole('dialog', { name: 'Cancel Takeaway #3?' });
    await dialog.getByRole('button', { name: 'Opened by mistake' }).click();
    await dialog.getByRole('button', { name: 'Cancel order' }).click();
    await page.waitForSelector('[data-table="T1"]', { timeout: 5_000 });
    await expect.poll(() => page.locator('[data-counter="Takeaway #3"]').count(), { timeout: 5_000 }).toBe(0);
    await page.screenshot({ path: path.join(SHOTS, 'dinepos-floor-counter.png') });
  });
});
