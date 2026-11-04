import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DEFAULT_ONLINE_SETTINGS, newId, type HubOrder } from '@dinepos/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type DinePosApp } from '../app.js';
import { ensureBusinessDay } from '../core/business-day.js';
import { getConfig } from '../core/outlet-config.js';
import type { Db } from '../db/connection.js';
import { DEV_OWNER, devSeedCommands, devSetupCommand, seedId } from '../seed/dev-seed.js';
import { createTestDb } from '../testing/test-db.js';
import { parseConnectLink } from '../routes/online.js';
import { EventBus } from '../core/events.js';
import { OnlineConnector } from './connector.js';
import { priceOnlineOrder } from './menu.js';

// P4-06: the connector against a small fake hub that speaks contract v1 (pair, menu, status, SSE events, actions).
class FakeHub {
  server!: Server;
  url = '';
  menus: Array<{ version: number; items: Array<{ id: string }> }> = [];
  statuses: Array<{ accepting: boolean }> = [];
  actions: Array<{ orderId: string; action: string; key: string; body: unknown }> = [];
  refuse = new Set<string>(); // "orderId/action" answered 409
  photos = new Map<string, Buffer>();
  private streams: ServerResponse[] = [];
  lastEventIds: string[] = [];
  private seq = 0;

  async start() {
    this.server = createServer((req, res) => void this.route(req, res));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }
  async stop() {
    for (const s of this.streams) s.end();
    await new Promise((r) => this.server.close(r));
  }
  private async body(req: IncomingMessage): Promise<unknown> {
    let s = '';
    for await (const c of req) s += String(c);
    return s ? JSON.parse(s) : null;
  }
  private json(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  }
  private async route(req: IncomingMessage, res: ServerResponse) {
    const url = req.url ?? '';
    if (url === '/v1/pos/pair') {
      const b = (await this.body(req)) as { code: string };
      return b.code === 'ABCD-EFGH' ? this.json(res, 200, { deviceKey: 'dk_secret_123456', slug: 'spice', name: 'Spice Garden' }) : this.json(res, 400, { error: { message: 'That code is not valid.' } });
    }
    if (req.headers.authorization !== 'Bearer dk_secret_123456') return this.json(res, 401, { error: { message: 'unknown device' } });
    if (url === '/v1/pos/menu') return this.json(res, 200, { version: this.menus.push((await this.body(req)) as never) });
    if (url === '/v1/pos/status') return this.json(res, 200, { ok: this.statuses.push((await this.body(req)) as never) });
    if (url === '/v1/pos/images') return this.json(res, 200, { names: [...this.photos.keys()] });
    const photo = /^\/v1\/pos\/images\/([^/]+)$/.exec(url);
    if (photo && req.method === 'PUT') {
      this.photos.set(decodeURIComponent(photo[1]!), Buffer.from(((await this.body(req)) as { dataBase64: string }).dataBase64, 'base64'));
      return this.json(res, 200, { ok: true });
    }
    if (url === '/v1/pos/events') {
      this.lastEventIds.push(String(req.headers['last-event-id'] ?? ''));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(': ping\n\n');
      this.streams.push(res);
      return;
    }
    const m = /^\/v1\/pos\/orders\/([^/]+)\/(\w+)$/.exec(url);
    if (m) {
      const body = await this.body(req);
      this.actions.push({ orderId: decodeURIComponent(m[1]!), action: m[2]!, key: String(req.headers['idempotency-key']), body });
      if (this.refuse.has(`${m[1]}/${m[2]}`)) return this.json(res, 409, { error: { code: 'BAD_TRANSITION', message: 'The order is already cancelled.', details: { state: 'CANCELLED' } } });
      return this.json(res, 200, { orderId: m[1], state: 'OK' });
    }
    this.json(res, 404, { error: { message: 'not found' } });
  }
  /** Pushes an event down every open stream. */
  push(event: Record<string, unknown>) {
    const seq = ++this.seq;
    for (const s of this.streams) s.write(`id: ${seq}\nevent: ${String(event.type)}\ndata: ${JSON.stringify({ seq, at: Date.now(), ...event })}\n\n`);
  }
  dropStreams() {
    for (const s of this.streams) s.destroy();
    this.streams = [];
  }
}

const until = async (check: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
};

let db: Db;
let app: DinePosApp;
let hub: FakeHub;
let owner = '';

beforeEach(async () => {
  hub = new FakeHub();
  await hub.start();
  db = createTestDb();
  ensureBusinessDay(db, 'Asia/Kolkata');
  app = buildApp({ db, timeZone: 'Asia/Kolkata', trustLoopback: true });
  const send = async (type: string, payload: unknown, token?: string) =>
    (await app.inject({ method: 'POST', url: '/v1/commands', headers: token ? { 'x-user-session': token } : {}, payload: { commandId: newId(), type, payload, createdAt: new Date().toISOString() } })).json<{ ok: boolean; error?: unknown }>();
  await send(devSetupCommand().type, devSetupCommand().payload);
  owner = (await app.inject({ method: 'POST', url: '/v1/sessions', payload: { userId: DEV_OWNER.id, pin: DEV_OWNER.pin } })).json<{ token: string }>().token;
  for (const c of devSeedCommands()) await send(c.type, c.payload, owner);
  await send('SetConfig', { values: { 'online.settings': { ...DEFAULT_ONLINE_SETTINGS, enabled: true, acceptMode: 'auto' } } }, owner);
  app.online.start();
});
afterEach(async () => {
  await app.close();
  db.close();
  await hub.stop();
});

function order(over: Partial<HubOrder> = {}): HubOrder {
  const o: HubOrder = {
    id: `ord_${newId()}`, number: 'W-7', storeId: 'st', channel: 'website', state: 'SENT_TO_STORE', fulfilment: 'PICKUP', payment: 'ONLINE', paid: true,
    customer: { name: 'Asha', mobile: '9830000000', verified: true }, address: null,
    lines: [{ itemId: seedId('item:DM'), name: 'Dal Makhani', qtyMilli: 1000, unitPrice: 28_000, modifiers: [], note: null, lineTotal: 29_400 }],
    note: null, itemsTotal: 29_400, deliveryFee: 0, packagingFee: 0, total: 0, distanceKm: null, location: null, prepMinutes: null, etaAt: null,
    menuVersion: 1, placedAt: Date.now(), acceptBy: null, rider: null, posBillNo: null, rejectReason: null, reasonText: null, ...over,
  };
  if (over.total === undefined) o.total = priceOnlineOrder(db, o, getConfig(db)['online.settings'], getConfig(db)).totalPaise;
  return o;
}

describe('online connector', () => {
  it('reads a connection link; refuses plain http to another machine', () => {
    expect(parseConnectLink('https://orders.example.in/connect/abcd-efgh')).toEqual({ hubUrl: 'https://orders.example.in', code: 'ABCD-EFGH' });
    expect(() => parseConnectLink('http://orders.example.in/connect/ABCD-EFGH')).toThrow(/https/);
    expect(() => parseConnectLink('nonsense')).toThrow(/whole connection link/);
  });

  it('pairs (the key stays on the server), publishes the menu and "accepting", and auto-accepts a new order: bill + accept sent', async () => {
    const bad = await app.inject({ method: 'POST', url: '/v1/online/pair', headers: { 'x-user-session': owner }, payload: { link: `${hub.url}/connect/ZZZZ-ZZZZ` } });
    expect(bad.json<{ error: { message: string } }>().error.message).toBe('That code is not valid.');
    const res = await app.inject({ method: 'POST', url: '/v1/online/pair', headers: { 'x-user-session': owner }, payload: { link: `${hub.url}/connect/ABCD-EFGH` } });
    expect(res.json()).toMatchObject({ paired: true, store: { slug: 'spice', name: 'Spice Garden' } });
    expect(res.body).not.toContain('dk_secret');
    expect((await app.inject({ method: 'GET', url: '/v1/config' })).body).not.toContain('dk_secret');

    await until(() => hub.menus.length > 0 && hub.statuses.length > 0 && hub.lastEventIds.length > 0);
    expect(hub.menus[0]!.items.some((i) => i.id === seedId('item:DM'))).toBe(true);
    expect(hub.statuses[0]).toEqual({ accepting: true });
    expect(hub.lastEventIds[0]).toBe('0');
    await until(() => app.online.status().connection === 'connected');

    const o = order();
    hub.push({ type: 'order.created', order: o });
    await until(() => hub.actions.some((a) => a.action === 'accept'));
    expect(hub.actions.map((a) => [a.action, a.key])).toEqual([
      ['received', `rcv-${o.id}`],
      ['accept', `acc-${o.id}`],
    ]);
    expect((hub.actions[1]!.body as { posBillNo: string }).posBillNo).toMatch(/^B\//);
    const orders = (await app.inject({ method: 'GET', url: '/v1/online/orders' })).json<{ orders: Array<{ state: string; billNo: string }> }>().orders;
    expect(orders[0]).toMatchObject({ state: 'ACCEPTED' });
    await until(() => app.online.status().pendingActions === 0);
  });

  it('the hub down never stops the server: publishing and sending fail quietly, are kept in lastError and retried', async () => {
    await app.online.stop();
    db.prepare("UPDATE online_link SET hub_url = 'http://127.0.0.1:9', device_key = 'k', store_slug = 'spice', store_name = 'Spice' WHERE id = 1").run();
    const down = new OnlineConnector({ db, now: () => new Date(), bus: new EventBus(), tickMs: 20, retryMs: [20], fetch: () => Promise.reject(new TypeError('fetch failed')), execute: () => { throw new Error('not reached'); } });
    down.start();
    await new Promise((r) => setTimeout(r, 200)); // ~10 ticks of fire-and-forget publish + flush; an unhandled rejection fails this run
    await expect(down.publish(true)).resolves.toBeUndefined();
    await expect(down.flush()).resolves.toBeUndefined();
    expect(down.status()).toMatchObject({ paired: true, lastError: 'fetch failed' });
    await down.stop();
  });

  it('dish photos go to the hub with the menu, each once; a hub that lost them gets them again', async () => {
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const send = async (type: string, payload: unknown) =>
      (await app.inject({ method: 'POST', url: '/v1/commands', headers: { 'x-user-session': owner }, payload: { commandId: newId(), type, payload, createdAt: new Date().toISOString() } })).json<{ ok: boolean; result: { image: string } }>();
    const { image } = (await send('SetItemImage', { itemId: seedId('item:DM'), dataBase64: PNG })).result;
    await app.inject({ method: 'POST', url: '/v1/online/pair', headers: { 'x-user-session': owner }, payload: { link: `${hub.url}/connect/ABCD-EFGH` } });
    await until(() => hub.menus.length > 0, 20_000); // generous: the full suite runs many servers at once
    expect(hub.photos.get(image)?.equals(Buffer.from(PNG, 'base64'))).toBe(true);
    const dal = (hub.menus.at(-1) as unknown as { items: Array<{ id: string; image: string | null }> }).items.find((i) => i.id === seedId('item:DM'))!;
    expect(dal.image).toBe(image);
    hub.photos.clear(); // the hub was rebuilt
    await send('SetItemImage', { itemId: seedId('item:PT'), dataBase64: PNG }); // the menu changes: published again
    await until(() => hub.photos.has(image), 20_000);
  });

  it('a price that changed is left for staff (noted), never accepted automatically', async () => {
    await app.inject({ method: 'POST', url: '/v1/online/pair', headers: { 'x-user-session': owner }, payload: { link: `${hub.url}/connect/ABCD-EFGH` } });
    await until(() => app.online.status().connection === 'connected');
    const o = order({ total: 12_345 });
    hub.push({ type: 'order.created', order: o });
    await until(() => typeof db.prepare('SELECT alert FROM online_order WHERE id = ?').pluck().get(o.id) === 'string');
    const r = db.prepare('SELECT state, alert FROM online_order WHERE id = ?').get(o.id) as { state: string; alert: string };
    expect(r.state).toBe('SENT_TO_STORE');
    expect(r.alert).toMatch(/^Not accepted automatically: At today's prices/);
    expect(hub.actions.some((a) => a.action === 'accept')).toBe(false);
  });

  it('after a drop it reconnects from the last stored event; a refused accept is final', async () => {
    await app.inject({ method: 'POST', url: '/v1/online/pair', headers: { 'x-user-session': owner }, payload: { link: `${hub.url}/connect/ABCD-EFGH` } });
    await until(() => app.online.status().connection === 'connected');
    const o = order();
    hub.refuse.add(`${o.id}/accept`);
    hub.push({ type: 'order.created', order: o });
    await until(() => (db.prepare('SELECT state FROM online_order WHERE id = ?').pluck().get(o.id) as string | undefined) === 'CANCELLED');
    expect(db.prepare('SELECT alert FROM online_order WHERE id = ?').pluck().get(o.id)).toMatch(/refused the accept/);
    hub.dropStreams();
    await until(() => hub.lastEventIds.length >= 2, 8000);
    expect(hub.lastEventIds.at(-1)).toBe('1'); // resumes after event 1
  });
});
