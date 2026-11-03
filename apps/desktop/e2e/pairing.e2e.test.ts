// P2-02 acceptance in the real app: a terminal on "another PC" (the server does not trust loopback here) must pair;
// a manager approves its code; revoking it sends it straight back to the pairing screen.
import { spawn, type ChildProcess } from 'node:child_process';
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
const PORT = 7468;
const SERVER = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;
let dataDir: string;
let app: ElectronApplication;
let approver = ''; // a paired device token (the manager's terminal)
let owner = ''; // the Owner signed in on it

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
const headers = (extra: Record<string, string> = {}) => ({ 'content-type': 'application/json', authorization: `Device ${approver}`, ...extra });
async function command(type: string, payload: unknown, extra: Record<string, string> = {}) {
  const res = await fetch(`${SERVER}/v1/commands`, { method: 'POST', headers: headers(extra), body: JSON.stringify({ commandId: ulid(), type, payload, createdAt: new Date().toISOString() }) });
  const body = (await res.json()) as { ok: boolean; error?: unknown };
  if (!body.ok) throw new Error(`${type}: ${JSON.stringify(body.error)}`);
}

describe('pairing a terminal', () => {
  beforeAll(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'dinepos-pair-'));
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
    // The first terminal is paired straight in the database (in a shop it is the master PC itself).
    approver = randomBytes(32).toString('base64url');
    const db = new Database(path.join(dataDir, 'dev.db'));
    db.pragma('busy_timeout = 5000');
    db.prepare("INSERT INTO device (id, name, kind, token_hash, paired_at) VALUES (?, 'Counter 1', 'terminal', ?, ?)").run(ulid(), createHash('sha256').update(`device:${approver}`).digest('hex'), new Date().toISOString());
    db.close();
    await command('SetupOutlet', { outletName: 'Pairing test', ownerId: ulid(), ownerName: 'Asha (Owner)', pin: '1234' });
    const state = (await (await fetch(`${SERVER}/v1/setup-state`, { headers: headers() })).json()) as { users: Array<{ id: string }> };
    owner = ((await (await fetch(`${SERVER}/v1/sessions`, { method: 'POST', headers: headers(), body: JSON.stringify({ userId: state.users[0]!.id, pin: '1234' }) })).json()) as { token: string }).token;

    const electron = createRequire(import.meta.url)('electron') as unknown as string;
    app = await _electron.launch({ executablePath: electron, args: [here], cwd: here, env: cleanEnv({ DINEPOS_SERVER_URL: SERVER, DINEPOS_USER_DATA_DIR: path.join(dataDir, 'profile') }) });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    server?.kill();
    await new Promise((r) => setTimeout(r, 500));
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('an unpaired terminal shows its code; once a manager approves it, the sign-in screen opens', async () => {
    const page = await app.firstWindow();
    await page.getByRole('heading', { name: 'Pair this terminal' }).waitFor({ timeout: 20_000 });
    await page.getByLabel('Terminal name').fill('Counter 2');
    await page.getByRole('button', { name: 'Get a pairing code' }).click();
    const code = (await page.getByTestId('pairing-code').innerText()).trim();
    expect(code).toMatch(/^\d{6}$/);

    await command('PairDevice', { code }, { 'x-user-session': owner, 'x-manager-pin': '1234' });
    await page.getByText('Who is signing in?').waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: /Asha \(Owner\)/ }).click();
    await page.keyboard.type('1234');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Settings' }).waitFor({ timeout: 10_000 });
  });

  it('revoking the terminal sends it back to the pairing screen at once', async () => {
    const page = await app.firstWindow();
    const list = (await (await fetch(`${SERVER}/v1/devices`, { headers: headers({ 'x-user-session': owner }) })).json()) as { devices: Array<{ id: string; name: string }> };
    const counter2 = list.devices.find((d) => d.name === 'Counter 2')!;
    await command('RevokeDevice', { deviceId: counter2.id }, { 'x-user-session': owner });
    await page.getByRole('heading', { name: 'Pair this terminal' }).waitFor({ timeout: 5_000 });
  });
});
