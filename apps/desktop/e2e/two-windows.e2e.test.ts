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
    server = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], {
      cwd: repo,
      env: cleanEnv({ DATA_DIR: dataDir, DINEPOS_PORT: String(PORT), DINEPOS_HOST: '127.0.0.1', LOG_LEVEL: 'warn' }),
      stdio: 'ignore',
    });
    await waitForHealth();
    await run(process.execPath, ['--import', 'tsx', 'apps/server/src/seed/cli.ts'], { DINEPOS_URL: SERVER });

    const electron = createRequire(import.meta.url)('electron') as unknown as string;
    app = await _electron.launch({ executablePath: electron, args: [here], cwd: here, env: cleanEnv({ DINEPOS_SERVER_URL: SERVER }) });
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

  it('seats a free table from the UI and the other window follows', async () => {
    const [first, second] = app.windows();
    await first!.locator('[data-table="T2"]').click();
    await first!.getByRole('dialog', { name: 'Seat table T2' }).waitFor();
    await first!.getByRole('button', { name: 'One more guest' }).click();
    await first!.getByRole('button', { name: 'Seat guests' }).click();
    await second!.waitForSelector('[data-table="T2"][data-state="SEATED"]', { timeout: 2_000 });
    expect(await second!.locator('[data-table="T2"]').getAttribute('aria-label')).toContain('3 covers');
  });

  it('typing a table label and Enter opens it', async () => {
    const [first] = app.windows();
    await first!.locator('body').press('Escape');
    await first!.keyboard.type('t1');
    await first!.keyboard.press('Enter');
    await first!.getByRole('dialog', { name: 'Table T1' }).waitFor({ timeout: 2_000 });
  });
});
