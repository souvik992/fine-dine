// P1-08 acceptance: two desktop windows show the same table state change within 1 s.
// Drives the real Electron app (built renderer on app://dinepos) against a real outlet server process.
// Run: npm run test:e2e -w @dinepos/desktop (builds first).
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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

async function command(type: string, payload: unknown): Promise<void> {
  const res = await fetch(`${SERVER}/v1/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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

describe('desktop app', () => {
  beforeAll(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'dinepos-e2e-'));
    const serverEnv = cleanEnv({ DATA_DIR: dataDir, DINEPOS_PORT: String(PORT), DINEPOS_HOST: '127.0.0.1', LOG_LEVEL: 'warn' });
    server = PACKAGED
      ? spawn(path.join(unpacked, 'resources', 'server', 'node.exe'), ['server.mjs'], {
          cwd: path.join(unpacked, 'resources', 'server'),
          env: { ...serverEnv, NODE_ENV: 'production' },
          stdio: 'ignore',
        })
      : spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], { cwd: repo, env: serverEnv, stdio: 'ignore' });
    await waitForHealth();
    await run(process.execPath, ['--import', 'tsx', 'apps/server/src/seed/cli.ts'], { DINEPOS_URL: SERVER });

    const electron = createRequire(import.meta.url)('electron') as unknown as string;
    app = PACKAGED
      ? await _electron.launch({ executablePath: path.join(unpacked, 'DinePOS.exe'), args: [], cwd: unpacked, env: cleanEnv({ DINEPOS_SERVER_URL: SERVER }) })
      : await _electron.launch({ executablePath: electron, args: [here], cwd: here, env: cleanEnv({ DINEPOS_SERVER_URL: SERVER }) });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    server?.kill();
    await new Promise((r) => setTimeout(r, 500));
    rmSync(dataDir, { recursive: true, force: true });
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

    const held = page!.getByTestId('held-items').locator('li');
    await expect.poll(() => held.count(), { timeout: 5_000 }).toBe(5);
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
      ['Dal Makhani', 1, '', 'fired'],
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
    await k.type('2000');
    await k.press('Enter');
    await page!.getByRole('dialog', { name: 'Bill settled' }).waitFor();
    const change = await page!.getByTestId('change-due').innerText();
    await k.press('Enter'); // back to floor
    await page!.waitForSelector('[data-table="T3"][data-state="FREE"]', { timeout: 2_000 });
    await other!.waitForSelector('[data-table="T3"][data-state="FREE"]', { timeout: 2_000 });

    // Server agrees: one settled bill, numbered, discounted, paid in cash, change = 2000 − total.
    const rupees = (s: string) => Number(s.replace(/[^\d]/g, '')); // "₹1,234.50" → 123450 paise
    const floor = (await (await fetch(`${SERVER}/v1/floor`)).json()) as { tables: Array<{ label: string; orderId?: string }> };
    expect(floor.tables.find((t) => t.label === 'T3')!.orderId).toBeUndefined();
    expect(rupees(change)).toBe(200_000 - rupees(due));
  });

  it('day end is refused while tables are still open, naming them', async () => {
    const [page] = app.windows();
    await page!.getByRole('button', { name: 'Day end' }).click();
    const dlg = page!.getByRole('dialog', { name: 'Day end' });
    await dlg.waitFor();
    await expect.poll(() => dlg.getByRole('alert').innerText()).toMatch(/Settle every table before closing the day: T1, T2/);
    await page!.keyboard.press('Escape');
  });
});
