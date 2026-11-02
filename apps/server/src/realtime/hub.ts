// WebSocket fan-out of committed events (docs/04-realtime-events.md). Events are written to event_log inside
// the command transaction and reach the hub through the EventBus after commit.
import type { RawData, WebSocket } from 'ws';
import { z } from 'zod';
import type { EventBus, PublishedEvent } from '../core/events.js';
import type { Db } from '../db/connection.js';

export interface HubOptions {
  /** Server heartbeat + ping interval (docs/04: 15 s). Two missed pongs drop the client. */
  heartbeatMs?: number;
  /** Time allowed for the first `hello` message. */
  helloTimeoutMs?: number;
  /** A client this far behind (bytes queued) is disconnected; it resumes on reconnect. */
  maxBufferedBytes?: number;
  now?: () => Date;
}

const topicSchema = z.string().regex(/^[a-z]+(:([A-Za-z0-9_-]+|\*))?$/, 'invalid topic');
const helloSchema = z
  .object({
    type: z.literal('hello'),
    deviceToken: z.string().max(512).nullable().optional(),
    resumeFrom: z.number().int().min(0).nullable(),
    topics: z.array(topicSchema).min(1).max(50),
  })
  .strict();

export type ServerMessage =
  | { type: 'ready'; lastSeq: number; replayed: number }
  | { type: 'resync'; lastSeq: number }
  | { type: 'heartbeat'; lastSeq: number; at: string }
  | { type: 'error'; message: string }
  | (PublishedEvent & { type?: undefined });

/** Close codes (4000-4999 are free for applications). */
export const CLOSE = { BAD_HELLO: 4400, HELLO_TIMEOUT: 4408, TOO_SLOW: 4429, SHUTDOWN: 1001 } as const;

/** ws delivers a Buffer, an ArrayBuffer or Buffer fragments. */
export function rawText(raw: RawData): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  return Buffer.isBuffer(raw) ? raw.toString('utf8') : Buffer.from(raw).toString('utf8');
}

export function topicMatches(patterns: readonly string[], topic: string): boolean {
  return patterns.some((p) => p === topic || (p.endsWith(':*') && topic.startsWith(p.slice(0, -1))));
}

export class RealtimeHub {
  private readonly clients = new Set<WebSocket>();
  private readonly heartbeatMs: number;
  private readonly helloTimeoutMs: number;
  private readonly maxBuffered: number;
  private readonly now: () => Date;

  constructor(
    private readonly db: Db,
    private readonly bus: EventBus,
    opts: HubOptions = {},
  ) {
    this.heartbeatMs = opts.heartbeatMs ?? 15_000;
    this.helloTimeoutMs = opts.helloTimeoutMs ?? 10_000;
    this.maxBuffered = opts.maxBufferedBytes ?? 1024 * 1024;
    this.now = opts.now ?? (() => new Date());
  }

  get size(): number {
    return this.clients.size;
  }

  lastSeq(): number {
    return (this.db.prepare('SELECT max(seq) FROM event_log').pluck().get() as number | null) ?? 0;
  }

  /** Takes over a freshly upgraded socket. */
  attach(socket: WebSocket): void {
    this.clients.add(socket);
    let topics: string[] | null = null;
    let backlog: PublishedEvent[] | null = null; // live events held back while replaying
    let replayedUpTo = 0;
    let missedPongs = 0;

    const send = (msg: ServerMessage): void => {
      if (socket.readyState !== socket.OPEN) return;
      if (socket.bufferedAmount > this.maxBuffered) {
        socket.close(CLOSE.TOO_SLOW, 'too slow; reconnect and resume');
        return;
      }
      socket.send(JSON.stringify(msg));
    };

    const onEvent = (e: PublishedEvent): void => {
      if (!topics || !topicMatches(topics, e.topic)) return;
      if (backlog) backlog.push(e);
      else if (e.seq > replayedUpTo) send(e);
    };

    const helloTimer = setTimeout(() => socket.close(CLOSE.HELLO_TIMEOUT, 'hello expected'), this.helloTimeoutMs);
    let unsubscribe: (() => void) | null = null;
    let heartbeat: NodeJS.Timeout | null = null;

    socket.on('pong', () => {
      missedPongs = 0;
    });

    socket.on('message', (raw) => {
      if (topics) return; // only hello is understood; later messages are ignored
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText(raw));
      } catch {
        parsed = null;
      }
      const hello = helloSchema.safeParse(parsed);
      if (!hello.success) {
        send({ type: 'error', message: 'First message must be a valid hello.' });
        socket.close(CLOSE.BAD_HELLO, 'bad hello');
        return;
      }
      clearTimeout(helloTimer);
      topics = hello.data.topics;

      // Subscribe before reading the log, so an event committed during the replay is not missed.
      backlog = [];
      unsubscribe = this.bus.subscribe(onEvent);
      const lastSeq = this.lastSeq();
      const from = hello.data.resumeFrom;
      let replayed = 0;
      if (from !== null) {
        const oldest = (this.db.prepare('SELECT min(seq) FROM event_log').pluck().get() as number | null) ?? lastSeq + 1;
        if (from < oldest - 1) {
          send({ type: 'resync', lastSeq });
        } else {
          const rows = this.db
            .prepare('SELECT seq, topic, event, payload_json, at FROM event_log WHERE seq > ? AND seq <= ? ORDER BY seq')
            .all(from, lastSeq) as Array<{ seq: number; topic: string; event: string; payload_json: string; at: string }>;
          for (const r of rows) {
            if (!topicMatches(topics, r.topic)) continue;
            send({ seq: r.seq, topic: r.topic, event: r.event, at: r.at, data: JSON.parse(r.payload_json) as unknown });
            replayed++;
          }
        }
      }
      replayedUpTo = lastSeq;
      const held = backlog;
      backlog = null;
      send({ type: 'ready', lastSeq, replayed });
      for (const e of held) if (e.seq > replayedUpTo) send(e);

      heartbeat = setInterval(() => {
        if (missedPongs >= 2) {
          socket.terminate();
          return;
        }
        missedPongs++;
        socket.ping();
        send({ type: 'heartbeat', lastSeq: this.lastSeq(), at: this.now().toISOString() });
      }, this.heartbeatMs);
    });

    socket.on('close', () => {
      clearTimeout(helloTimer);
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
      this.clients.delete(socket);
    });
    socket.on('error', () => socket.terminate());
  }

  /** Closes every client (server shutdown); they reconnect and resume. */
  closeAll(): void {
    for (const s of this.clients) s.close(CLOSE.SHUTDOWN, 'server stopping');
  }
}
