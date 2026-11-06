// The DinePOS side of online orders (P4-06, pos-backend/contract v1). While online orders are on and the outlet is paired
// with a hub, the master server:
//  - keeps one outgoing event stream (SSE) to the hub, resuming from the last stored event number after any drop;
//  - stores each event through a command (ApplyHubEvent) before anything else, so nothing is lost or applied twice;
//  - sends the outbox (received / accept / reject / state) in order, retried with the same idempotency key;
//  - publishes the menu and settings when they change, and "accepting" = online on + a business day open;
//  - accepts new orders itself in automatic mode (as the `system` device), only when the totals match.
// The outlet never accepts incoming connections from the internet; billing never waits for the hub.
import { type CommandSuccess, type HubEvent, type OnlineStatus } from '@dinepos/shared';
import { currentBusinessDate } from '../core/business-day.js';
import type { Actor } from '../core/context.js';
import { PosError } from '../core/errors.js';
import type { EventBus } from '../core/events.js';
import { getConfig } from '../core/outlet-config.js';
import type { Db } from '../db/connection.js';
import { publishedMenu } from './menu.js';
import { linkRow } from './online-support.js';

export type Execute = (type: string, payload: unknown, actor?: Actor) => CommandSuccess;

/** P5-03: a guest's request the hub relays down the event stream (a phone on mobile data opening an add-on page). */
export interface GuestRequest {
  id: string;
  method: 'GET' | 'POST';
  path: string;
  query: string;
  body: string | null;
  ip: string;
}
export interface GuestAnswer {
  status: number;
  contentType: string;
  cacheControl: string | null;
  bodyBase64: string;
}

export interface ConnectorOptions {
  db: Db;
  now: () => Date;
  execute: Execute;
  bus: EventBus;
  fetch?: typeof fetch;
  /** Waits between reconnects (ms), the last repeated. */
  retryMs?: number[];
  /** Housekeeping tick: publish if changed, send the outbox. The stream is dead after 3 ticks of silence. */
  tickMs?: number;
  log?: { info: (msg: string, data?: unknown) => void; warn: (msg: string, data?: unknown) => void };
  /** P5-03: answers a relayed guest request (the add-on guest pages, served inside this server). */
  relay?: (r: GuestRequest) => Promise<GuestAnswer>;
  /** P5-03: an add-on needs the hub connection even with online orders off (e.g. Table QR through the hub). */
  wantsHub?: () => boolean;
}

export const SYSTEM_ACTOR: Actor = { deviceId: null, userId: null, deviceKind: 'system' };

interface HubAnswer {
  error?: { code?: string; message?: string; details?: { state?: string } };
}

export class OnlineConnector {
  private readonly o: Required<Omit<ConnectorOptions, 'log' | 'relay' | 'wantsHub'>> & Pick<ConnectorOptions, 'log' | 'relay' | 'wantsHub'>;
  private state: OnlineStatus['connection'] = 'off';
  private lastError: string | null = null;
  private lastEventAt: string | null = null;
  private running = false;
  private abort: AbortController | null = null;
  private wake: (() => void) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private loopDone: Promise<void> | null = null;
  private flushing: Promise<void> | null = null;
  private flushAgain = false;
  private publishing: Promise<void> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(opts: ConnectorOptions) {
    this.o = { fetch: (input, init) => fetch(input, init), retryMs: [1000, 2000, 5000, 10_000, 30_000], tickMs: 15_000, ...opts };
  }

  /** Begins watching settings and the outbox; connects whenever online orders are on and the outlet is paired. */
  start(): void {
    this.unsubscribe ??= this.o.bus.subscribe((e) => {
      if (e.event === 'online.outbox') void this.flush();
      else if (e.event === 'online.linked' || e.event === 'config.changed' || e.event === 'day.changed' || e.event === 'addon.hub') this.refresh();
      else if (e.event === 'menu.changed' || e.event === 'stock.changed') void this.publish();
    });
    this.refresh();
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.halt();
  }

  status(): OnlineStatus {
    const link = linkRow(this.o.db);
    const pending = this.o.db.prepare('SELECT count(*) FROM online_outbox WHERE done_at IS NULL').pluck().get() as number;
    return {
      paired: Boolean(link.device_key),
      hubUrl: link.hub_url,
      store: link.store_slug ? { slug: link.store_slug, name: link.store_name ?? link.store_slug } : null,
      connection: link.device_key ? this.state : 'not-paired',
      lastError: this.lastError,
      lastEventAt: this.lastEventAt,
      accepting: this.accepting(),
      pendingActions: pending,
      menuVersion: link.menu_version,
    };
  }

  private settings() {
    return getConfig(this.o.db)['online.settings'];
  }

  private accepting(): boolean {
    return this.settings().enabled && Boolean(linkRow(this.o.db).device_key) && currentBusinessDate(this.o.db) !== null;
  }

  /** Start, stop or wake according to the settings (paired, and online orders on or an add-on using the hub). */
  refresh(): void {
    const should = Boolean(linkRow(this.o.db).device_key) && (this.settings().enabled || this.o.wantsHub?.() === true);
    if (should && !this.running) {
      this.running = true;
      this.loopDone = this.loop().catch((e: unknown) => this.o.log?.warn('order hub connection stopped', String(e)));
      this.timer = setInterval(() => {
        void this.publish();
        void this.flush();
      }, this.o.tickMs);
      this.timer.unref?.();
    } else if (!should && this.running) void this.halt();
    else if (should) {
      void this.publish();
      this.wake?.();
    }
    if (!should) this.state = 'off';
  }

  private async halt(): Promise<void> {
    this.running = false;
    this.abort?.abort();
    this.wake?.();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.loopDone;
    await this.flushing;
    await this.publishing;
    this.loopDone = null;
    this.state = 'off';
  }

  private async loop(): Promise<void> {
    let attempt = 0;
    while (this.running) {
      this.state = 'connecting';
      try {
        await this.publish(true);
        await this.flush();
        await this.stream(() => {
          attempt = 0;
          this.state = 'connected';
          this.lastError = null;
        });
        if (!this.running) break;
        throw new Error('the hub closed the connection');
      } catch (e) {
        if (!this.running) break;
        this.state = 'retrying';
        this.lastError = (e as Error).name === 'AbortError' ? 'connection lost' : (e as Error).message;
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
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Bearer ${linkRow(this.o.db).device_key ?? ''}`, ...extra };
  }
  private url(path: string): string {
    return `${linkRow(this.o.db).hub_url ?? ''}${path}`;
  }

  private async stream(onOpen: () => void): Promise<void> {
    this.abort = new AbortController();
    if (!this.running) return;
    const last = linkRow(this.o.db).last_seq;
    const r = await this.o.fetch(this.url('/v1/pos/events'), { headers: this.headers({ 'last-event-id': String(last), accept: 'text/event-stream' }), signal: this.abort.signal });
    if (r.status === 401) {
      this.running = false;
      throw new Error('The hub no longer knows this outlet. Connect it again (Settings › Online orders).');
    }
    if (!r.ok || !r.body) throw new Error(`the hub answered ${r.status}`);
    onOpen();
    let silence: NodeJS.Timeout | null = null;
    const arm = () => {
      if (silence) clearTimeout(silence);
      silence = setTimeout(() => this.abort?.abort(), this.o.tickMs * 3); // 3 missed heartbeats: the line is dead
    };
    arm();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
        if (!this.running) break;
        arm();
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const lines = block.split('\n');
          const name = lines.find((l) => l.startsWith('event:'))?.slice(6).trim();
          const data = lines
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trimStart())
            .join('\n');
          if (!data) continue;
          // a guest's request (P5-03) is answered, never stored: it is not an order event and has no number
          if (name === 'guest.request') void this.answerGuest(JSON.parse(data) as GuestRequest);
          else this.handle(JSON.parse(data) as HubEvent);
        }
      }
    } finally {
      if (silence) clearTimeout(silence);
    }
  }

  /** P5-03: answers a relayed guest request and sends the answer back to the hub. Never rejects. */
  async answerGuest(r: GuestRequest): Promise<void> {
    const plain = (status: number, message: string): GuestAnswer => ({
      status,
      contentType: 'application/json; charset=utf-8',
      cacheControl: 'no-store',
      bodyBase64: Buffer.from(JSON.stringify({ ok: false, error: { code: status === 404 ? 'NOT_FOUND' : 'INTERNAL', message } })).toString('base64'),
    });
    let answer: GuestAnswer;
    try {
      answer = this.o.relay ? await this.o.relay(r) : plain(404, 'This page is not available through the internet.');
    } catch (e) {
      this.o.log?.warn('a guest request through the hub failed', String(e));
      answer = plain(500, 'Something went wrong at the restaurant. Please try again.');
    }
    try {
      const res = await this.o.fetch(this.url(`/v1/pos/relay/${encodeURIComponent(String(r.id))}`), {
        method: 'POST',
        headers: this.headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(answer),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok && res.status !== 404) this.failed('answering a guest through the hub failed', new Error(`the hub answered ${res.status}`));
    } catch (e) {
      this.failed('answering a guest through the hub failed', e);
    }
  }

  /** One hub event: stored by command (once), then the outbox is sent; automatic accepting when chosen. */
  handle(ev: HubEvent): void {
    const res = this.o.execute('ApplyHubEvent', { event: ev }, SYSTEM_ACTOR);
    this.lastEventAt = this.o.now().toISOString();
    void this.flush();
    if ((res.result as { applied?: boolean }).applied && ev.type === 'order.created' && this.settings().acceptMode === 'auto') {
      try {
        this.o.execute('AcceptOnlineOrder', { onlineOrderId: ev.order.id }, SYSTEM_ACTOR);
      } catch (e) {
        // Left for staff (a price that changed, no business day, a dish off the menu): it waits in New with the reason.
        const reason = e instanceof PosError ? e.message : String(e);
        this.o.execute('NoteOnlineOrder', { onlineOrderId: ev.order.id, alert: `Not accepted automatically: ${reason}`.slice(0, 300) }, SYSTEM_ACTOR);
      }
    }
  }

  /**
   * Menu, prices, availability and settings, when they changed (by hash); and whether the outlet is taking orders.
   * Never rejects: callers fire it and forget (ticks, settings changes), and an unhandled rejection would stop the whole
   * server. A failure (the hub down) is kept in lastError and tried again on the next tick.
   */
  publish(force = false): Promise<void> {
    if (!this.running) return Promise.resolve();
    this.publishing ??= this.publishOnce(force)
      .catch((e: unknown) => this.failed('publishing to the order hub failed', e))
      .finally(() => {
        this.publishing = null;
      });
    return this.publishing;
  }

  private failed(what: string, e: unknown): void {
    const message = e instanceof Error ? (e.name === 'TimeoutError' ? 'the hub did not answer in time' : e.message) : String(e);
    if (this.lastError !== message) this.o.log?.warn(what, message);
    this.lastError = message;
  }

  private async publishOnce(force: boolean): Promise<void> {
    const cfg = getConfig(this.o.db);
    const { body, hash } = publishedMenu(this.o.db, cfg['online.settings'], cfg);
    const link = linkRow(this.o.db);
    if (force || hash !== link.menu_hash) {
      // photos first: a failure leaves the menu unrecorded, so the whole publish is tried again on the next tick
      await this.sendPhotos(body.items.map((i) => i.image));
      const version = link.menu_version + 1;
      const r = await this.o.fetch(this.url('/v1/pos/menu'), { method: 'PUT', headers: this.headers({ 'content-type': 'application/json' }), body: JSON.stringify({ ...body, version }), signal: AbortSignal.timeout(15_000) });
      if (!r.ok) {
        const j = (await r.json().catch(() => null)) as HubAnswer | null;
        throw new Error(`publishing the menu failed: ${j?.error?.message ?? r.status}`);
      }
      this.o.execute('RecordOnlinePublish', { hash, version }, SYSTEM_ACTOR);
    }
    const accepting = this.accepting();
    await this.o.fetch(this.url('/v1/pos/status'), {
      method: 'PUT',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(accepting ? { accepting: true } : { accepting: false, reason: 'The restaurant is not taking online orders right now.' }),
      signal: AbortSignal.timeout(10_000),
    });
  }

  /**
   * The menu's photos the hub does not have yet (it lists what it holds, so a new or restored hub gets them all).
   * Sent with each menu publish; a photo refused is tried again with the next one.
   */
  private async sendPhotos(names: Array<string | null>): Promise<void> {
    const want = [...new Set(names.filter((n): n is string => Boolean(n)))];
    if (want.length === 0) return;
    const r = await this.o.fetch(this.url('/v1/pos/images'), { headers: this.headers(), signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`the hub did not list its photos (${r.status})`);
    const have = new Set(((await r.json()) as { names?: string[] }).names ?? []);
    const read = this.o.db.prepare('SELECT bytes FROM menu_image WHERE name = ?').pluck();
    for (const name of want) {
      if (have.has(name) || !this.running) continue;
      const bytes = read.get(name) as Buffer | undefined;
      if (!bytes) continue;
      const up = await this.o.fetch(this.url(`/v1/pos/images/${encodeURIComponent(name)}`), {
        method: 'PUT',
        headers: this.headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ dataBase64: bytes.toString('base64') }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!up.ok) throw new Error(`the hub refused a photo (${up.status})`);
    }
  }

  /**
   * Sends waiting actions in order. Network trouble: stop and try later. A refusal (409/404/400) is final. Asked again
   * while sending (an accept queued meanwhile): goes round once more before finishing, so nothing waits for the tick.
   */
  flush(): Promise<void> {
    if (!this.running) return Promise.resolve();
    if (this.flushing) {
      this.flushAgain = true;
      return this.flushing;
    }
    this.flushing = (async () => {
      do {
        this.flushAgain = false;
        await this.flushOnce();
      } while (this.flushAgain && this.running);
    })()
      .catch((e: unknown) => this.failed('sending to the order hub failed', e)) // never rejects (see publish)
      .finally(() => {
        this.flushing = null;
      });
    return this.flushing;
  }

  private async flushOnce(): Promise<void> {
    const rows = this.o.db.prepare('SELECT id, order_id, action, body_json, idem_key FROM online_outbox WHERE done_at IS NULL ORDER BY id').all() as Array<{ id: number; order_id: string; action: string; body_json: string; idem_key: string }>;
    for (const row of rows) {
      if (!this.running) break;
      let r: Response;
      try {
        r = await this.o.fetch(this.url(`/v1/pos/orders/${encodeURIComponent(row.order_id)}/${row.action}`), {
          method: 'POST',
          headers: this.headers({ 'content-type': 'application/json', 'idempotency-key': row.idem_key }),
          body: row.body_json,
          signal: AbortSignal.timeout(10_000),
        });
      } catch (e) {
        this.o.execute('RecordHubAction', { outboxId: row.id, outcome: 'failed', message: (e as Error).message.slice(0, 300) }, SYSTEM_ACTOR);
        break;
      }
      const j = (await r.json().catch(() => null)) as HubAnswer | null;
      if (r.ok) {
        this.o.execute('RecordHubAction', { outboxId: row.id, outcome: 'done' }, SYSTEM_ACTOR);
        continue;
      }
      if (r.status === 409 || r.status === 404 || r.status === 400) {
        const state = j?.error?.details?.state ?? null;
        this.o.execute('RecordHubAction', { outboxId: row.id, outcome: 'refused', message: (j?.error?.message ?? String(r.status)).slice(0, 300), state }, SYSTEM_ACTOR);
        continue;
      }
      this.o.execute('RecordHubAction', { outboxId: row.id, outcome: 'failed', message: `the hub answered ${r.status}` }, SYSTEM_ACTOR);
      break;
    }
  }
}
