// Devices from anywhere (P6-02, ADR-0005). While "devices through DinePOS Cloud" is on and the outlet is connected to
// the cloud, this PC keeps one outgoing WebSocket to <cloud>/v1/pos/tunnel. Terminals, captain phones and kitchen
// screens use https://<store>.<cloud>/; the cloud sends each of their requests down this tunnel, the server answers it
// as if it came over the LAN from a remote device (never as the trusted master PC: the device's own pairing, session
// and rights apply), and their live streams are attached to the realtime hub through a virtual socket.
// The outlet still accepts no incoming connection from the internet, and billing on the LAN never waits for the cloud.
import { EventEmitter } from 'node:events';
import type { EventBus } from '../core/events.js';
import { getConfig } from '../core/outlet-config.js';
import type { Db } from '../db/connection.js';
import { linkRow } from '../online/online-support.js';

export interface TunnelRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Buffer | null;
}
export interface TunnelAnswer {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

export interface CloudStatus {
  enabled: boolean;
  paired: boolean;
  connection: 'off' | 'connecting' | 'connected' | 'retrying';
  /** The address devices use for this outlet (from the cloud), once known. */
  deviceUrl: string | null;
  lastError: string | null;
  /** Device live streams open through the cloud right now. */
  streams: number;
}

export interface TunnelOptions {
  db: Db;
  bus: EventBus;
  /** Answers a device's request inside this server, marked as coming through the cloud. */
  inject: (r: TunnelRequest) => Promise<TunnelAnswer>;
  /** Attaches a device's live stream to the realtime hub. */
  attachStream: (socket: VirtualSocket) => void;
  fetch?: typeof fetch;
  WebSocketImpl?: typeof WebSocket;
  retryMs?: number[];
  log?: { info: (msg: string, data?: unknown) => void; warn: (msg: string, data?: unknown) => void };
}

/**
 * Looks like a `ws` WebSocket to the realtime hub (send, close, ping, terminate; message/close/pong events), but its
 * frames travel in the cloud tunnel.
 */
export class VirtualSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  private readonly out: (m: Record<string, unknown>) => void;
  readonly id: string;

  constructor(id: string, out: (m: Record<string, unknown>) => void) {
    super();
    this.id = id;
    this.out = out;
  }

  send(data: string | Buffer): void {
    if (this.readyState === 1) this.out({ t: 'ws.msg', id: this.id, data: typeof data === 'string' ? data : data.toString('utf8') });
  }

  /** The tunnel's own keep-alive covers the line: a ping is answered at once. */
  ping(): void {
    if (this.readyState === 1) setImmediate(() => this.emit('pong'));
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.out({ t: 'ws.close', id: this.id, code });
    this.emit('close', code, Buffer.from(reason));
  }

  terminate(): void {
    this.close(1001, 'closed');
  }

  /** A message from the device. */
  receive(data: string): void {
    if (this.readyState === 1) this.emit('message', Buffer.from(data, 'utf8'), false);
  }

  /** The device (or the cloud) ended the stream. */
  ended(code: number): void {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.emit('close', code, Buffer.alloc(0));
  }
}

export class CloudTunnel {
  private readonly o: TunnelOptions & { retryMs: number[]; fetch: typeof fetch };
  private running = false;
  private ws: WebSocket | null = null;
  private state: CloudStatus['connection'] = 'off';
  private lastError: string | null = null;
  private deviceUrl: string | null = null;
  private readonly streams = new Map<string, VirtualSocket>();
  private loopDone: Promise<void> | null = null;
  private wake: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(o: TunnelOptions) {
    this.o = { retryMs: [1000, 2000, 5000, 10_000, 30_000], fetch: (i, init) => fetch(i, init), ...o };
  }

  start(): void {
    this.unsubscribe ??= this.o.bus.subscribe((e) => {
      if (e.event === 'config.changed' || e.event === 'online.linked') this.refresh();
    });
    this.refresh();
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.halt();
  }

  status(): CloudStatus {
    const link = linkRow(this.o.db);
    return {
      enabled: this.enabled(),
      paired: Boolean(link.device_key),
      connection: this.state,
      deviceUrl: this.deviceUrl,
      lastError: this.lastError,
      streams: this.streams.size,
    };
  }

  private enabled(): boolean {
    return getConfig(this.o.db)['cloud.remoteDevices'];
  }

  refresh(): void {
    const link = linkRow(this.o.db);
    const should = this.enabled() && Boolean(link.device_key && link.hub_url);
    if (should && !this.running) {
      this.running = true;
      this.loopDone = this.loop().catch((e: unknown) => this.o.log?.warn('cloud tunnel stopped', String(e)));
    } else if (!should && this.running) void this.halt();
  }

  private async halt(): Promise<void> {
    this.running = false;
    this.ws?.close(1000, 'switched off');
    this.wake?.();
    await this.loopDone;
    this.loopDone = null;
    this.state = 'off';
  }

  private async loop(): Promise<void> {
    let attempt = 0;
    while (this.running) {
      this.state = attempt ? 'retrying' : 'connecting';
      try {
        await this.connectOnce(() => {
          attempt = 0;
          this.state = 'connected';
          this.lastError = null;
        });
        if (!this.running) break;
        this.lastError ??= 'the cloud closed the connection';
      } catch (e) {
        this.lastError = (await this.whyRefused()) ?? (e instanceof Error ? e.message : String(e));
      }
      for (const s of this.streams.values()) s.ended(1012);
      this.streams.clear();
      if (!this.running) break;
      this.state = 'retrying';
      const wait = this.o.retryMs[Math.min(attempt++, this.o.retryMs.length - 1)]!;
      await new Promise<void>((r) => {
        const t = setTimeout(r, wait);
        this.wake = () => {
          clearTimeout(t);
          r();
        };
      });
      this.wake = null;
    }
  }

  private connectOnce(onOpen: () => void): Promise<void> {
    const link = linkRow(this.o.db);
    const url = `${String(link.hub_url).replace(/\/+$/, '').replace(/^http/, 'ws')}/v1/pos/tunnel`;
    const WS = this.o.WebSocketImpl ?? WebSocket;
    return new Promise<void>((resolve, reject) => {
      let opened = false;
      const ws = new WS(url, { headers: { authorization: `Bearer ${link.device_key ?? ''}` } });
      this.ws = ws;
      ws.onopen = () => {
        opened = true;
        onOpen();
        void this.fetchInfo();
      };
      ws.onmessage = (ev: MessageEvent) => void this.handle(ws, String(ev.data));
      ws.onerror = () => {
        if (!opened) reject(new Error('could not reach DinePOS Cloud'));
      };
      ws.onclose = (ev: { code: number }) => {
        this.ws = null;
        if (!opened) return reject(new Error(ev.code === 1006 ? 'could not reach DinePOS Cloud' : `the cloud refused the connection (${ev.code})`));
        if (this.running) this.lastError = ev.code === 4000 ? 'another connection from this outlet replaced this one' : 'connection lost';
        resolve();
      };
    });
  }

  /**
   * After a failed connection: a hub that answers but has no relay (the Tiffin order hub, or an old DinePOS Cloud) is
   * named as such, so the owner knows to link this outlet to a DinePOS Cloud server rather than wait for it to recover.
   */
  private async whyRefused(): Promise<string | null> {
    const link = linkRow(this.o.db);
    try {
      const r = await this.o.fetch(`${String(link.hub_url).replace(/\/+$/, '')}/v1/pos/tunnel-info`, { headers: { authorization: `Bearer ${link.device_key ?? ''}` }, signal: AbortSignal.timeout(10_000) });
      if (r.status === 404) return 'this hub is not DinePOS Cloud (it has no device relay): link this outlet to a DinePOS Cloud server';
      if (r.status === 401 || r.status === 403) return 'DinePOS Cloud does not know this outlet: link it again in Cloud sync';
    } catch {
      // not reachable at all: the connection error says so
    }
    return null;
  }

  /** The device address for this outlet, as the cloud names it. */
  private async fetchInfo(): Promise<void> {
    const link = linkRow(this.o.db);
    try {
      const r = await this.o.fetch(`${String(link.hub_url).replace(/\/+$/, '')}/v1/pos/tunnel-info`, { headers: { authorization: `Bearer ${link.device_key ?? ''}` }, signal: AbortSignal.timeout(10_000) });
      if (r.ok) this.deviceUrl = ((await r.json()) as { deviceUrl: string | null }).deviceUrl;
    } catch {
      // shown again on the next connection
    }
  }

  private send(ws: WebSocket, m: Record<string, unknown>): void {
    if (ws.readyState === 1) ws.send(JSON.stringify(m));
  }

  private async handle(ws: WebSocket, text: string): Promise<void> {
    let m: { t?: string; id?: string; method?: string; path?: string; headers?: Record<string, string>; body?: string | null; data?: string; code?: number };
    try {
      m = JSON.parse(text) as typeof m;
    } catch {
      return;
    }
    const id = String(m.id ?? '');
    if (m.t === 'req') {
      let a: TunnelAnswer;
      try {
        a = await this.o.inject({ method: String(m.method ?? 'GET'), path: String(m.path ?? '/'), headers: m.headers ?? {}, body: typeof m.body === 'string' ? Buffer.from(m.body, 'base64') : null });
      } catch (e) {
        this.o.log?.warn('a device request through the cloud failed', String(e));
        a = { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' }, body: Buffer.from(JSON.stringify({ ok: false, error: { code: 'INTERNAL', message: 'Something went wrong on the outlet server. Please try again.' } })) };
      }
      this.send(ws, { t: 'res', id, status: a.status, headers: a.headers, body: a.body.toString('base64') });
    } else if (m.t === 'ws.open') {
      const vs = new VirtualSocket(id, (out) => this.send(ws, out));
      vs.on('close', () => this.streams.delete(id));
      this.streams.set(id, vs);
      this.o.attachStream(vs);
    } else if (m.t === 'ws.msg') {
      if (typeof m.data === 'string') this.streams.get(id)?.receive(m.data);
    } else if (m.t === 'ws.close') {
      const vs = this.streams.get(id);
      this.streams.delete(id);
      vs?.ended(Number(m.code) || 1000);
    }
  }
}
