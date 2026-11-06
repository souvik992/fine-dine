// The DinePOS Server window (`DinePOS.exe --server`): it runs the real outlet server, shows its state (business day,
// addresses and QR codes for phones and kitchen screens, devices, printers, backups, the log), and stops and starts it.
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, type ElectronApplication } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const repo = path.resolve(here, '..', '..');
const PORT = 7595;
let dataDir: string;
let app: ElectronApplication;

describe('DinePOS Server window', () => {
  beforeAll(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'dinepos-server-window-'));
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
    const electron = createRequire(import.meta.url)('electron') as unknown as string;
    app = await _electron.launch({
      executablePath: electron,
      args: [here, '--server'],
      cwd: here,
      env: {
        ...env,
        // the server from source (the installed app runs resources/server/node.exe server.mjs)
        DINEPOS_SERVER_NODE: process.execPath,
        DINEPOS_SERVER_ARGS: JSON.stringify(['--import', 'tsx', 'apps/server/src/index.ts']),
        DINEPOS_SERVER_CWD: repo,
        DATA_DIR: dataDir,
        DINEPOS_PORT: String(PORT),
        DINEPOS_HOST: '0.0.0.0',
        LOG_LEVEL: 'info',
        DINEPOS_USER_DATA_DIR: path.join(dataDir, 'profile'),
      },
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('starts the server and shows it: running, business day, addresses with QR codes, the log', async () => {
    const page = await app.firstWindow();
    await page.getByTestId('server-phase').getByText('Running').waitFor({ timeout: 60_000 });
    await expect.poll(async () => page.getByTestId('business-day').innerText(), { timeout: 20_000 }).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const first = await page.getByTestId('server-address').first().innerText();
    expect(first).toMatch(new RegExp(`^http://[\\d.]+:${PORT}$`));
    expect(await page.getByAltText(`QR code for ${first}/captain`).count()).toBe(1);
    expect(await page.getByAltText(`QR code for ${first}/kds`).count()).toBe(1);
    await expect.poll(async () => page.getByTestId('server-log').innerText(), { timeout: 20_000 }).toMatch(/\S/);
    expect((await fetch(`http://127.0.0.1:${PORT}/v1/health`)).ok).toBe(true);
    expect(await page.getByTestId('server-log').innerText()).not.toMatch(/incoming request|Ctrl\+C/);
    await page.screenshot({ path: path.join(tmpdir(), 'dinepos-server-window.png') });
  });

  it('Stop stops the server (after asking); Start brings it back', async () => {
    const page = await app.firstWindow();
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.getByTestId('server-phase').getByText('Stopped').waitFor({ timeout: 20_000 });
    await expect(fetch(`http://127.0.0.1:${PORT}/v1/health`)).rejects.toThrow();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await page.getByTestId('server-phase').getByText('Running').waitFor({ timeout: 60_000 });
    expect((await fetch(`http://127.0.0.1:${PORT}/v1/health`)).ok).toBe(true);
    // stop it again, so closing the test app leaves no server behind
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.getByTestId('server-phase').getByText('Stopped').waitFor({ timeout: 20_000 });
  }, 120_000);
});
