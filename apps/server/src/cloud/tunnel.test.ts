import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { newId } from '@dinepos/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type DinePosApp } from '../app.js';
import { CloudTunnel } from './tunnel.js';
import { commandRegistry } from '../commands/registry.js';
import { ensureBusinessDay } from '../core/business-day.js';
import { EventBus, noopPrintWaker } from '../core/events.js';
import { executeCommand } from '../core/execute-command.js';
import { setConfigValue } from '../core/outlet-config.js';
import { allowAllRights } from '../core/rights.js';
import type { Db } from '../db/connection.js';
import { devSeedCommands, devSetupCommand } from '../seed/dev-seed.js';
import { createTestDb } from '../testing/test-db.js';

// P6-02 end to end: the real PosiNext Cloud (repository posinext-cloud next to this one, or POSINEXT_CLOUD_DIR) and a real DinePOS server with device pairing on, as installed.
// The outlet connects its tunnel out; a device at https://<store>.<cloud> is answered by the outlet, never as the
// trusted master PC: without its own device token it is refused, with it the floor and the live stream work.
const here = path.dirname(fileURLToPath(import.meta.url));
const cloudSrc = path.join(process.env.POSINEXT_CLOUD_DIR ?? path.resolve(here, '..', '..', '..', '..', '..', 'posinext-cloud'), 'hub', 'src');

interface CloudHub {
  close(): void;
}
let dir: string;
let db: Db;
let app: DinePosApp;
let cloud: http.Server;
let cloudHub: CloudHub;
let port = 0;
const bus = new EventBus();
const HOST = 'spice-garden.cloud.test';
const now = () => new Date();

function device(urlPath: string, o: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: o.method ?? 'GET', headers: { host: HOST, ...o.headers }, setHost: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(o.body);
  });
}

/** A device's live stream through the cloud (a raw client, to send the outlet's Host). */
function stream(origin: string) {
  return new Promise<{ send(t: string): void; next(): Promise<Record<string, unknown>> }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/v1/stream', setHost: false, headers: { host: HOST, origin, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': randomBytes(16).toString('base64') } });
    req.on('response', (r) => reject(new Error(`stream refused ${r.statusCode}`)));
    req.on('upgrade', (_res, socket: Duplex) => {
      const queue: string[] = [];
      const waiters: Array<(s: string) => void> = [];
      let buf = Buffer.alloc(0);
      socket.on('data', (d: Buffer) => {
        buf = Buffer.concat([buf, d]);
        while (buf.length >= 2) {
          let len = buf[1]! & 0x7f;
          let off = 2;
          if (len === 126) {
            if (buf.length < 4) return;
            len = buf.readUInt16BE(2);
            off = 4;
          }
          if (buf.length < off + len) return;
          const op = buf[0]! & 0x0f;
          const text = buf.subarray(off, off + len).toString();
          buf = buf.subarray(off + len);
          if (op !== 1) continue;
          const w = waiters.shift();
          if (w) w(text);
          else queue.push(text);
        }
      });
      resolve({
        send(t) {
          const p = Buffer.from(t);
          const mask = randomBytes(4);
          const head = p.length < 126 ? Buffer.from([0x81, 0x80 | p.length]) : Buffer.from([0x81, 0xfe, p.length >> 8, p.length & 255]);
          socket.write(Buffer.concat([head, mask, Buffer.from(p.map((b, i) => b ^ mask[i & 3]!))]));
        },
        next: async () => JSON.parse(queue.length ? queue.shift()! : await new Promise<string>((r) => waiters.push(r))) as Record<string, unknown>,
      });
    });
    req.end();
  });
}

describe.runIf(existsSync(path.join(cloudSrc, 'tunnel.ts')))('devices through PosiNext Cloud (P6-02)', () => {
  let deviceToken = '';

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'dinepos-cloud-tunnel-'));
    const { Hub } = (await import(pathToFileURL(path.join(cloudSrc, 'hub.ts')).href)) as { Hub: new (o: { dbPath: string }) => CloudHub };
    const { createHubServer } = (await import(pathToFileURL(path.join(cloudSrc, 'http.ts')).href)) as { createHubServer: (h: CloudHub, o: Record<string, unknown>) => http.Server };
    cloudHub = new Hub({ dbPath: path.join(dir, 'cloud.db') });
    cloud = createHubServer(cloudHub, { adminKey: 'admin-key', deviceDomain: 'cloud.test', publicUrl: 'https://cloud.test' });
    await new Promise<void>((r) => cloud.listen(0, '127.0.0.1', () => r()));
    port = (cloud.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;
    const store = (await (await fetch(`${base}/v1/admin/stores`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': 'admin-key' }, body: JSON.stringify({ slug: 'spice-garden', name: 'Spice Garden' }) })).json()) as { pairingCode: string };
    const key = ((await (await fetch(`${base}/v1/pos/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: store.pairingCode, deviceName: 'DinePOS' }) })).json()) as { deviceKey: string }).deviceKey;

    db = createTestDb();
    ensureBusinessDay(db, 'Asia/Kolkata', now);
    const deps = { db, registry: commandRegistry, rights: allowAllRights, bus: new EventBus(), printWaker: noopPrintWaker, timeZone: 'Asia/Kolkata', now };
    for (const c of [devSetupCommand(), ...devSeedCommands()]) executeCommand(deps, { commandId: newId(), type: c.type, payload: c.payload, createdAt: now().toISOString() }, { deviceId: null, userId: null });
    db.prepare('UPDATE online_link SET hub_url = ?, device_key = ?, store_slug = ? WHERE id = 1').run(base, key, 'spice-garden');
    setConfigValue(db, 'cloud.remoteDevices', true);
    // a captain phone paired with this outlet earlier (on the LAN)
    deviceToken = randomBytes(32).toString('base64url');
    db.prepare("INSERT INTO device (id, name, kind, token_hash, paired_at) VALUES (?, 'Captain phone', 'captain', ?, ?)").run(newId(), createHash('sha256').update(`device:${deviceToken}`).digest('hex'), now().toISOString());
    // pairing on and the master PC trusted on loopback, exactly as installed
    app = buildApp({ db, timeZone: 'Asia/Kolkata', now, trustLoopback: true, bus });
    app.cloud.start();
    for (let i = 0; i < 300 && app.cloud.status().connection !== 'connected'; i++) await new Promise((r) => setTimeout(r, 50));
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await new Promise<void>((r) => {
      cloud?.close(() => r());
      cloud?.closeAllConnections();
    });
    cloudHub?.close();
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('the outlet tells its device address; a device reaches the outlet through the cloud', async () => {
    await expect.poll(() => app.cloud.status().deviceUrl).toBe('https://spice-garden.cloud.test');
    const health = await device('/v1/health');
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toMatchObject({ ok: true });
  });

  it('through the cloud nobody is the master PC: no device token, no data; with the phone’s own token it works', async () => {
    const anonymous = await device('/v1/floor');
    expect(anonymous.status).toBe(401);
    const paired = await device('/v1/floor', { headers: { authorization: `Device ${deviceToken}` } });
    expect(paired.status).toBe(200);
    expect((JSON.parse(paired.body) as { tables: unknown[] }).tables.length).toBeGreaterThan(0);
    const me = await device('/v1/devices/me', { headers: { authorization: `Device ${deviceToken}` } });
    if (me.status === 200) expect(JSON.parse(me.body)).toMatchObject({ loopback: false, master: false });
  });

  it('the live stream works through the cloud for a paired device only, and carries events', { timeout: 20_000 }, async () => {
    const s = await stream(`https://${HOST}`);
    s.send(JSON.stringify({ type: 'hello', deviceToken, resumeFrom: null, topics: ['floor'] }));
    expect(await s.next()).toMatchObject({ type: 'ready' });
    // a table is seated on the LAN: the phone outside hears it at once
    const table = db.prepare("SELECT id FROM dining_table WHERE label = 'T3'").pluck().get() as string;
    executeCommand({ db, registry: commandRegistry, rights: allowAllRights, bus, printWaker: noopPrintWaker, timeZone: 'Asia/Kolkata', now }, { commandId: newId(), type: 'OpenTable', payload: { tableId: table, covers: 2 }, createdAt: now().toISOString() }, { deviceId: null, userId: null });
    let msg = await s.next();
    while (msg.topic !== 'floor') msg = await s.next();
    expect(msg).toMatchObject({ topic: 'floor' });
    const intruder = await stream(`https://${HOST}`);
    intruder.send(JSON.stringify({ type: 'hello', deviceToken: null, resumeFrom: null, topics: ['floor'] }));
    const refused = await intruder.next();
    expect(refused.type).toBe('error');
    expect(String(refused.message)).toMatch(/not paired/);
  });

  it('switched off: the tunnel closes and devices are told the outlet is not connected', async () => {
    setConfigValue(db, 'cloud.remoteDevices', false);
    app.cloud.refresh();
    await expect.poll(() => app.cloud.status().connection, { timeout: 10_000 }).toBe('off');
    await expect.poll(async () => (await device('/v1/health')).status, { timeout: 10_000 }).toBe(503);
  });
});

describe('a hub without the device relay (the Tiffin order hub)', () => {
  it('is named as not DinePOS Cloud instead of "could not reach"', { timeout: 20_000 }, async () => {
    // answers everything (sync works) but has no /v1/pos/tunnel or /v1/pos/tunnel-info
    const plain = http.createServer((_req, res) => {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"error":{"code":"NOT_FOUND"}}');
    });
    await new Promise<void>((r) => plain.listen(0, '127.0.0.1', () => r()));
    const tdb = createTestDb();
    try {
      tdb.prepare('UPDATE online_link SET hub_url = ?, device_key = ?, store_slug = ? WHERE id = 1').run(`http://127.0.0.1:${(plain.address() as { port: number }).port}`, 'key', 'dum-durrust');
      setConfigValue(tdb, 'cloud.remoteDevices', true);
      const t = new CloudTunnel({ db: tdb, bus: new EventBus(), inject: () => Promise.reject(new Error('unused')), attachStream: () => undefined, retryMs: [60_000] });
      t.start();
      await expect.poll(() => t.status().lastError, { timeout: 10_000 }).toMatch(/not DinePOS Cloud/);
      await t.stop();
    } finally {
      tdb.close();
      await new Promise<void>((r) => {
        plain.close(() => r());
        plain.closeAllConnections();
      });
    }
  });
});
