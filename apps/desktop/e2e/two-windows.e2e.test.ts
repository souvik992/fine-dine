// P1-08 acceptance: two desktop windows show the same table state change within 1 s.
// Drives the real Electron app (built renderer on app://dinepos) against a real outlet server process.
// Run: npm run test:e2e -w @dinepos/desktop (builds first).
import { spawn, type ChildProcess } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, type ElectronApplication, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// path.resolve drops the trailing slash: on Windows a quoted 'dir\"' would escape the closing quote.
const here = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const repo = path.resolve(here, '..', '..');
const PORT = 7461;
/**
 * DINEPOS_E2E_PACKAGED=1 tests the built release instead of the dev build: release/win-unpacked/DinePOS.exe, and the
 * server started exactly as the Windows service starts it (resources/server/node.exe server.mjs, production mode).
 */
const PACKAGED = process.env.DINEPOS_E2E_PACKAGED === '1';
const unpacked = path.join(here, 'release', 'win-unpacked');
const SERVER = `http://127.0.0.1:${PORT}`;

let server: ChildProcess;
let dataDir: string;
let app: ElectronApplication;

function cleanEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  return { ...env, ...extra };
}

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

async function run(cmd: string, args: string[], env: Record<string, string>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: repo, env: cleanEnv(env), stdio: 'ignore' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exited ${code}`))));
  });
}

/** A separate sign-in (the demo manager) for commands the test sends from outside the app. */
let testToken = '';
async function signInForTest(): Promise<void> {
  const state = (await (await fetch(`${SERVER}/v1/setup-state`)).json()) as { users: Array<{ id: string; name: string }> };
  const manager = state.users.find((u) => u.name.startsWith('Vikram'))!;
  const res = await fetch(`${SERVER}/v1/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: manager.id, pin: '2345' }) });
  testToken = ((await res.json()) as { token: string }).token;
}

async function command(type: string, payload: unknown): Promise<void> {
  const res = await fetch(`${SERVER}/v1/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-session': testToken },
    body: JSON.stringify({ commandId: ulid(), type, payload, createdAt: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`${type}: ${await res.text()}`);
}

function ulid(): string {
  const C = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let s = '01';
  while (s.length < 26) s += C[Math.floor(Math.random() * 32)];
  return s;
}

const tileState = (page: Page, label: string) => page.locator(`[data-table="${label}"]`).getAttribute('data-state');

// P2-09: the server checks a licence as the installed one does — here against a test key pair, for a fixed PC id.
const licenceKeys = generateKeyPairSync('ed25519');
const HARDWARE_ID = 'E2E0-0000-0000-0000-0001';
function testLicence(): string {
  const payload = {
    v: 1,
    licensee: 'Spice Garden (E2E)',
    hardwareId: HARDWARE_ID,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    seats: { terminals: 3, captains: 4, kds: 2 },
    features: [],
  };
  const body = Buffer.from(JSON.stringify(payload));
  return `${body.toString('base64url')}.${sign(null, body, licenceKeys.privateKey).toString('base64url')}`;
}
let licenceBefore: { businessDate: string | null; licence?: { state: string; canOpenDay: boolean } } | null = null;

describe('desktop app', () => {
  beforeAll(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'dinepos-e2e-'));
    const serverEnv = cleanEnv({
      DATA_DIR: dataDir,
      DINEPOS_PORT: String(PORT),
      DINEPOS_HOST: '127.0.0.1',
      LOG_LEVEL: 'warn',
      DINEPOS_LICENCE_PUBLIC_KEY: licenceKeys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      DINEPOS_HARDWARE_ID: HARDWARE_ID,
    });
    server = PACKAGED
      ? spawn(path.join(unpacked, 'resources', 'server', 'node.exe'), ['server.mjs'], {
          cwd: path.join(unpacked, 'resources', 'server'),
          env: { ...serverEnv, NODE_ENV: 'production' },
          stdio: 'ignore',
        })
      : spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], { cwd: repo, env: serverEnv, stdio: 'ignore' });
    await waitForHealth();
    await run(process.execPath, ['--import', 'tsx', 'apps/server/src/seed/cli.ts'], { DINEPOS_URL: SERVER });
    await signInForTest();
    if (!PACKAGED) {
      // No key yet: no business day opened. Then the manager installs one (a packaged run needs a real key instead).
      licenceBefore = (await (await fetch(`${SERVER}/v1/health`)).json()) as typeof licenceBefore;
      await command('InstallLicence', { key: testLicence() });
    }

    const electron = createRequire(import.meta.url)('electron') as unknown as string;
    app = PACKAGED
      ? await _electron.launch({ executablePath: path.join(unpacked, 'DinePOS.exe'), args: [], cwd: unpacked, env: cleanEnv({ DINEPOS_SERVER_URL: SERVER, DINEPOS_USER_DATA_DIR: path.join(dataDir, 'profile') }) })
      : await _electron.launch({ executablePath: electron, args: [here], cwd: here, env: cleanEnv({ DINEPOS_SERVER_URL: SERVER, DINEPOS_USER_DATA_DIR: path.join(dataDir, 'profile') }) });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    server?.kill();
    await new Promise((r) => setTimeout(r, 500));
    rmSync(dataDir, { recursive: true, force: true });
  });

  // P2-01: nothing works before a staff member signs in with their PIN.
  it('asks who is signing in; a wrong PIN is refused, the right one opens the floor', async () => {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: /Asha \(Owner\)/ }).click({ timeout: 20_000 });
    await page.keyboard.type('9999');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.getByRole('alert').innerText()).toMatch(/Wrong name or PIN/);
    await page.keyboard.type('1234');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-table="T1"]', { timeout: 10_000 });
    expect(await page.getByTestId('signed-in-user').innerText()).toContain('Asha (Owner)');
  });

  it('Licence (P2-09): no business day until a key was installed; Settings › Licence shows it, this PC’s id and seats', async () => {
    if (PACKAGED) return;
    expect(licenceBefore).toMatchObject({ businessDate: null, licence: { state: 'none', canOpenDay: false } });
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: /^Licence/ }).click();
    await page.getByTestId('licence-status').getByText('Licensed', { exact: true }).waitFor();
    await page.getByTestId('licence-status').getByText(/Spice Garden \(E2E\)/).waitFor();
    expect(await page.getByTestId('hardware-id').innerText()).toBe(HARDWARE_ID);
    await page.getByRole('list', { name: 'Seats' }).getByText('1 of 3').waitFor(); // this PC is one terminal
    // A key for another PC is refused with a reason.
    await page.getByLabel('Licence key').fill(testLicence().replace(/^[^.]+/, Buffer.from(JSON.stringify({ v: 1, licensee: 'x', hardwareId: '0000-0000-0000-0000-0000', issuedAt: '', expiresAt: '2030-01-01T00:00:00Z', seats: { terminals: 1, captains: 0, kds: 0 }, features: [] })).toString('base64url')));
    await page.getByRole('button', { name: 'Install key' }).click();
    await page.getByText(/not genuine|another computer/).waitFor();
    await page.getByRole('button', { name: 'Floor', exact: true }).click();
    expect(await page.getByTestId('licence-banner').count()).toBe(0); // licensed: no warning
  });

  it('loads on app://dinepos, locked down, showing the seeded floor', async () => {
    const page = await app.firstWindow();
    await page.waitForSelector('[data-table="T1"]', { timeout: 20_000 });
    expect(page.url()).toMatch(/^app:\/\/dinepos\/index\.html/);
    expect(await page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined'); // no Node in the page
    expect(await page.locator('[data-table]').count()).toBe(8); // Main Hall: T1..T8
    expect(await tileState(page, 'T1')).toBe('FREE');
    await page.getByTestId('link-status').getByText('Live').waitFor();
  });

  it('two windows show the same table change within 1 s', async () => {
    const first = await app.firstWindow();
    const secondPromise = app.waitForEvent('window');
    // Opens the second window through the app's own File > New window menu item.
    await app.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()?.getMenuItemById('new-window')?.click();
    });
    const second = await secondPromise;
    await second.waitForSelector('[data-table="T1"]', { timeout: 20_000 });
    await second.getByTestId('link-status').getByText('Live').waitFor();

    const floor = (await (await fetch(`${SERVER}/v1/floor`)).json()) as { tables: Array<{ id: string; label: string }> };
    const tableId = floor.tables.find((t) => t.label === 'T1')!.id;
    const started = Date.now();
    await command('OpenTable', { tableId, covers: 3 });
    await Promise.all(
      [first, second].map((p) => p.waitForSelector('[data-table="T1"][data-state="SEATED"]', { timeout: 1_000 })),
    );
    const elapsed = Date.now() - started;
    console.warn(`two-window update latency: ${elapsed} ms`);
    expect(elapsed).toBeLessThan(1_000);
    expect(await tileState(first, 'T1')).toBe('SEATED');
    expect(await tileState(second, 'T1')).toBe('SEATED');
  });

  it('seats a free table from the UI, opens its order, and the other window follows', async () => {
    const [first, second] = app.windows();
    await first!.locator('[data-table="T2"]').click();
    await first!.getByRole('dialog', { name: 'Seat table T2' }).waitFor();
    await first!.getByRole('button', { name: 'One more guest' }).click();
    await first!.getByRole('button', { name: 'Seat guests' }).click();
    await first!.getByTestId('order-title').getByText('Table T2').waitFor({ timeout: 5_000 });
    await second!.waitForSelector('[data-table="T2"][data-state="SEATED"]', { timeout: 2_000 });
    expect(await second!.locator('[data-table="T2"]').getAttribute('aria-label')).toContain('3 covers');
    await first!.keyboard.press('Escape'); // back to the floor
    await first!.waitForSelector('[data-table="T1"]');
  });

  it('typing a table label and Enter opens that order', async () => {
    const [first] = app.windows();
    await first!.keyboard.type('t1');
    await first!.keyboard.press('Enter');
    await first!.getByTestId('order-title').getByText('Table T1').waitFor({ timeout: 5_000 });
    await first!.keyboard.press('Escape');
    await first!.waitForSelector('[data-table="T1"]');
  });

  it('Release table: a table seated by mistake is freed without billing; the other window follows', async () => {
    const [first, second] = app.windows();
    await first!.locator('[data-table="T8"]').click();
    await first!.getByRole('dialog', { name: 'Seat table T8' }).waitFor();
    await first!.getByRole('button', { name: 'Seat guests' }).click();
    await first!.getByTestId('order-title').getByText('Table T8').waitFor({ timeout: 5_000 });
    await second!.waitForSelector('[data-table="T8"][data-state="SEATED"]', { timeout: 2_000 });
    await first!.getByRole('button', { name: 'Release' }).click();
    const dialog = first!.getByRole('dialog', { name: 'Release T8?' });
    await dialog.getByRole('button', { name: 'Opened by mistake' }).click();
    await dialog.getByRole('button', { name: 'Release table' }).click();
    await first!.waitForSelector('[data-table="T8"][data-state="FREE"]', { timeout: 5_000 }); // back on the floor
    await second!.waitForSelector('[data-table="T8"][data-state="FREE"]', { timeout: 2_000 });
  });

  // P1-09 acceptance: punch 5 items with modifiers and fire in under 20 s using the keyboard only.
  it('keyboard only: seat T3, punch 5 items with modifiers, fire, in under 20 s', async () => {
    const [page, other] = app.windows();
    const k = page!.keyboard;
    const sheet = (title: string) => page!.getByRole('dialog', { name: title });
    const started = Date.now();

    await k.type('t3');
    await k.press('Enter'); // seat dialog, covers focused
    await sheet('Seat table T3').waitFor();
    await k.press('Enter'); // seat with the default covers → order screen, search focused
    await page!.getByTestId('order-title').getByText('Table T3').waitFor();
    await page!.getByLabel('Add item').waitFor();

    await k.type('pt');
    await k.press('Enter'); // spice level is required → sheet
    await sheet('Paneer Tikka').waitFor();
    await k.press('1'); // Mild
    await k.press('Enter');

    await k.type('tc');
    await k.press('Enter'); // variants → sheet
    await sheet('Tandoori Chicken').waitFor();
    await k.press('1'); // Half
    await k.press('Enter');

    await k.type('bn4');
    await k.press('Shift+Enter'); // optional extras → ask for the sheet
    await sheet('Butter Naan').waitFor();
    await k.press('1'); // Extra cheese
    await k.press('Enter');

    await k.type('vm2');
    await k.press('Shift+Enter');
    await sheet('Virgin Mojito').waitFor();
    await k.press('1'); // Soda
    await k.press('Enter');

    await k.type('dm');
    await k.press('Enter'); // no choices → added directly
    await k.type('dm');
    await k.press('Enter'); // the same item again, quickly: raises the line instead of adding another
    await k.type('dm');
    await k.press('Enter');

    const held = page!.getByTestId('held-items').locator('li');
    await expect.poll(() => held.count(), { timeout: 5_000 }).toBe(5);
    await held.filter({ hasText: 'Dal Makhani' }).getByText('3', { exact: true }).waitFor({ timeout: 5_000 });
    await k.press('F8');
    await expect.poll(() => page!.getByTestId('kot-group').count(), { timeout: 5_000 }).toBeGreaterThan(0);
    await expect.poll(() => held.count(), { timeout: 5_000 }).toBe(0);
    const elapsed = Date.now() - started;
    console.warn(`keyboard-only punch + fire: ${elapsed} ms`);
    expect(elapsed).toBeLessThan(20_000);

    // The server has exactly what was punched, with modifiers, all fired.
    const floor = (await (await fetch(`${SERVER}/v1/floor`)).json()) as { tables: Array<{ label: string; orderId?: string }> };
    const orderId = floor.tables.find((t) => t.label === 'T3')!.orderId!;
    const order = (await (await fetch(`${SERVER}/v1/orders/${orderId}`)).json()) as {
      items: Array<{ name: string; qty: number; status: string; addons: Array<{ name: string }> }>;
      kots: unknown[];
    };
    expect(order.items.map((i) => [i.name, i.qty, i.addons.map((a) => a.name).join('+'), i.status])).toEqual([
      ['Paneer Tikka', 1, 'Mild', 'fired'],
      ['Tandoori Chicken (Half)', 1, '', 'fired'],
      ['Butter Naan', 4, 'Extra cheese', 'fired'],
      ['Virgin Mojito', 2, 'Soda', 'fired'],
      ['Dal Makhani', 3, '', 'fired'],
    ]);
    expect(order.kots).toHaveLength(3); // Tandoor, Kitchen, Bar
    await other!.waitForSelector('[data-table="T3"][data-state="KOT_RUNNING"]', { timeout: 2_000 });
  });

  // P1-10: print the bill with a discount and settle in cash, keyboard only; the table frees up everywhere.
  it('keyboard only: F9 bill with 10% discount, F10 settle cash with change, table FREE', async () => {
    const [page, other] = app.windows();
    const k = page!.keyboard;
    await k.press('F9');
    await page!.getByRole('dialog', { name: 'Print bill' }).waitFor();
    await k.type('10'); // discount % field is focused
    await k.press('Tab');
    await k.type('Regular guest');
    await k.press('Enter');
    await page!.getByRole('dialog', { name: 'Print bill' }).waitFor({ state: 'detached' });
    await other!.waitForSelector('[data-table="T3"][data-state="BILL_PRINTED"]', { timeout: 2_000 });

    await k.press('F10');
    const settle = page!.getByRole('dialog', { name: /^Settle B\/\d{2}-\d{2}\/\d{6}$/ });
    await settle.waitFor();
    const due = await page!.getByTestId('settle-total').innerText();
    await k.type('3000');
    await k.press('Enter');
    await page!.getByRole('dialog', { name: 'Bill settled' }).waitFor();
    const change = await page!.getByTestId('change-due').innerText();
    await k.press('Enter'); // back to floor
    await page!.waitForSelector('[data-table="T3"][data-state="FREE"]', { timeout: 2_000 });
    await other!.waitForSelector('[data-table="T3"][data-state="FREE"]', { timeout: 2_000 });

    // Server agrees: one settled bill, numbered, discounted, paid in cash, change = 3000 − total.
    const rupees = (s: string) => Number(s.replace(/[^\d]/g, '')); // "₹1,234.50" → 123450 paise
    const floor = (await (await fetch(`${SERVER}/v1/floor`)).json()) as { tables: Array<{ label: string; orderId?: string }> };
    expect(floor.tables.find((t) => t.label === 'T3')!.orderId).toBeUndefined();
    expect(rupees(change)).toBe(300_000 - rupees(due));
  });

  it('day end is refused while tables are still open, naming them', async () => {
    const [page] = app.windows();
    await page!.getByRole('button', { name: 'Day end' }).click();
    const dlg = page!.getByRole('dialog', { name: 'Day end' });
    await dlg.waitFor();
    await expect.poll(() => dlg.getByRole('alert').innerText()).toMatch(/Settle every table before closing the day: T1, T2/);
    await page!.keyboard.press('Escape');
  });

  // ---- Setup screens (owner), each checked against the server ----

  const catalog = async () =>
    (await (await fetch(`${SERVER}/v1/admin/catalog`, { headers: { 'x-user-session': testToken } })).json()) as {
      tables: Array<{ label: string; layoutX: number | null; layoutY: number | null }>;
      items: Array<{ name: string; shortCode: string | null; basePricePaise: number }>;
    };

  async function openSettings(section: string) {
    const [page] = app.windows();
    if (await page!.getByRole('navigation', { name: 'Settings sections' }).isVisible().catch(() => false)) {
      await page!.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: new RegExp(section) }).click();
      return page!;
    }
    await page!.getByRole('button', { name: 'Settings' }).click();
    await page!.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: new RegExp(section) }).click();
    return page!;
  }

  it('Devices: a kitchen screen is approved from Settings with the manager PIN (asked on the Settings screen), then collects its pass', async () => {
    // the kitchen screen asks to pair (as apps/kds does)
    const ticket = (await (await fetch(`${SERVER}/v1/pairing-requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Tandoor screen', kind: 'kds' }) })).json()) as { requestId: string; code: string; secret: string };
    const page = await openSettings('Devices');
    const row = page.getByRole('listitem').filter({ hasText: ticket.code });
    await row.getByRole('button', { name: 'Approve' }).click();
    const pin = page.getByRole('dialog', { name: 'Manager approval' });
    await pin.waitFor({ timeout: 5_000 }); // before the fix, Settings never showed this and the approval hung
    await page.keyboard.type('1234');
    await page.keyboard.press('Enter');
    await page.getByText('Tandoor screen is paired.').waitFor();
    const collected = (await (await fetch(`${SERVER}/v1/pairing-requests/${ticket.requestId}/collect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: ticket.secret }) })).json()) as { status: string; deviceToken?: string };
    expect(collected.status).toBe('paired');
    expect(collected.deviceToken).toBeTruthy();
  });

  it('Outlet & bills: renaming the restaurant is saved', async () => {
    const page = await openSettings('Outlet & bills');
    const name = page.getByRole('textbox', { name: 'Restaurant name' });
    await name.fill('Spice Garden Kolkata (DEMO)');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('status').getByText('Saved').waitFor();
    const state = (await (await fetch(`${SERVER}/v1/setup-state`)).json()) as { outletName: string };
    expect(state.outletName).toBe('Spice Garden Kolkata (DEMO)');
  });

  it('Staff & roles: a new person is added and can sign in', async () => {
    const page = await openSettings('Staff & roles');
    await page.getByRole('button', { name: 'Add person' }).click();
    const dlg = page.getByRole('dialog', { name: 'Add a person' });
    await dlg.getByRole('textbox', { name: /Name/ }).fill('Priya');
    await dlg.getByLabel(/^PIN/).fill('6060');
    await dlg.getByLabel('Type it again').fill('6060');
    await dlg.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('list', { name: 'Staff list' }).getByText('Priya').waitFor();
    const state = (await (await fetch(`${SERVER}/v1/setup-state`)).json()) as { users: Array<{ id: string; name: string; roleName: string }> };
    const priya = state.users.find((u) => u.name === 'Priya')!;
    expect(priya.roleName).toBe('Cashier');
    const res = await fetch(`${SERVER}/v1/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: priya.id, pin: '6060' }) });
    expect(res.status).toBe(200);
  });

  it('Floor & tables: add a table, drag it on the layout, and save the position', async () => {
    const page = await openSettings('Floor & tables');
    await page.getByRole('button', { name: 'Add table' }).click();
    const dlg = page.getByRole('dialog', { name: 'Add a table' });
    await dlg.getByRole('textbox', { name: /Table name/ }).fill('T9');
    await dlg.getByRole('button', { name: 'Save' }).click();
    const tile = page.locator('[data-layout-table="T9"]');
    await tile.waitFor();
    const before = (await catalog()).tables.find((t) => t.label === 'T9')!;
    expect(before.layoutX).not.toBeNull();

    const box = (await tile.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 60, { steps: 8 });
    await page.mouse.up();
    await page.getByRole('button', { name: /Save layout \(1 moved\)/ }).click();
    await page.getByRole('button', { name: /^Save layout$/ }).waitFor();
    const after = (await catalog()).tables.find((t) => t.label === 'T9')!;
    expect(after.layoutX).not.toBe(before.layoutX);
    expect((after.layoutX ?? 0) % 20).toBe(0); // snapped to the grid
  });

  it('Menu: a new item can be sold by its short code at once', async () => {
    const page = await openSettings('Menu');
    await page.getByRole('button', { name: 'Add item' }).click();
    const dlg = page.getByRole('dialog', { name: 'Add an item' });
    await dlg.getByRole('textbox', { name: /^Name/ }).fill('Masala Papad');
    await dlg.getByRole('textbox', { name: /Short code/ }).fill('MP');
    await dlg.getByRole('textbox', { name: /Price/ }).fill('60');
    await dlg.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('table', { name: 'Items' }).getByText('Masala Papad').waitFor();
    expect((await catalog()).items.find((i) => i.shortCode === 'MP')).toMatchObject({ name: 'Masala Papad', basePricePaise: 6_000 });

    // Back on the floor: T9 (just added) → seat → MP sells.
    await page.getByRole('button', { name: 'Floor', exact: true }).click();
    await page.locator('[data-table="T9"]').click();
    await page.getByRole('dialog', { name: 'Seat table T9' }).waitFor();
    await page.keyboard.press('Enter');
    await page.getByLabel('Add item').waitFor();
    await page.keyboard.type('mp');
    await page.keyboard.press('Enter');
    await page.getByTestId('held-items').getByText('Masala Papad').waitFor();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });

  it('Kitchen & printers: a test print reaches the printer', async () => {
    const page = await openSettings('Kitchen & printers');
    const row = page.getByRole('list', { name: 'Printers' }).getByRole('listitem').filter({ hasText: 'Bill printer' });
    await row.getByRole('button', { name: 'Test print' }).click();
    await row.getByText('Test page sent').waitFor();
    await expect
      .poll(() => {
        const dir = path.join(dataDir, 'prints');
        const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.txt'));
        return files.some((f) => readFileSync(path.join(dir, f), 'utf8').includes('DinePOS test page'));
      }, { timeout: 5_000 })
      .toBe(true);
    await page.getByRole('button', { name: 'Floor', exact: true }).click();
  });

  // ---- Stock and menu upload (P2-10, P2-11) ----

  const get = async <T,>(url: string) => (await (await fetch(`${SERVER}${url}`, { headers: { 'x-user-session': testToken } })).json()) as T;
  const paneerOnHand = async () => (await get<{ items: Array<{ name: string; onHandMilli: number }> }>('/v1/stock')).items.find((i) => i.name === 'Paneer')!.onHandMilli;

  it('Stock: a purchase adds to stock, and firing Paneer Tikka uses its recipe (live on screen)', async () => {
    const [page] = app.windows();
    await page!.getByRole('button', { name: /^Stock/ }).click();
    const materials = page!.getByRole('table', { name: 'Materials' });
    const paneerRow = materials.getByRole('row').filter({ has: page!.getByText('Paneer', { exact: true }) });
    await paneerRow.waitFor();
    const start = await paneerOnHand();

    await page!.getByRole('tab', { name: /Purchases/ }).click();
    await page!.getByRole('button', { name: 'Record purchase' }).click();
    const dlg = page!.getByRole('dialog', { name: 'Record a purchase' });
    await dlg.getByRole('combobox', { name: 'Supplier' }).fill('Fresh Dairy');
    await dlg.getByLabel('Line 1 material').selectOption({ label: 'Paneer (kg)' });
    await dlg.getByLabel('Line 1 quantity').fill('2');
    await dlg.getByLabel('Line 1 rate').fill('350');
    await dlg.getByText('₹700.00').first().waitFor(); // amount from the shared calculator
    await dlg.getByRole('button', { name: 'Record purchase' }).click();
    await page!.getByRole('table', { name: 'Purchases' }).getByText('Fresh Dairy').waitFor();
    expect(await paneerOnHand()).toBe(start + 2000);

    // Fire Paneer Tikka (recipe: 0.2 kg paneer) on T6 from outside the app; the Materials tab updates live.
    await page!.getByRole('tab', { name: /Materials/ }).click();
    const menu = await get<{ items: Array<{ id: string; shortCode?: string }>; addonGroups: Array<{ name: string; addons: Array<{ id: string }> }> }>('/v1/menu');
    const pt = menu.items.find((i) => i.shortCode === 'PT')!;
    const spice = menu.addonGroups.find((g) => g.name.startsWith('Spice'))!.addons[0]!;
    const floor = await get<{ tables: Array<{ id: string; label: string }> }>('/v1/floor');
    const open = await fetch(`${SERVER}/v1/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-session': testToken },
      body: JSON.stringify({ commandId: ulid(), type: 'OpenTable', payload: { tableId: floor.tables.find((t) => t.label === 'T6')!.id, covers: 2 }, createdAt: new Date().toISOString() }),
    });
    const order = ((await open.json()) as { order: { id: string; version: number } }).order;
    const orderCommand = async (type: string, payload: unknown, expectedVersion: number) => {
      const res = await fetch(`${SERVER}/v1/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-user-session': testToken },
        body: JSON.stringify({ commandId: ulid(), type, payload, orderId: order.id, expectedVersion, createdAt: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error(`${type}: ${await res.text()}`);
    };
    await orderCommand('AddItems', { items: [{ id: ulid(), itemId: pt.id, qty: 1, addons: [{ addonId: spice.id, qty: 1 }] }] }, order.version);
    await orderCommand('FireKOT', { all: true }, order.version + 1);
    const expected = start + 2000 - 200;
    expect(await paneerOnHand()).toBe(expected);
    const kg = `${expected / 1000} kg`; // e.g. 9.8 kg
    await paneerRow.getByText(kg).waitFor({ timeout: 5_000 });

    // History names the KOT.
    await page!.getByRole('button', { name: 'History of Paneer' }).click();
    await page!.getByRole('dialog', { name: 'Paneer: history' }).getByText(/Used \(KOT\)/).first().waitFor();
    await page!.keyboard.press('Escape');
    await page!.getByRole('button', { name: 'Floor', exact: true }).click();
  });

  it('Recipes bulk upload, dish photos in bulk, and the billing screen in Photos view', async () => {
    const [page] = app.windows();
    // 1. Stock › Recipes › Bulk upload: a CSV checked against the menu and materials, then saved in one go
    await page!.getByRole('button', { name: /^Stock/ }).click();
    await page!.getByRole('tab', { name: /Recipes/ }).click();
    await page!.getByRole('button', { name: 'Bulk upload' }).click();
    const dlg = page!.getByRole('dialog', { name: 'Recipes: bulk upload' });
    await dlg.getByLabel('Choose a recipe file').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('dish,size,addon,material,quantity\r\nButter Naan,,,Saffron,0.01\r\n') });
    await dlg.getByRole('list', { name: 'Problems' }).getByText(/line 2:.*"Saffron" is not a material/).waitFor();
    await dlg.getByLabel('Choose a recipe file').setInputFiles({ name: 'recipes.csv', mimeType: 'text/csv', buffer: Buffer.from('dish,size,addon,material,quantity\r\nbutter naan,,,Paneer,0.05\r\n') });
    await dlg.getByRole('list', { name: 'Recipes to save' }).getByText('Butter Naan').waitFor();
    await dlg.getByRole('button', { name: 'Save 1 recipe' }).click();
    await dlg.getByRole('status').getByText(/1 recipe saved/).waitFor();
    const menu = await get<{ items: Array<{ id: string; name: string; image?: string }> }>('/v1/menu');
    const naan = menu.items.find((i) => i.name === 'Butter Naan')!;
    const recipes = await get<{ lines: Array<{ ownerId: string; qtyMilli: number }> }>('/v1/recipes');
    expect(recipes.lines.filter((l) => l.ownerId === naan.id).map((l) => l.qtyMilli)).toEqual([50]);
    await dlg.getByRole('button', { name: 'Done' }).click();
    await page!.getByRole('button', { name: 'Floor', exact: true }).click();

    // 2. Settings › Menu › Bulk photos: matched by file name, resized, uploaded
    const settings = await openSettings('Menu');
    await settings.getByRole('tab', { name: /Bulk photos/ }).click();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    await settings.getByLabel('Choose photos').setInputFiles([{ name: 'Butter_Naan.png', mimeType: 'image/png', buffer: png }]);
    await settings.getByText('matched by name').waitFor();
    await settings.getByRole('button', { name: 'Upload 1 photo' }).click();
    await settings.getByRole('status').getByText(/1 photo saved/).waitFor({ timeout: 15_000 });
    const image = (await get<{ items: Array<{ id: string; image?: string }> }>('/v1/menu')).items.find((i) => i.id === naan.id)!.image;
    expect(image).toMatch(/^[0-9a-f]{64}\.webp$/); // resized and re-encoded here before upload
    await settings.getByRole('button', { name: 'Floor', exact: true }).click();

    // 3. Billing: Photos view shows the photo (fetched with this terminal's token); List view is the compact tile
    await page!.locator('[data-table="T6"]').click();
    await page!.getByLabel('Add item').fill('Butter Naan');
    await page!.getByRole('radio', { name: 'Photos' }).click();
    const tile = page!.getByRole('button', { name: /Butter Naan/ });
    await tile.locator('img[src^="blob:"]').waitFor({ timeout: 10_000 });
    await page!.getByRole('radio', { name: 'List' }).click();
    await expect.poll(() => tile.locator('img').count()).toBe(0);
    await page!.getByLabel('Add item').fill('');
    await page!.getByRole('button', { name: 'Floor', exact: true }).click();
  });

  it('Kitchen status on the floor: a ticket bumped ready on a kitchen screen shows Ready on the table, live in both windows', async () => {
    const [page, other] = app.windows();
    const menu = await get<{ stations: Array<{ id: string; name: string }> }>('/v1/menu');
    const tandoor = menu.stations.find((x) => x.name === 'Tandoor')!.id; // T6's Paneer Tikka went there (Stock test)
    const board = await get<{ tickets: Array<{ id: string; tableLabel?: string }> }>(`/v1/kds/tickets?stationId=${tandoor}`);
    const kot = board.tickets.find((t) => t.tableLabel === 'T6')!;
    const bump = await fetch(`${SERVER}/v1/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-session': testToken },
      body: JSON.stringify({ commandId: ulid(), type: 'MarkKotReady', payload: { kotId: kot.id }, createdAt: new Date().toISOString() }),
    });
    expect(bump.ok).toBe(true);
    for (const p of [page!, other!]) await p.locator('[data-table="T6"]').getByTestId('kitchen-ready').getByText('Ready 1').waitFor({ timeout: 5_000 });
    expect(await page!.locator('[data-table="T6"]').getAttribute('aria-label')).toContain('1 ready to serve');
    await page!.locator('[data-table="T6"]').screenshot({ path: path.join(tmpdir(), 'dinepos-kitchen-tile.png') });
  });

  it('Billing: right-click marks an item sold out for everyone, and again puts it back', async () => {
    const [page] = app.windows();
    await page!.locator('[data-table="T6"]').click();
    await page!.getByLabel('Add item').waitFor();
    await page!.getByLabel('Add item').fill('Masala Papad');
    const tile = page!.getByRole('button', { name: /Masala Papad/ });
    await tile.click({ button: 'right' });
    await tile.getByText('Sold out').waitFor();
    const avail = async () => (await get<{ items: Array<{ shortCode?: string; available: boolean }> }>('/v1/menu')).items.find((i) => i.shortCode === 'MP')!.available;
    expect(await avail()).toBe(false);
    await tile.click({ button: 'right' });
    await tile.getByText('MP').waitFor();
    expect(await avail()).toBe(true);
    await page!.keyboard.press('Escape');
    await page!.keyboard.press('Escape');
  });

  it('After the KOT: cancel a sent item with a reason (cancel slip printed), then reprint the KOT', async () => {
    const [page] = app.windows();
    const prints = () => {
      const dir = path.join(dataDir, 'prints');
      return readdirSync(dir, { recursive: true })
        .map(String)
        .filter((f) => f.endsWith('.txt'))
        .map((f) => readFileSync(path.join(dir, f), 'utf8'));
    };
    await page!.locator('[data-table="T6"]').click();
    await page!.getByLabel('Add item').waitFor();
    await page!.getByRole('button', { name: 'Change sent Paneer Tikka' }).click();
    const dlg = page!.getByRole('dialog', { name: 'Change sent item: Paneer Tikka' });
    expect(await dlg.getByTestId('keep-qty').innerText()).toBe('0'); // one portion: cancel the line
    await dlg.getByRole('radio', { name: 'Guest changed mind' }).click();
    await dlg.getByRole('button', { name: 'Cancel item' }).click();
    await dlg.waitFor({ state: 'detached' });
    await page!.getByRole('listitem', { name: 'Paneer Tikka cancelled' }).waitFor();
    await expect.poll(() => prints().some((t) => t.includes('CANCELLED KOT') && t.includes('Reason: Guest changed mind')), { timeout: 5_000 }).toBe(true);

    const before = prints().filter((t) => t.includes('** DUPLICATE **')).length;
    await page!.getByRole('button', { name: /^Reprint KOT/ }).first().click();
    await expect.poll(() => prints().filter((t) => t.includes('** DUPLICATE **')).length, { timeout: 5_000 }).toBeGreaterThan(before);
    await page!.keyboard.press('Escape');
  });

  it('Tables: move T6 to T7, merge T9 into it, then move an item to T2 (both windows follow)', async () => {
    const [page, other] = app.windows();
    await page!.locator('[data-table="T6"]').click();
    await page!.getByLabel('Add item').waitFor();

    await page!.getByRole('button', { name: 'Move', exact: true }).click();
    await page!.getByRole('dialog', { name: 'Move to another table' }).getByRole('listitem', { name: 'Table T7' }).click();
    await page!.getByTestId('order-title').getByText('Table T7').waitFor();
    await other!.waitForSelector('[data-table="T6"][data-state="FREE"]', { timeout: 2_000 });

    await page!.getByRole('button', { name: 'Merge', exact: true }).click();
    await page!.getByRole('dialog', { name: 'Merge another table here' }).getByRole('listitem', { name: 'Table T9' }).click();
    await page!.getByTestId('held-items').getByText('Masala Papad').waitFor();
    await other!.waitForSelector('[data-table="T9"][data-state="FREE"]', { timeout: 2_000 });

    await page!.getByRole('button', { name: 'Move items' }).click();
    const dlg = page!.getByRole('dialog', { name: 'Move items to another table' });
    await dlg.getByRole('list', { name: 'Items to move' }).getByText('Masala Papad').click();
    await dlg.getByRole('listitem', { name: 'Table T2' }).click();
    await dlg.waitFor({ state: 'detached' });
    expect(await page!.getByTestId('held-items').getByText('Masala Papad').count()).toBe(0);

    const floor = await get<{ tables: Array<{ label: string; orderId?: string }> }>('/v1/floor');
    const t2 = await get<{ items: Array<{ name: string; status: string }> }>(`/v1/orders/${floor.tables.find((t) => t.label === 'T2')!.orderId!}`);
    expect(t2.items.some((i) => i.name === 'Masala Papad' && i.status === 'held')).toBe(true);
    await page!.keyboard.press('Escape');
  });

  it('Split bill: T2 split equally in two, each part paid on its own, then the table is free', async () => {
    const [page, other] = app.windows();
    const k = page!.keyboard;
    await page!.locator('[data-table="T2"]').click();
    await page!.getByLabel('Add item').waitFor();
    await k.press('F8'); // send the Masala Papad moved here earlier
    await expect.poll(() => page!.getByTestId('held-items').locator('li').count(), { timeout: 5_000 }).toBe(0);
    await k.press('F9');
    await page!.getByRole('dialog', { name: 'Print bill' }).waitFor();
    await k.press('Enter');
    await page!.getByRole('dialog', { name: 'Print bill' }).waitFor({ state: 'detached' });

    await page!.getByRole('button', { name: 'Split bill' }).click();
    const split = page!.getByRole('dialog', { name: 'Split bill' });
    expect(await split.getByTestId('split-parts').innerText()).toBe('2');
    await split.getByRole('button', { name: 'Split into 2 bills' }).click();
    await split.waitFor({ state: 'detached' });

    const floor = await get<{ tables: Array<{ label: string; orderId?: string }> }>('/v1/floor');
    const order = await get<{ bills: Array<{ state: string; totalPaise: number; billNoText: string }> }>(`/v1/orders/${floor.tables.find((t) => t.label === 'T2')!.orderId!}`);
    const parts = order.bills.filter((b) => b.state === 'printed');
    expect(parts).toHaveLength(2);
    for (const b of parts) expect(b.totalPaise % 100).toBe(0); // rounded to whole rupees

    for (const [i, part] of parts.entries()) {
      if (i === 0) await k.press('F10');
      else await page!.getByRole('button', { name: /Settle next part/ }).click();
      const settle = page!.getByRole('dialog', { name: new RegExp(`part ${i + 1} of 2`) });
      await settle.waitFor();
      await k.type(String(part.totalPaise / 100));
      await k.press('Enter');
      await page!.getByRole('dialog', { name: i === 0 ? 'Part settled' : 'Bill settled' }).waitFor();
    }
    await k.press('Enter'); // back to floor
    await other!.waitForSelector('[data-table="T2"][data-state="FREE"]', { timeout: 2_000 });
  });

  it("Bills and Cash: void a paid bill (keeps its number, VOID), then a pay-out prints a slip", async () => {
    const [page] = app.windows();
    await page!.getByRole('button', { name: 'Bills', exact: true }).click();
    const bills = page!.getByRole('dialog', { name: /^Bills of / });
    const row = bills.getByRole('row').filter({ hasText: 'T2' }).filter({ hasText: 'Paid' }).first();
    const billNo = await row.locator('td').first().innerText();
    await row.getByRole('button', { name: `Void ${billNo}` }).click();
    await bills.getByLabel('Reason for voiding').fill('Billed twice by mistake');
    await bills.getByRole('button', { name: 'Void bill' }).click();
    await bills.getByRole('status').getByText(`${billNo} is void.`).waitFor();
    await bills.getByRole('row').filter({ hasText: billNo }).getByText('VOID').waitFor(); // same number, now VOID
    await page!.keyboard.press('Escape');

    await page!.getByRole('button', { name: 'Cash', exact: true }).click();
    const cash = page!.getByRole('dialog', { name: 'Cash drawer' });
    await cash.getByRole('tab', { name: 'Pay out' }).click();
    await cash.getByLabel('Amount in rupees').fill('50');
    await cash.getByLabel('Reason').fill('Milk from the market');
    await cash.getByRole('button', { name: 'Pay out' }).click();
    await cash.getByRole('status').getByText(/Pay out of ₹50.00 recorded/).waitFor();
    await cash.getByRole('list', { name: 'Cash movements today' }).getByText(/Milk from the market/).waitFor();
    await expect
      .poll(() => {
        const dir = path.join(dataDir, 'prints');
        return readdirSync(dir, { recursive: true })
          .map(String)
          .filter((f) => f.endsWith('.txt'))
          .some((f) => readFileSync(path.join(dir, f), 'utf8').includes('CASH PAID OUT'));
      }, { timeout: 5_000 })
      .toBe(true);
    await page!.keyboard.press('Escape');
  });

  it('Menu › Bulk upload: a CSV is checked, then imported all at once', async () => {
    const page = await openSettings('Menu');
    await page.getByRole('tab', { name: 'Bulk upload' }).click();
    const csv = ['name,category,price,gst,code,veg', 'Galouti Kebab,Chef Specials,480,5,GK,non-veg', 'Kesar Phirni,Desserts,180,5,KPH,veg', 'Dal Makhani,Mains,280,5,,veg'].join('\r\n');
    await page.getByLabel('Menu CSV file').setInputFiles({ name: 'menu.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.getByRole('list', { name: 'Problems' }).getByText(/Row 4:.*already on the menu/).waitFor();
    expect(await page.getByRole('button', { name: /^Import/ }).isDisabled()).toBe(true);

    await page.getByLabel('Menu CSV file').setInputFiles({ name: 'menu.csv', mimeType: 'text/csv', buffer: Buffer.from(csv.split('\r\n').slice(0, 3).join('\r\n')) });
    await page.getByRole('button', { name: 'Import 2 items' }).click();
    await page.getByRole('status').getByText(/2 items added, 1 new category/).waitFor();
    expect((await catalog()).items.find((i) => i.shortCode === 'GK')).toMatchObject({ name: 'Galouti Kebab', basePricePaise: 48_000 });
    await page.getByRole('button', { name: 'Floor', exact: true }).click();
  });

  it('Bill design: the preview follows unsaved changes; saved settings print on a sample', async () => {
    const page = await openSettings('Bill design');
    const preview = page.getByTestId('bill-preview');
    await preview.getByText('Captain:').first().waitFor();
    await page.getByText('Captain', { exact: true }).click();
    await page.getByLabel('Lines under the name').fill('A unit of Spice Hospitality');
    await preview.getByText('A unit of Spice Hospitality').waitFor();
    expect(await preview.getByText('Captain:').count()).toBe(0);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('status').getByText(/Saved/).waitFor();
    const cfg = await get<{ 'bill.display': { showCaptain: boolean; headerLines: string[] } }>('/v1/config');
    expect(cfg['bill.display']).toMatchObject({ showCaptain: false, headerLines: ['A unit of Spice Hospitality'] });

    await page.getByRole('button', { name: 'Print sample' }).click();
    await page.getByText('Sample sent to the printer.').waitFor();
    await expect
      .poll(() => {
        const dir = path.join(dataDir, 'prints');
        const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.txt'));
        return files.some((f) => {
          const t = readFileSync(path.join(dir, f), 'utf8');
          return t.includes('SAMPLE - NOT A BILL') && t.includes('A unit of Spice Hospitality');
        });
      }, { timeout: 5_000 })
      .toBe(true);
    await page.getByRole('button', { name: 'Floor', exact: true }).click();
  });

  it('Two terminals on T4: items punched at the same moment all arrive; Move vs Print bill shows who moved the table', async () => {
    const [a, b] = app.windows();
    await a!.locator('[data-table="T4"]').click();
    await a!.getByRole('dialog', { name: 'Seat table T4' }).waitFor();
    await a!.keyboard.press('Enter');
    await a!.getByLabel('Add item').waitFor();
    await b!.locator('[data-table="T4"][data-state="SEATED"]').click({ timeout: 5_000 });
    await b!.getByLabel('Add item').waitFor();

    const punch = async (page: NonNullable<typeof a>, code: string, times: number) => {
      for (let i = 0; i < times; i++) {
        await page.getByLabel('Add item').fill(code);
        await page.getByLabel('Add item').press('Enter');
      }
    };
    await Promise.all([punch(a!, 'dm', 3), punch(b!, 'jr', 3)]); // both terminals at once
    const floor = await get<{ tables: Array<{ label: string; orderId?: string }> }>('/v1/floor');
    const orderUrl = `/v1/orders/${floor.tables.find((t) => t.label === 'T4')!.orderId!}`;
    await expect
      .poll(async () => (await get<{ items: Array<{ name: string; qty: number }> }>(orderUrl)).items.map((i) => `${i.name}×${i.qty}`).sort(), { timeout: 5_000 })
      .toEqual(['Dal Makhani×3', 'Jeera Rice×3']); // nothing lost, nothing doubled

    await a!.keyboard.press('F8');
    await expect.poll(() => a!.getByTestId('held-items').locator('li').count(), { timeout: 5_000 }).toBe(0);
    await a!.keyboard.press('F9'); // terminal A starts the bill…
    const bill = a!.getByRole('dialog', { name: 'Print bill' });
    await bill.waitFor();
    await b!.getByRole('button', { name: 'Move', exact: true }).click(); // …while terminal B moves the table
    await b!.getByRole('dialog', { name: 'Move to another table' }).getByRole('listitem', { name: 'Table T5' }).click();
    await b!.getByTestId('order-title').getByText('Table T5').waitFor();
    await bill.getByRole('button', { name: /Print/ }).last().click();
    const banner = a!.getByTestId('conflict-banner');
    await banner.waitFor({ timeout: 5_000 });
    expect(await banner.innerText()).toMatch(/The bill was not printed\.[\s\S]*Table T5 was changed by Asha \(Owner\) \(moved the table\)/);
    expect((await get<{ bills: unknown[] }>(orderUrl)).bills).toHaveLength(0);
    await a!.keyboard.press('Escape');
    await banner.getByRole('button', { name: 'OK, I have checked' }).click();
    await a!.getByTestId('order-title').getByText('Table T5').waitFor(); // A now shows the table where it is
    for (const p of [a!, b!]) {
      await p.keyboard.press('Escape');
      await p.keyboard.press('Escape');
    }
  });

  it('Reports: today’s daily sales and GST summary come from the server; VOID bills are counted apart', async () => {
    const [page] = app.windows();
    await page!.getByRole('button', { name: 'Floor', exact: true }).click().catch(() => undefined);
    await page!.getByRole('button', { name: 'Reports', exact: true }).click();
    const table = page!.getByTestId('report-table');
    await table.waitFor();
    const daily = await get<{ rows: Array<{ bills: number; voids: number; net: number }> }>('/v1/reports/daily');
    expect(daily.rows).toHaveLength(1);
    expect(daily.rows[0]!.voids).toBeGreaterThan(0); // the bill voided in the Bills test
    await page!.getByLabel('Headline figures').getByText('Net sales').waitFor();
    expect(await table.locator('tfoot').innerText()).toContain('Total');

    await page!.getByRole('navigation', { name: 'Reports' }).getByRole('button', { name: 'GST summary' }).click();
    await page!.getByRole('table', { name: 'GST summary' }).getByText('5%').waitFor();

    // P4-01: the leakage dashboard counts today's void; its card lists who, when and why.
    await page!.getByRole('navigation', { name: 'Reports' }).getByRole('button', { name: 'Leakage dashboard' }).click();
    const voids = page!.getByRole('listitem', { name: /^Void bills: [1-9]/ });
    await voids.waitFor();
    await voids.click();
    await page!.getByTestId('audit-table').getByText('Billed twice by mistake').waitFor();
    await page!.getByRole('navigation', { name: 'Reports' }).getByRole('button', { name: 'Audit log' }).click();
    await page!.getByTestId('audit-table').getByText('Bill voided').first().waitFor();
    await page!.getByRole('button', { name: 'Floor', exact: true }).click();
  });

  it('Backups: back up now, then restore that backup with the Owner PIN; the server restarts and the app comes back', async () => {
    const page = await openSettings('Backups');
    await page.getByRole('button', { name: 'Back up now' }).click();
    await page.getByText(/Backup made and checked/).waitFor();
    const before = await get<{ tables: Array<{ label: string; state: string }> }>('/v1/floor');

    await page.getByRole('table', { name: 'Backups' }).getByRole('button', { name: /^Restore the backup/ }).first().click();
    const dlg = page.getByRole('dialog', { name: 'Restore a backup' });
    await dlg.getByLabel('Type RESTORE to confirm').fill('restore');
    await dlg.getByLabel('Owner PIN').fill('1234');
    await dlg.getByRole('button', { name: 'Restore' }).click();
    await dlg.getByText(/Restoring… the server is restarting|Restored/).waitFor();
    await page.waitForEvent('load', { timeout: 30_000 }); // the app starts again on the restored data
    await page.locator('[data-table="T1"]').or(page.getByText('Who is signing in?')).first().waitFor({ timeout: 20_000 });

    const after = await get<{ tables: Array<{ label: string; state: string }> }>('/v1/floor');
    expect(after.tables.map((t) => [t.label, t.state])).toEqual(before.tables.map((t) => [t.label, t.state]));
    const list = await get<{ backups: Array<{ kind: string }> }>('/v1/admin/backups');
    expect(list.backups.some((b) => b.kind === 'restore')).toBe(true); // a safety backup was taken first
  });

  it('Captains (P3-04): a section set in Settings › Staff; Request bill from a phone shows on the counter and opens the order', async () => {
    const page = await openSettings('Captain sections');
    const row = page.locator('[data-section="Ravi (Captain)"]');
    await row.getByRole('button', { name: 'Set section' }).click();
    const dlg = page.getByRole('dialog', { name: 'Ravi (Captain): section' });
    await dlg.getByLabel('All of Terrace').check();
    await dlg.getByRole('button', { name: 'Save' }).click();
    await row.getByText('Terrace').waitFor();
    await page.getByRole('button', { name: 'Floor', exact: true }).click();

    // A terrace table opened at the counter goes to Ravi (his section); he fires from his phone and asks for the bill.
    const get = async <T,>(url: string) => (await (await fetch(`${SERVER}${url}`, { headers: { 'x-user-session': testToken } })).json()) as T;
    const users = (await get<{ users: Array<{ id: string; name: string }> }>('/v1/setup-state')).users;
    const ravi = users.find((u) => u.name.startsWith('Ravi'))!;
    const raviToken = ((await (await fetch(`${SERVER}/v1/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: ravi.id, pin: '3333' }) })).json()) as { token: string }).token;
    const send = async (token: string, type: string, payload: unknown, orderId?: string, expectedVersion?: number) =>
      (await (
        await fetch(`${SERVER}/v1/commands`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-user-session': token },
          body: JSON.stringify({ commandId: ulid(), type, payload, createdAt: new Date().toISOString(), ...(orderId ? { orderId, expectedVersion } : {}) }),
        })
      ).json()) as { ok: boolean; order?: { id: string; version: number } };
    const floor = await get<{ areas: Array<{ id: string; name: string }>; tables: Array<{ id: string; label: string; areaId: string; state: string }> }>('/v1/floor');
    const terrace = floor.areas.find((a) => a.name === 'Terrace')!;
    const table = floor.tables.find((t) => t.areaId === terrace.id && t.state === 'FREE')!;
    const dal = (await get<{ items: Array<{ id: string; shortCode?: string }> }>('/v1/menu')).items.find((i) => i.shortCode === 'DM')!;
    const opened = await send(testToken, 'OpenTable', { tableId: table.id, covers: 2 });
    const added = await send(raviToken, 'AddItems', { items: [{ id: ulid(), itemId: dal.id, qty: 1 }] }, opened.order!.id, opened.order!.version);
    const fired = await send(raviToken, 'FireKOT', { all: true }, opened.order!.id, added.order!.version);
    expect((await send(raviToken, 'RequestBill', {}, opened.order!.id, fired.order!.version)).ok).toBe(true);

    await page.getByRole('tab', { name: 'Terrace' }).click().catch(() => undefined);
    const tile = page.locator(`[data-table="${table.label}"]`);
    await tile.getByTestId('captain-initials').getByText('R').waitFor({ timeout: 5_000 });
    await tile.getByTestId('bill-asked').waitFor();
    const notice = page.locator(`[data-bill-request="${table.label}"]`);
    await notice.getByText(`Table ${table.label} asks for the bill`).waitFor();
    await notice.click();
    await page.getByTestId('order-title').getByText(`Table ${table.label}`).waitFor();
    await page.getByTestId('bill-asked').getByText('Bill asked by Ravi (Captain)').waitFor();
    expect(await page.getByRole('combobox', { name: 'Captain' }).inputValue()).toBe(ravi.id);
    expect(await notice.count()).toBe(0); // not shown over the order it is about

    // Printing the bill answers the request: gone from every screen.
    await send(testToken, 'PrintBill', {}, opened.order!.id, (await get<{ version: number }>(`/v1/orders/${opened.order!.id}`)).version);
    await page.getByTestId('bill-asked').waitFor({ state: 'detached', timeout: 5_000 });
    await page.getByRole('button', { name: 'Floor', exact: true }).click();
    await tile.getByTestId('bill-asked').waitFor({ state: 'detached' });
  });

  it('Bookings (P4-04): a booking holds its table; seating from the tile seats the booked guests; a waitlist guest gets a table', async () => {
    const [page] = app.windows();
    await page!.getByRole('button', { name: 'Floor', exact: true }).click().catch(() => undefined);
    const get = async <T,>(url: string) => (await (await fetch(`${SERVER}${url}`, { headers: { 'x-user-session': testToken } })).json()) as T;
    const free = (await get<{ tables: Array<{ label: string; state: string; areaId: string }>; areas: Array<{ id: string; name: string }> }>('/v1/floor')).tables.filter((t) => t.state === 'FREE');
    const [booked, forWaitlist] = [free[0]!, free[1]!];
    const soon = new Date(Date.now() + 20 * 60_000); // inside the 30-minute hold
    const hhmm = `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`;
    const ymd = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;

    await page!.getByRole('button', { name: /^Bookings/ }).click();
    await page!.getByRole('button', { name: 'New booking' }).click();
    const dlg = page!.getByRole('dialog', { name: 'New booking' });
    await dlg.getByLabel('Guest name').fill('Sharma');
    await dlg.getByLabel('Phone').fill('98300 12345');
    await dlg.getByLabel('Guests').fill('4');
    await dlg.getByLabel('Booking date').fill(ymd);
    await dlg.getByLabel('Booking time').fill(hhmm);
    await dlg.getByRole('checkbox', { name: booked.label, exact: true }).click();
    await dlg.getByRole('button', { name: 'Book' }).click();
    const row = page!.locator('[data-booking="Sharma"]');
    await row.getByText(booked.label, { exact: true }).waitFor({ timeout: 5_000 });

    // The waitlist: a walk-in party of 3, told 15 minutes.
    await page!.getByRole('button', { name: 'Add', exact: true }).click();
    const wdlg = page!.getByRole('dialog', { name: 'Add to the waitlist' });
    await wdlg.getByLabel('Waiting guest name').fill('Gupta');
    await wdlg.getByLabel('Waiting guests').fill('3');
    await wdlg.getByRole('button', { name: 'Add' }).click();
    const waiting = page!.locator('[data-waiting="Gupta"]');
    await waiting.waitFor({ timeout: 5_000 });

    // On the floor the booked table is held, with the booking on its tile.
    await page!.getByRole('button', { name: 'Floor', exact: true }).click();
    const tile = page!.locator(`[data-table="${booked.label}"]`);
    await page!.locator(`[data-table="${booked.label}"][data-state="RESERVED"]`).waitFor({ timeout: 5_000 });
    await tile.getByTestId('booking').getByText(`${hhmm} · Sharma (4)`).waitFor();
    expect(await page!.getByRole('button', { name: /^Bookings/ }).getAttribute('title')).toContain('waitlist: 1');

    // Seating the held table: these are Sharma's guests → the booking is seated, 4 covers.
    await tile.click();
    const seat = page!.getByRole('dialog', { name: `Seat table ${booked.label}` });
    await seat.getByTestId('held-for').getByText(`Held for Sharma (4) at ${hhmm}`).waitFor();
    await seat.getByRole('button', { name: 'Seat Sharma' }).click();
    await page!.getByTestId('order-title').getByText(`Table ${booked.label}`).waitFor({ timeout: 5_000 });
    const day = await get<{ reservations: Array<{ guestName: string; status: string; orderId?: string }> }>(`/v1/reservations?date=${ymd}`);
    expect(day.reservations.find((r) => r.guestName === 'Sharma')).toMatchObject({ status: 'seated' });

    // Gupta is seated from the waitlist at another free table.
    await page!.getByRole('button', { name: 'Floor', exact: true }).click();
    await page!.getByRole('button', { name: /^Bookings/ }).click();
    await waiting.getByRole('button', { name: 'Seat' }).click();
    await page!.getByRole('dialog', { name: 'Seat Gupta (3)' }).getByRole('listitem', { name: `Table ${forWaitlist.label}` }).click();
    await page!.getByTestId('order-title').getByText(`Table ${forWaitlist.label}`).waitFor({ timeout: 5_000 });
    expect((await get<{ entries: unknown[] }>('/v1/waitlist')).entries).toHaveLength(0);
    await page!.getByRole('button', { name: 'Floor', exact: true }).click();
  });

  it('Lock returns every window of the terminal to the sign-in screen', async () => {
    const [page, other] = app.windows();
    await page!.getByRole('button', { name: 'Lock' }).click();
    await page!.getByText('Who is signing in?').waitFor();
    await other!.getByText('Who is signing in?').waitFor({ timeout: 5_000 });
  });

  it('a stored session the server does not know (old run, other server) shows the sign-in screen', async () => {
    const [page] = app.windows();
    await page!.evaluate(() => {
      const fake = { token: 'not-a-real-token', user: { id: 'x', name: 'Ghost', roleId: 'x', roleName: 'Owner' }, rights: [], discountLimitBp: 0, expiresAt: '2099-01-01T00:00:00Z' };
      localStorage.setItem('dinepos.session', JSON.stringify(fake));
    });
    await page!.reload();
    await page!.getByText('Who is signing in?').waitFor({ timeout: 10_000 });
  });
});
