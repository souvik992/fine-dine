import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, type Fetch } from './client.js';
import { DEFAULT_SERVER_URL, loadServerUrl, normaliseServerUrl, saveServerUrl } from './settings.js';
import { StreamClient, streamUrl, type SocketLike, type StreamEvent } from './stream.js';

describe('server URL settings', () => {
  it('normalises what the user types', () => {
    expect(normaliseServerUrl('192.168.1.10')).toBe('http://192.168.1.10:7420');
    expect(normaliseServerUrl(' http://master-pc:8000/ ')).toBe('http://master-pc:8000');
    expect(() => normaliseServerUrl('')).toThrow(/Enter the outlet server/);
    expect(() => normaliseServerUrl('http://x/v1/health')).toThrow(/without a path/);
  });

  it('prefers ?server=, then the saved value, then the default', () => {
    const map = new Map<string, string>();
    const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
    expect(loadServerUrl(store, '')).toBe(DEFAULT_SERVER_URL);
    saveServerUrl(store, '10.0.0.5');
    expect(loadServerUrl(store, '')).toBe('http://10.0.0.5:7420');
    expect(loadServerUrl(store, '?server=http%3A%2F%2F127.0.0.1%3A9000')).toBe('http://127.0.0.1:9000');
    expect(streamUrl('http://10.0.0.5:7420')).toBe('ws://10.0.0.5:7420/v1/stream');
  });
});

describe('ApiClient', () => {
  const ok = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

  it('retries a network failure with the same commandId', async () => {
    const bodies: string[] = [];
    let calls = 0;
    const fetch: Fetch = (_url, init) => {
      bodies.push(init?.body as string);
      return ++calls < 3 ? Promise.reject(new TypeError('Failed to fetch')) : ok({ ok: true, commandId: 'x', result: null });
    };
    const api = new ApiClient({ baseUrl: 'http://s', fetch, retryDelayMs: 1 });
    await api.command('OpenTable', { tableId: 't' });
    const ids = bodies.map((b) => (JSON.parse(b) as { commandId: string }).commandId);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(1);
  });

  it('does not retry a server refusal and surfaces its code, details and order', async () => {
    let calls = 0;
    const fetch: Fetch = () => {
      calls++;
      return ok({ ok: false, error: { code: 'VERSION_CONFLICT', message: 'changed', details: { currentVersion: 3 } }, order: { id: 'o' } }, 409);
    };
    const api = new ApiClient({ baseUrl: 'http://s', fetch, retryDelayMs: 1 });
    const err = await api.command('AddItems', {}, { orderId: 'o', expectedVersion: 2 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'VERSION_CONFLICT', details: { currentVersion: 3 }, order: { id: 'o' } });
    expect(calls).toBe(1);
  });

  it('gives up after the last attempt with a plain NETWORK error', async () => {
    const api = new ApiClient({ baseUrl: 'http://s', fetch: () => Promise.reject(new TypeError('x')), attempts: 2, retryDelayMs: 1 });
    const err = await api.get('/v1/floor').catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'NETWORK' });
    expect((err as Error).message).toMatch(/Cannot reach/);
  });
});

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  msg(m: unknown) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  hello() {
    return JSON.parse(this.sent[0]!) as { type: string; resumeFrom: number | null; topics: string[] };
  }
}

describe('StreamClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.all = [];
  });
  afterEach(() => vi.useRealTimers());

  const make = (over: Partial<ConstructorParameters<typeof StreamClient>[0]> = {}) => {
    const events: StreamEvent[] = [];
    const statuses: string[] = [];
    const resync = vi.fn();
    const c = new StreamClient({
      url: 'ws://s/v1/stream',
      topics: ['floor'],
      onEvent: (e) => events.push(e),
      onResync: resync,
      onStatus: (s) => statuses.push(s),
      createSocket: (u) => new FakeSocket(u),
      silenceMs: 1_000,
      backoffMs: [10, 20],
      ...over,
    });
    c.start();
    return { c, events, statuses, resync };
  };

  it('says hello, goes live, and delivers events once in order', () => {
    const { events, statuses } = make();
    const s = FakeSocket.all[0]!;
    s.open();
    expect(s.hello()).toEqual({ type: 'hello', resumeFrom: null, topics: ['floor'] });
    s.msg({ type: 'ready', lastSeq: 10, replayed: 0 });
    s.msg({ seq: 11, topic: 'floor', event: 'table.state', at: 'x', data: {} });
    s.msg({ seq: 11, topic: 'floor', event: 'table.state', at: 'x', data: {} }); // duplicate
    s.msg({ seq: 9, topic: 'floor', event: 'old', at: 'x', data: {} }); // older than ready
    expect(events.map((e) => e.seq)).toEqual([11]);
    expect(statuses).toEqual(['live']);
  });

  it('reconnects with backoff and resumes from the last seq', () => {
    const { c, statuses } = make();
    const s1 = FakeSocket.all[0]!;
    s1.open();
    s1.msg({ type: 'ready', lastSeq: 5, replayed: 0 });
    s1.msg({ seq: 7, topic: 'floor', event: 'e', at: 'x', data: {} });
    s1.close(1006);
    expect(statuses.at(-1)).toBe('offline');
    vi.advanceTimersByTime(10);
    const s2 = FakeSocket.all[1]!;
    s2.open();
    expect(s2.hello().resumeFrom).toBe(7);
    expect(c.resumeFrom).toBe(7);
    s2.msg({ type: 'ready', lastSeq: 9, replayed: 2 });
    expect(statuses.at(-1)).toBe('live');
  });

  it('asks the app to refetch on resync', () => {
    const { resync, c } = make();
    const s = FakeSocket.all[0]!;
    s.open();
    s.msg({ type: 'resync', lastSeq: 500 });
    expect(resync).toHaveBeenCalledOnce();
    expect(c.resumeFrom).toBe(500);
  });

  it('treats silence as offline and reconnects', () => {
    const { statuses } = make();
    const s = FakeSocket.all[0]!;
    s.open();
    s.msg({ type: 'ready', lastSeq: 0, replayed: 0 });
    vi.advanceTimersByTime(900);
    s.msg({ type: 'heartbeat', lastSeq: 0, at: 'x' }); // keeps it alive
    vi.advanceTimersByTime(900);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(200); // 1.1 s of silence
    expect(statuses.at(-1)).toBe('offline');
    vi.advanceTimersByTime(10);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it('stop() closes the socket and never reconnects', () => {
    const { c } = make();
    FakeSocket.all[0]!.open();
    c.stop();
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.all).toHaveLength(1);
  });
});
