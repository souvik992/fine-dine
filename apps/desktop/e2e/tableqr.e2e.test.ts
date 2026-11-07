// P5-01 / P5-02 in the real apps: the signed Table QR package (built and signed exactly as shipped) is loaded by the
// outlet server; the terminal checks its signature itself and shows its screens (Settings › Table QR,
// alerts). A guest's phone opens the table's code, orders and calls a waiter; the cashier accepts on the terminal.
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, type ElectronApplication } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const repo = path.resolve(here, '..', '..');
const PORT = 7483;
const SERVER = `http://127.0.0.1:${PORT}`;
const built = path.join(repo, 'addons', 'dist', 'packages', 'tableqr');
let server: ChildProcess;
let dataDir: string;
let app: ElectronApplication;
let phone: ElectronApplication;
let token = '';

function cleanEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  return { ...env, ...extra };
}
const staffGet = async <T,>(url: string) => (await (await fetch(`${SERVER}${url}`, { headers: { 'x-user-session': token } })).json()) as T;
const staffPost = async <T,>(url: string, body: unknown) =>
  (await (await fetch(`${SERVER}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-session': token }, body: JSON.stringify(body) })).json()) as T;

describe('Table QR add-on', () => {
  beforeAll(async () => {
    // the package as shipped (needs the signing key on this PC; CI without it builds nothing and skips)
    execSync('npm run build -w @dinepos/addon-tableqr', { cwd: repo, stdio: 'ignore' });
    dataDir = mkdtempSync(path.join(tmpdir(), 'dinepos-qr-'));
    cpSync(built, path.join(dataDir, 'addons', 'tableqr'), { recursive: true });
    server = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], {
      cwd: repo,
      env: cleanEnv({ DATA_DIR: dataDir, DINEPOS_PORT: String(PORT), DINEPOS_HOST: '127.0.0.1', LOG_LEVEL: 'warn' }),
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
    execSync(`"${process.execPath}" --import tsx apps/server/src/seed/cli.ts`, { cwd: repo, env: cleanEnv({ DINEPOS_URL: SERVER }), stdio: 'ignore' });
    const users = ((await (await fetch(`${SERVER}/v1/setup-state`)).json()) as { users: Array<{ id: string; name: string }> }).users;
    const owner = users.find((u) => u.name.startsWith('Asha'))!;
    token = ((await (await fetch(`${SERVER}/v1/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: owner.id, pin: '1234' }) })).json()) as { token: string }).token;
    const electron = createRequire(import.meta.url)('electron') as unknown as string;
    app = await _electron.launch({ executablePath: electron, args: [here], cwd: here, env: cleanEnv({ DINEPOS_SERVER_URL: SERVER, DINEPOS_USER_DATA_DIR: path.join(dataDir, 'profile') }) });
  }, 240_000);

  afterAll(async () => {
    await phone?.close();
    await app?.close();
    server?.kill();
    await new Promise((r) => setTimeout(r, 500));
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('the server loaded the signed package; the terminal shows its floor button and Settings › Add-ons says it is on', async () => {
    expect(existsSync(path.join(dataDir, 'addons', 'tableqr', 'manifest.json'))).toBe(true);
    const list = await staffGet<{ addons: Array<{ id: string; status: string; error: string | null }> }>('/v1/addons');
    expect(list.addons).toEqual([expect.objectContaining({ id: 'tableqr', status: 'on', error: null })]);
    const page = await app.firstWindow();
    await page.getByRole('button', { name: /Asha \(Owner\)/ }).click({ timeout: 20_000 });
    await page.keyboard.type('1234');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-table="T1"]', { timeout: 10_000 });
    await expect.poll(() => page.locator('[data-addon-nav="tableqr"]').count()).toBe(0); // its screen is kept off the floor header
    await page.getByRole('button', { name: 'Settings' }).click();
    const nav = page.getByRole('navigation', { name: 'Settings sections' });
    await nav.getByRole('button', { name: /^Add-ons/ }).click();
    await page.locator('[data-addon="tableqr"]').getByText('On', { exact: true }).waitFor();
  });

  it('Settings › Table QR: switch on, make the codes; the codes show on screen', async () => {
    const page = await app.firstWindow();
    await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: /^Table QR/ }).click();
    await page.getByText('Take orders from table QR codes').click();
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByText('Saved.').waitFor();
    await page.getByRole('button', { name: 'Make missing codes' }).click();
    await page.locator('[data-qr-table="T2"] img').waitFor({ timeout: 10_000 });
    await page.screenshot({ path: path.join(tmpdir(), 'dinepos-tableqr-settings.png') });
    // this test's phone reaches the server on 127.0.0.1 (the real outlet uses the PC's Wi-Fi address)
    const s = await staffGet<{ settings: Record<string, unknown> }>('/v1/addons/tableqr/settings');
    expect(s.settings).toMatchObject({ enabled: true, acceptMode: 'staff' });
    await staffPost('/v1/addons/tableqr/settings', { ...s.settings, baseUrl: SERVER, welcome: 'Order here, pay at the counter' });
    await page.getByRole('button', { name: /Floor|Back/ }).first().click();
  });

  it('a guest orders from the table’s code; the terminal chimes, marks T2 and the cashier accepts: the KOT goes out', async () => {
    const s = await staffGet<{ tables: Array<{ label: string; url: string }> }>('/v1/addons/tableqr/settings');
    const url = s.tables.find((t) => t.label === 'T2')!.url;
    expect(url.startsWith(`${SERVER}/a/tableqr/?t=`)).toBe(true);
    const menu = await staffGet<{ items: Array<{ name: string; available: boolean; variants: unknown[]; addonGroupIds: unknown[] }> }>('/v1/menu');
    const dish = menu.items.find((i) => i.available && !i.variants.length && !i.addonGroupIds.length)!;

    const electron = createRequire(import.meta.url)('electron') as unknown as string;
    phone = await _electron.launch({ executablePath: electron, args: [path.join(here, 'e2e', 'phone-browser.cjs')], env: cleanEnv({ OPEN_URL: url, DINEPOS_USER_DATA_DIR: path.join(dataDir, 'phone') }) });
    const g = await phone.firstWindow();
    await g.getByText('Table T2').waitFor({ timeout: 20_000 });
    await g.getByText('Order here, pay at the counter').waitFor();
    await g.getByRole('button', { name: `Add ${dish.name}` }).click();
    await g.getByRole('button', { name: /1 item · .* · View order/ }).click();
    await g.screenshot({ path: path.join(tmpdir(), 'dinepos-tableqr-guest-cart.png') });
    await g.getByRole('button', { name: 'Place order' }).click();
    await g.getByText('Order sent. A member of staff will confirm it shortly.').waitFor();

    const page = await app.firstWindow();
    const alerts = page.locator('[data-qr-alerts]');
    await alerts.getByText('Table QR · 1 waiting').waitFor({ timeout: 15_000 });
    await page.locator('[data-table="T2"] [data-badge="tableqr:order"]').waitFor({ timeout: 15_000 });
    await page.screenshot({ path: path.join(tmpdir(), 'dinepos-tableqr-alert.png') });
    await alerts.getByRole('button', { name: 'Accept · send KOT' }).click();
    await alerts.waitFor({ state: 'detached', timeout: 10_000 });
    await expect.poll(async () => page.locator('[data-table="T2"]').getAttribute('data-state'), { timeout: 10_000 }).toBe('KOT_RUNNING');
    expect(await page.locator('[data-table="T2"] [data-badge="tableqr:order"]').count()).toBe(0);

    await g.getByRole('button', { name: /My table/ }).click();
    await g.getByText('Sent to the kitchen').waitFor({ timeout: 15_000 });
    await g.getByText(dish.name).first().waitFor();
    await g.screenshot({ path: path.join(tmpdir(), 'dinepos-tableqr-guest-bill.png') });
  });

  it('call waiter: the terminal shows it on the table until someone marks it done', async () => {
    const g = await phone.firstWindow();
    await g.getByRole('button', { name: /Call waiter/ }).click();
    await g.getByText('A waiter is on the way.').waitFor();
    const page = await app.firstWindow();
    await page.locator('[data-table="T2"] [data-badge="tableqr:waiter"]').waitFor({ timeout: 15_000 });
    await page.locator('[data-qr-alerts]').getByRole('button', { name: 'On my way · done' }).click();
    await expect.poll(() => page.locator('[data-table="T2"] [data-badge="tableqr:waiter"]').count(), { timeout: 10_000 }).toBe(0);
  });
});
