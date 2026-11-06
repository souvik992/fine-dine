// DinePOS load test: a dinner rush against a real outlet server (the server from source, its own fresh data folder,
// the demo menu and tables). Several terminals work at once, each through whole orders:
//   OpenTable -> AddItems -> FireKOT -> AddItems -> FireKOT -> PrintBill -> Settle   (7-8 commands an order)
// while a captain phone refreshes the floor every 500 ms. Prints the commands per second, latency percentiles, the
// server's memory and the database growth per order. Printers are the demo's preview printers (files on disk).
//
//   node scripts/load-test.mjs [--orders 1000] [--terminals 8]
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : def;
};
const ORDERS = arg('orders', 1000);
const TERMINALS = arg('terminals', 8);
const PORT = 7590;
const SERVER = `http://127.0.0.1:${PORT}`;

const C = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let last = 0;
const ulid = () => {
  let t = Math.max(Date.now(), last + 1);
  last = t;
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = C[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let r = '';
  for (let i = 0; i < 16; i++) r += C[Math.floor(Math.random() * 32)];
  return time + r;
};
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0;
};
const fmt = (ms) => `${ms.toFixed(1)} ms`;
/** The report (stdout). */
const say = (line) => process.stdout.write(`${line}
`);

function rssMb(pid) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).WorkingSet64`], { encoding: 'utf8' });
      return Number(out.trim()) / 1048576;
    }
    const s = execFileSync('cat', [`/proc/${pid}/status`], { encoding: 'utf8' });
    return Number(/VmRSS:\s+(\d+)/.exec(s)[1]) / 1024;
  } catch {
    return NaN;
  }
}
const dirSize = (d) => readdirSync(d).reduce((s, f) => s + (f.startsWith('dev.db') ? statSync(path.join(d, f)).size : 0), 0);

const dataDir = mkdtempSync(path.join(tmpdir(), 'dinepos-load-'));
const env = { ...process.env, DATA_DIR: dataDir, DINEPOS_PORT: String(PORT), DINEPOS_HOST: '127.0.0.1', LOG_LEVEL: 'error' };
delete env.ELECTRON_RUN_AS_NODE;
const server = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], { cwd: repo, env, stdio: 'ignore' });
const stop = () => {
  server.kill();
  setTimeout(() => rmSync(dataDir, { recursive: true, force: true }), 1500);
};

try {
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`${SERVER}/v1/health`)).ok) break;
    } catch {
      // starting
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  execFileSync(process.execPath, ['--import', 'tsx', 'apps/server/src/seed/cli.ts'], { cwd: repo, env: { ...env, DINEPOS_URL: SERVER }, stdio: 'ignore' });
  const users = (await (await fetch(`${SERVER}/v1/setup-state`)).json()).users;
  const manager = users.find((u) => u.name.startsWith('Vikram'));
  const session = (await (await fetch(`${SERVER}/v1/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: manager.id, pin: '2345' }) })).json()).token;
  const headers = { 'content-type': 'application/json', 'x-user-session': session };
  const floor0 = await (await fetch(`${SERVER}/v1/floor`, { headers })).json();
  const menu = await (await fetch(`${SERVER}/v1/menu`, { headers })).json();
  const required = new Set(menu.addonGroups.filter((g) => g.minSelect > 0).map((g) => g.id));
  const dishes = menu.items.filter((i) => i.available && !i.variants.length && !i.addonGroupIds.some((g) => required.has(g)));
  const tables = floor0.tables.filter((t) => t.state === 'FREE').map((t) => t.id);
  if (tables.length < TERMINALS) throw new Error(`only ${tables.length} free tables for ${TERMINALS} terminals`);
  const bytesBefore = dirSize(dataDir);

  const lat = {};
  let commands = 0;
  let errors = 0;
  const send = async (type, payload, order) => {
    const body = { commandId: ulid(), type, payload, createdAt: new Date().toISOString(), ...(order ? { orderId: order.id, expectedVersion: order.version } : {}) };
    const t0 = performance.now();
    const res = await fetch(`${SERVER}/v1/commands`, { method: 'POST', headers, body: JSON.stringify(body) });
    const json = await res.json();
    (lat[type] ??= []).push(performance.now() - t0);
    commands++;
    if (!res.ok) {
      errors++;
      throw new Error(`${type}: ${json.error?.message ?? res.status}`);
    }
    return json;
  };
  const items = (n) => Array.from({ length: n }, () => {
    const d = dishes[Math.floor(Math.random() * dishes.length)];
    return { id: ulid(), itemId: d.id, qty: 1 + Math.floor(Math.random() * 2) };
  });

  let done = 0;
  let floorReads = 0;
  const floorLat = [];
  let running = true;
  const captain = (async () => {
    while (running) {
      const t0 = performance.now();
      await fetch(`${SERVER}/v1/floor`, { headers }).then((r) => r.json());
      floorLat.push(performance.now() - t0);
      floorReads++;
      await new Promise((r) => setTimeout(r, 500));
    }
  })();

  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: TERMINALS }, async (_, w) => {
      const tableId = tables[w];
      while (done < ORDERS) {
        done++;
        let r = await send('OpenTable', { tableId, covers: 2 });
        let order = r.order;
        r = await send('AddItems', { items: items(3) }, order);
        order = r.order;
        r = await send('FireKOT', { all: true }, order);
        order = r.order;
        r = await send('AddItems', { items: items(2) }, order);
        order = r.order;
        r = await send('FireKOT', { all: true }, order);
        order = r.order;
        r = await send('PrintBill', {}, order);
        order = r.order;
        await send('Settle', { billId: r.result.billId, tenders: [{ mode: 'cash', amountPaise: r.result.totalPaise }] }, order);
      }
    }),
  );
  const secs = (performance.now() - t0) / 1000;
  running = false;
  await captain;
  await new Promise((r) => setTimeout(r, 1500)); // the print queue finishes
  const all = Object.values(lat).flat();
  const growth = dirSize(dataDir) - bytesBefore;

  say(`\nDinePOS load test: ${done} orders, ${TERMINALS} terminals at once, ${commands} commands (${errors} errors)`);
  say(`  time ${secs.toFixed(1)} s  ->  ${(commands / secs).toFixed(0)} commands/s, ${((done / secs) * 3600).toFixed(0)} orders/hour`);
  say(`  every command: p50 ${fmt(pct(all, 50))}, p95 ${fmt(pct(all, 95))}, p99 ${fmt(pct(all, 99))}, max ${fmt(Math.max(...all))}`);
  for (const [type, xs] of Object.entries(lat)) say(`    ${type.padEnd(10)} p50 ${fmt(pct(xs, 50))}  p95 ${fmt(pct(xs, 95))}  p99 ${fmt(pct(xs, 99))}`);
  say(`  captain floor refresh (${floorReads} during the rush): p50 ${fmt(pct(floorLat, 50))}, p95 ${fmt(pct(floorLat, 95))}`);
  say(`  server memory ${rssMb(server.pid).toFixed(0)} MB; database grew ${(growth / 1048576).toFixed(1)} MB (${(growth / done / 1024).toFixed(1)} KB an order)`);
  // where the space goes (pages per table), and what day end trims later
  const db = new Database(path.join(dataDir, 'dev.db'), { readonly: true });
  const rows = db.prepare("SELECT name, sum(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY bytes DESC LIMIT 8").all();
  db.close();
  const trimmed = { processed_command: 'kept 7 days', event_log: 'last 10,000 kept', print_job: 'ticket bytes dropped after 30 days' };
  say('  largest tables:');
  for (const r of rows) say(`    ${r.name.padEnd(28)} ${(r.bytes / 1048576).toFixed(1).padStart(6)} MB  ${(r.bytes / done / 1024).toFixed(1).padStart(5)} KB an order  ${trimmed[r.name] ?? ''}`);
} catch (e) {
  console.error('load test failed:', e.message);
  process.exitCode = 1;
} finally {
  stop();
}
