import { newId } from '@dinepos/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildApp, type DinePosApp } from '../app.js';
import { singleTerminalAuth } from '../auth/authenticate.js';
import { allowAllRights } from '../core/rights.js';
import { EventBus } from '../core/events.js';
import { TEST_NOW, useHarness } from '../testing/command-harness.js';
import { S, seedOutlet } from '../testing/order-fixture.js';
import { CLOSE, rawText, topicMatches } from './hub.js';

type Msg = { type?: string; seq?: number; topic?: string; event?: string; data?: Record<string, unknown>; lastSeq?: number; replayed?: number };

/** A stream client that records messages and can wait for one. */
class Client {
  readonly messages: Msg[] = [];
  readonly ws: WebSocket;
  closed: Promise<{ code: number }>;
  private waiters: Array<{ match: (m: Msg) => boolean; resolve: (m: Msg) => void }> = [];

  constructor(url: string, headers: Record<string, string> = {}) {
    this.ws = new WebSocket(url, { headers });
    this.ws.on('message', (raw) => {
      const m = JSON.parse(rawText(raw)) as Msg;
      this.messages.push(m);
      this.waiters = this.waiters.filter((w) => (w.match(m) ? (w.resolve(m), false) : true));
    });
    this.closed = new Promise((r) => this.ws.on('close', (code) => r({ code })));
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
      this.ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    });
  }

  hello(topics: string[], resumeFrom: number | null = null): Promise<Msg> {
    const ready = this.next((m) => m.type === 'ready' || m.type === 'resync');
    this.ws.send(JSON.stringify({ type: 'hello', resumeFrom, topics }));
    return ready;
  }

  next(match: (m: Msg) => boolean, timeoutMs = 2_000): Promise<Msg> {
    const found = this.messages.find(match);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timed out waiting for message')), timeoutMs);
      this.waiters.push({ match, resolve: (m) => (clearTimeout(t), resolve(m)) });
    });
  }

  events(): Msg[] {
    return this.messages.filter((m) => m.type === undefined);
  }
}

describe('realtime hub (/v1/stream)', () => {
  const h = useHarness();
  let app: DinePosApp;
  let base: string;
  const clients: Client[] = [];

  beforeEach(async () => {
    seedOutlet(h);
    // Stream tests: commands sent without sign-in (auth has its own tests).
    app = buildApp({ db: h.db, timeZone: 'Asia/Kolkata', now: TEST_NOW, bus: new EventBus(), hub: { heartbeatMs: 100, helloTimeoutMs: 200 }, auth: singleTerminalAuth, rights: allowAllRights });
    const url = await app.listen({ host: '127.0.0.1', port: 0 });
    base = url.replace('http', 'ws');
  });
  afterEach(async () => {
    for (const c of clients.splice(0)) c.ws.terminate();
    await app.close();
  });

  const connect = async (headers?: Record<string, string>) => {
    const c = new Client(`${base}/v1/stream`, headers);
    clients.push(c);
    await c.open();
    return c;
  };
  const post = (type: string, payload: unknown) =>
    app.inject({ method: 'POST', url: '/v1/commands', payload: { commandId: newId(), type, payload, createdAt: '2026-11-02T13:30:00+05:30' } });

  // P1-08 acceptance at the protocol level: two terminals see the same change within 1 s.
  it('two clients both receive table.state within 1 s of a command', async () => {
    const [a, b] = [await connect(), await connect()];
    await Promise.all([a.hello(['floor']), b.hello(['floor'])]);
    const started = Date.now();
    expect((await post('OpenTable', { tableId: S.t1, covers: 2 })).statusCode).toBe(200);
    const [ea, eb] = await Promise.all([
      a.next((m) => m.event === 'table.state', 1_000),
      b.next((m) => m.event === 'table.state', 1_000),
    ]);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(ea.data).toMatchObject({ tableId: S.t1, state: 'SEATED' });
    expect(eb.seq).toBe(ea.seq);
  });

  it('replays missed events after resumeFrom, then streams live', async () => {
    const seq0 = app.realtime.lastSeq();
    await post('OpenTable', { tableId: S.t1, covers: 2 });
    const c = await connect();
    const ready = await c.hello(['floor'], seq0);
    expect(ready).toMatchObject({ type: 'ready', replayed: 2 }); // order.updated + table.state on floor
    expect(c.events().map((e) => e.event).sort()).toEqual(['order.updated', 'table.state']);
    await post('OpenTable', { tableId: S.t2, covers: 2 });
    await c.next((m) => m.event === 'table.state' && m.data?.tableId === S.t2);
    const seqs = c.events().map((e) => e.seq!);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('sends resync when the requested events were already pruned', async () => {
    await post('OpenTable', { tableId: S.t1, covers: 2 });
    h.db.prepare('DELETE FROM event_log WHERE seq <= ?').run(app.realtime.lastSeq() - 1);
    const c = await connect();
    expect(await c.hello(['floor'], 1)).toMatchObject({ type: 'resync' });
  });

  it('filters by topic, with prefix wildcards', async () => {
    const c = await connect();
    await c.hello(['menu']);
    const all = await connect();
    await all.hello(['order:*']);
    await post('OpenTable', { tableId: S.t1, covers: 2 });
    await all.next((m) => m.event === 'order.updated');
    expect(c.events()).toEqual([]);
    expect(topicMatches(['order:*'], 'order:01ABC')).toBe(true);
    expect(topicMatches(['order:*'], 'orders')).toBe(false);
    expect(topicMatches(['station:x'], 'station:y')).toBe(false);
  });

  it('closes on a bad hello or no hello in time', async () => {
    const bad = await connect();
    bad.ws.send('{"type":"hello","topics":[]}');
    expect((await bad.closed).code).toBe(CLOSE.BAD_HELLO);
    const silent = await connect();
    expect((await silent.closed).code).toBe(CLOSE.HELLO_TIMEOUT);
  });

  it('sends heartbeats with the latest seq', async () => {
    const c = await connect();
    await c.hello(['floor']);
    expect(await c.next((m) => m.type === 'heartbeat')).toMatchObject({ lastSeq: app.realtime.lastSeq() });
  });

  it('refuses a WebSocket from a foreign web page, allows the desktop app', async () => {
    await expect(connect({ origin: 'https://evil.example' })).rejects.toThrow(/403/);
    await expect(connect({ origin: 'app://dinepos' })).resolves.toBeDefined();
  });

  it('answers CORS preflights only for allowed origins', async () => {
    const pre = (origin: string) =>
      app.inject({ method: 'OPTIONS', url: '/v1/commands', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
    expect((await pre('app://dinepos')).headers['access-control-allow-origin']).toBe('app://dinepos');
    expect((await pre('https://evil.example')).headers['access-control-allow-origin']).toBeUndefined();
  });

  it('closes clients on server shutdown', async () => {
    const c = await connect();
    await c.hello(['floor']);
    const closed = c.closed;
    await app.close();
    expect((await closed).code).toBe(CLOSE.SHUTDOWN);
    app = buildApp({ db: h.db, timeZone: 'Asia/Kolkata' }); // afterEach closes this one
  });
});
