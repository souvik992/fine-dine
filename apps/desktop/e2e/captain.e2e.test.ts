// P3-01 acceptance in a real browser: a phone opens /captain on the outlet server, pairs (a manager approves the
// code), signs in with a PIN, sees the tables live and seats one. P3-02: takes an order by course. P3-03: keeps taking
// orders while the server is down and replays them when it is back.
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
async function send(type: string, payload: unknown, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}, base = SERVER) {
  const res = await fetch(`${base}/v1/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Device ${approver}`, 'x-user-session': manager, ...headers },
    body: JSON.stringify({ commandId: ulid(), type, payload, createdAt: new Date().toISOString(), ...extra }),
  });
  return (await res.json()) as { ok: boolean; error?: unknown; order?: { id: string; version: number } };
}

/** The outlet server on this data folder (another port = the same outlet reached by another terminal). */
async function startServer(port = PORT): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], {
    cwd: repo,
    env: cleanEnv({ DATA_DIR: dataDir, DINEPOS_PORT: String(port), DINEPOS_HOST: '127.0.0.1', LOG_LEVEL: 'warn', DINEPOS_TRUST_LOOPBACK: '0' }),
    stdio: 'ignore',
  });
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/v1/health`)).ok) return child;
    } catch {
      // starting
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server on ${port} did not start`);
}
async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise((r) => child.once('exit', r));
  child.kill();
  await exited;
}

describe('captain app on a phone', () => {
  beforeAll(async () => {
    execSync('npm run build -w @dinepos/captain', { cwd: repo, stdio: 'ignore' });
    dataDir = mkdtempSync(path.join(tmpdir(), 'dinepos-captain-'));
    server = await startServer();
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
    if (server) await stopServer(server);
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
    await page.getByRole('heading', { name: 'Table T3' }).waitFor({ timeout: 5_000 }); // straight into the order
    await page.getByRole('button', { name: 'Back to tables' }).click();
    await page.locator('[data-table="T3"][data-state="SEATED"]').waitFor({ timeout: 5_000 });

    const t3 = (await get<{ tables: Array<{ label: string; orderId?: string; orderVersion?: number; covers?: number }> }>('/v1/floor')).tables.find((t) => t.label === 'T3')!;
    expect(t3.covers).toBe(4);
    const dal = (await get<{ items: Array<{ id: string; shortCode?: string }> }>('/v1/menu')).items.find((i) => i.shortCode === 'DM')!;
    const added = await send('AddItems', { items: [{ id: ulid(), itemId: dal.id, qty: 2 }] }, { orderId: t3.orderId, expectedVersion: t3.orderVersion });
    await send('FireKOT', { all: true }, { orderId: t3.orderId, expectedVersion: added.order!.version });
    await page.locator('[data-table="T3"][data-state="KOT_RUNNING"]').waitFor({ timeout: 3_000 }); // live, no refresh
    await page.locator('[data-table="T3"]').click();
    await page.getByRole('heading', { name: 'Table T3' }).waitFor();
    await page.getByRole('button', { name: 'Basket', exact: true }).click();
    await page.getByRole('dialog', { name: 'Table T3 order' }).getByText('2 × Dal Makhani').waitFor();
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Back to tables' }).click();
  });

  // P3-02: order taking and course-wise firing on the phone.
  it('takes an order by course on the phone: options, merge, Fire course 1, guests, then Fire all', async () => {
    const page = await phone.firstWindow();
    await page.locator('[data-table="T5"]').click();
    await page.getByRole('dialog', { name: 'Seat T5' }).getByRole('button', { name: 'Seat 2 guests' }).click();
    await page.getByRole('heading', { name: 'Table T5' }).waitFor({ timeout: 5_000 });

    // Course 1: a plain dish twice (one line of 2), and a dish whose spice level must be chosen.
    await page.getByRole('button', { name: 'Add Hara Bhara Kebab' }).click();
    await page.getByRole('button', { name: 'Add Hara Bhara Kebab' }).click();
    await page.getByRole('button', { name: 'Basket', exact: true }).getByText('2 to send').waitFor({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Add Paneer Tikka' }).click();
    const options = page.getByRole('dialog', { name: 'Paneer Tikka' });
    expect(await options.getByRole('button', { name: 'Add 1 to course 1' }).isDisabled()).toBe(true);
    await options.getByRole('radio', { name: 'Medium' }).click();
    await options.getByRole('button', { name: 'Add 1 to course 1' }).click();
    await page.getByRole('button', { name: 'Basket', exact: true }).getByText('3 to send').waitFor({ timeout: 5_000 });

    // Course 2: mains.
    await page.getByRole('radiogroup', { name: 'Add to course' }).getByRole('radio', { name: '2' }).click();
    await page.getByRole('tab', { name: 'Main Course' }).click();
    await page.getByRole('button', { name: 'Add Chana Masala' }).click();
    await page.getByRole('button', { name: 'Basket', exact: true }).getByText('4 to send').waitFor({ timeout: 5_000 });

    await page.getByRole('button', { name: 'Basket', exact: true }).click();
    const basket = page.getByRole('dialog', { name: 'Table T5 order' });
    await basket.getByRole('region', { name: 'Course 2' }).getByText('Chana Masala').waitFor();
    await basket.getByRole('button', { name: 'Fire course 1 (3)' }).click();
    await page.getByText(/KOT \d{4}.* sent to the kitchen/).waitFor({ timeout: 5_000 });

    const t5 = (await get<{ tables: Array<{ label: string; orderId?: string; state: string }> }>('/v1/floor')).tables.find((t) => t.label === 'T5')!;
    expect(t5.state).toBe('KOT_RUNNING');
    type Line = { name: string; qty: number; course: number; status: string; addons: Array<{ name: string }> };
    const lines = async () => (await get<{ items: Line[]; covers: number }>(`/v1/orders/${t5.orderId}`));
    let order = await lines();
    expect(order.items.map((i) => [i.name, i.qty, i.course, i.status])).toEqual(
      expect.arrayContaining([
        ['Hara Bhara Kebab', 2, 1, 'fired'],
        ['Paneer Tikka', 1, 1, 'fired'],
        ['Chana Masala', 1, 2, 'held'],
      ]),
    );
    expect(order.items.find((i) => i.name === 'Paneer Tikka')!.addons.map((a) => a.name)).toEqual(['Medium']);
    await basket.getByRole('button', { name: 'Fire all (1)' }).waitFor();
    await basket.getByRole('region', { name: 'Sent to the kitchen' }).getByText('2 × Hara Bhara Kebab').waitFor();
    await basket.getByRole('button', { name: 'Close' }).click();
    await basket.waitFor({ state: 'detached' });

    await page.getByRole('button', { name: 'Guests: 2' }).click();
    await page.getByRole('dialog', { name: 'Guests' }).getByRole('button', { name: 'One more guest' }).click();
    await page.getByRole('button', { name: 'Save 3 guests' }).click();
    await page.getByRole('button', { name: 'Guests: 3' }).waitFor({ timeout: 5_000 });

    await page.getByRole('button', { name: 'Fire all' }).click();
    await page.getByRole('button', { name: 'Basket', exact: true }).getByText('Order').waitFor({ timeout: 5_000 });
    order = await lines();
    expect(order.covers).toBe(3);
    expect(order.items.every((i) => i.status === 'fired')).toBe(true);
  });

  // P3-03: the outlet server goes down mid-service. The phone keeps the orders, replays them in order when the server
  // is back, and a table taken meanwhile at a terminal lands in Needs attention, where the captain seats them elsewhere.
  it('offline: orders wait on the phone, replay in order when the server is back; a refused one goes to Needs attention', async () => {
    const page = await phone.firstWindow();
    await page.getByRole('button', { name: 'Back to tables' }).click();
    await stopServer(server);
    await page.getByText('Offline: orders are kept on this phone and sent when the connection is back.').waitFor({ timeout: 30_000 });

    // T6: seated, two Jeera Rice (one line of 2), all sent to the kitchen — all on the phone only.
    await page.locator('[data-table="T6"]').click();
    await page.getByRole('dialog', { name: 'Seat T6' }).getByRole('button', { name: 'Seat 2 guests' }).click();
    await page.getByRole('heading', { name: 'Table T6' }).waitFor();
    await page.getByRole('tab', { name: 'Rice & Biryani' }).click();
    await page.getByRole('button', { name: 'Add Jeera Rice' }).click();
    await page.getByRole('button', { name: 'Add Jeera Rice' }).click();
    await page.getByRole('button', { name: 'Basket', exact: true }).getByText('2 to send').waitFor({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Fire all' }).click();
    await page.getByText(/Queued: it goes to the kitchen/).waitFor();
    await page.getByTestId('order-waiting').getByText('4 changes waiting to send').waitFor();
    await page.getByRole('button', { name: 'Basket', exact: true }).click();
    await page.getByRole('region', { name: 'Queued for the kitchen' }).getByText('2 × Jeera Rice').waitFor();
    await page.getByRole('dialog', { name: 'Table T6 order' }).getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Back to tables' }).click();
    await page.locator('[data-table="T6"][data-state="SEATED"]').getByText('4 waiting').waitFor();

    // T7: seated with a Masala Chai — but a terminal will take T7 before the phone is back.
    await page.locator('[data-table="T7"]').click();
    await page.getByRole('dialog', { name: 'Seat T7' }).getByRole('button', { name: 'Seat 2 guests' }).click();
    await page.getByRole('tab', { name: 'Beverages' }).click();
    await page.getByRole('button', { name: 'Add Masala Chai' }).click();
    await page.getByTestId('order-waiting').getByText('2 changes waiting to send').waitFor();
    await page.getByRole('button', { name: 'Back to tables' }).click();
    await page.getByTestId('waiting-count').getByText('6 changes waiting to send').waitFor();

    // Meanwhile the counter seats T7 (the same outlet reached on another port), then the server restarts.
    const other = `http://127.0.0.1:${PORT + 1}`;
    const counter = await startServer(PORT + 1);
    const otherFloor = (await (await fetch(`${other}/v1/floor`, { headers: { authorization: `Device ${approver}` } })).json()) as { tables: Array<{ id: string; label: string }> };
    const t7 = otherFloor.tables.find((t) => t.label === 'T7')!;
    expect((await send('OpenTable', { tableId: t7.id, covers: 3 }, {}, {}, other)).ok).toBe(true);
    await stopServer(counter);
    server = await startServer();

    // Back: T6 replays in order (one KOT), T7 is refused and waits for the captain; its chai waits behind it.
    await page.getByRole('button', { name: '1 needs attention' }).waitFor({ timeout: 30_000 });
    await page.getByTestId('waiting-count').getByText('1 change waiting to send').waitFor();
    const floor = await get<{ tables: Array<{ label: string; orderId?: string; state: string; covers?: number }> }>('/v1/floor');
    const t6 = floor.tables.find((t) => t.label === 'T6')!;
    expect(t6.state).toBe('KOT_RUNNING');
    const t6order = await get<{ items: Array<{ name: string; qty: number; status: string }> }>(`/v1/orders/${t6.orderId}`);
    expect(t6order.items.map((i) => [i.name, i.qty, i.status])).toEqual([['Jeera Rice', 2, 'fired']]);
    expect(floor.tables.find((t) => t.label === 'T7')!.covers).toBe(3); // the counter's guests, untouched

    // Still there after the page is reloaded (kept in IndexedDB).
    await page.reload();
    await page.getByRole('button', { name: '1 needs attention' }).click();
    const item = page.locator('[data-attention="T7"]');
    await item.getByText('Table T7 is already occupied.').waitFor();
    await item.getByText('1 more change to this table waits for this one.').waitFor();
    await item.getByRole('button', { name: 'Seat at another table' }).click();
    await item.getByRole('button', { name: 'T8', exact: true }).click();
    await page.getByText('Nothing needs attention.').waitFor({ timeout: 10_000 });

    type Floor = { tables: Array<{ label: string; orderId?: string }> };
    await expect.poll(async () => (await get<Floor>('/v1/floor')).tables.find((t) => t.label === 'T8')?.orderId, { timeout: 10_000 }).toBeTruthy();
    const t8 = (await get<Floor>('/v1/floor')).tables.find((t) => t.label === 'T8')!;
    const t8order = await get<{ covers: number; items: Array<{ name: string; qty: number; status: string }> }>(`/v1/orders/${t8.orderId}`);
    expect(t8order.covers).toBe(2);
    expect(t8order.items.map((i) => [i.name, i.qty, i.status])).toEqual([['Masala Chai', 1, 'held']]);
  });

  // P3-04: a manager gives Ravi the Terrace; his phone shows "My tables" (his section and the tables he seated), and
  // he asks the counter for T3's bill.
  it('My tables lists my section and my orders; Request bill reaches the counter', async () => {
    const page = await phone.firstWindow();
    const floor = await get<{ areas: Array<{ id: string; name: string }>; tables: Array<{ label: string; orderId?: string; captainId?: string }> }>('/v1/floor');
    const users = (await get<{ users: Array<{ id: string; name: string }> }>('/v1/setup-state')).users;
    const ravi = users.find((u) => u.name.startsWith('Ravi'))!;
    expect(floor.tables.find((t) => t.label === 'T5')!.captainId).toBe(ravi.id); // seated from his phone
    expect((await send('SetCaptainSection', { userId: ravi.id, areaIds: [floor.areas.find((a) => a.name === 'Terrace')!.id] })).ok).toBe(true);

    await page.getByRole('dialog', { name: 'Needs attention' }).getByRole('button', { name: 'Close' }).click(); // left open by the offline test
    await page.getByRole('tab', { name: /^My tables/ }).click({ timeout: 5_000 }); // appears live
    const mine = await page.locator('[data-table]').evaluateAll((els) => els.map((e) => e.getAttribute('data-table')));
    expect(mine).toEqual(expect.arrayContaining(['R1', 'R2', 'R3', 'R4', 'T5', 'T6', 'T8']));

    await page.getByRole('tab', { name: 'Main Hall' }).click();
    await page.locator('[data-table="T3"]').click();
    await page.getByRole('button', { name: 'Request bill' }).click();
    await page.getByTestId('bill-requested').getByText(/Bill asked at .* by Ravi \(Captain\)/).waitFor({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Ask again' }).waitFor();
    const t3 = (await get<{ tables: Array<{ label: string; billRequest?: { byName?: string } }> }>('/v1/floor')).tables.find((t) => t.label === 'T3')!;
    expect(t3.billRequest?.byName).toBe('Ravi (Captain)');
    await page.getByRole('button', { name: 'Back to tables' }).click();
    await page.locator('[data-table="T3"]').getByTestId('bill-asked').waitFor();
  });
});
