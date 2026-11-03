// Live events from GET /v1/stream (docs/04-realtime-events.md): hello with resumeFrom, replay, heartbeat,
// reconnect with backoff. Events are triggers to refetch; money always comes from the GET snapshots.

export interface StreamEvent {
  seq: number;
  topic: string;
  event: string;
  at: string;
  data: unknown;
}

export type StreamStatus = 'connecting' | 'live' | 'offline';

/** The subset of the browser WebSocket the client uses (injectable for tests). */
export interface SocketLike {
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number): void;
}

export interface StreamOptions {
  url: string;
  topics: string[];
  /** P2-02: sent in the hello; the server refuses an unknown device (close 4401) and cuts a revoked one (4403). */
  deviceToken?: () => string | null;
  onUnpaired?: () => void;
  onEvent: (e: StreamEvent) => void;
  /** Called when replay is impossible (server pruned the events): refetch everything. */
  onResync: () => void;
  onStatus?: (s: StreamStatus) => void;
  createSocket?: (url: string) => SocketLike;
  /** Offline when no message (event or heartbeat) arrives for this long: 2 × the 15 s server heartbeat + slack. */
  silenceMs?: number;
  backoffMs?: number[];
}

export class StreamClient {
  private socket: SocketLike | null = null;
  private lastSeq: number | null = null;
  private attempt = 0;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private status: StreamStatus = 'connecting';
  private readonly silenceMs: number;
  private readonly backoff: number[];

  constructor(private readonly opts: StreamOptions) {
    this.silenceMs = opts.silenceMs ?? 35_000;
    this.backoff = opts.backoffMs ?? [500, 1_000, 2_000, 5_000, 10_000];
  }

  /** Highest event seq seen; sent as resumeFrom on reconnect. */
  get resumeFrom(): number | null {
    return this.lastSeq;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const s = this.socket;
    this.socket = null;
    s?.close(1000);
  }

  private setStatus(s: StreamStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.opts.onStatus?.(s);
  }

  private connect(): void {
    if (this.stopped) return;
    this.setStatus(this.attempt === 0 ? 'connecting' : 'offline');
    const make = this.opts.createSocket ?? ((u: string) => new WebSocket(u) as unknown as SocketLike);
    const s = make(this.opts.url);
    this.socket = s;
    s.onopen = () => {
      const deviceToken = this.opts.deviceToken?.();
      s.send(JSON.stringify({ type: 'hello', ...(deviceToken ? { deviceToken } : {}), resumeFrom: this.lastSeq, topics: this.opts.topics }));
      this.armSilence();
    };
    s.onmessage = (ev) => this.onMessage(ev.data);
    s.onerror = () => undefined; // onclose follows
    s.onclose = (ev) => {
      if (ev.code === 4401 || ev.code === 4403) this.opts.onUnpaired?.();
      if (this.socket !== s) return;
      this.socket = null;
      this.clearTimers();
      if (this.stopped) return;
      this.setStatus('offline');
      const delay = this.backoff[Math.min(this.attempt, this.backoff.length - 1)]!;
      this.attempt++;
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
  }

  private onMessage(raw: unknown): void {
    this.armSilence();
    let msg: { type?: string; seq?: number; lastSeq?: number } & Partial<StreamEvent>;
    try {
      msg = JSON.parse(String(raw)) as typeof msg;
    } catch {
      return;
    }
    switch (msg.type) {
      case 'ready':
        this.attempt = 0;
        if (this.lastSeq === null && typeof msg.lastSeq === 'number') this.lastSeq = msg.lastSeq;
        this.setStatus('live');
        return;
      case 'resync':
        this.attempt = 0;
        this.lastSeq = typeof msg.lastSeq === 'number' ? msg.lastSeq : null;
        this.setStatus('live');
        this.opts.onResync();
        return;
      case 'heartbeat':
      case 'error':
        return;
      case undefined:
        if (typeof msg.seq !== 'number' || (this.lastSeq !== null && msg.seq <= this.lastSeq)) return; // duplicate
        this.lastSeq = msg.seq;
        this.opts.onEvent(msg as StreamEvent);
        return;
      default:
        return;
    }
  }

  private armSilence(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      // Server or network went quiet: drop the socket; onclose reconnects and resumes.
      this.setStatus('offline');
      this.socket?.close(4000);
    }, this.silenceMs);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.reconnectTimer = null;
    this.silenceTimer = null;
  }
}

export function streamUrl(serverUrl: string): string {
  return `${serverUrl.replace(/^http/, 'ws')}/v1/stream`;
}
