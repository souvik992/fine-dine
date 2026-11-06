// The outlet server under the DinePOS Server window (`DinePOS.exe --server`): starts it (the bundled node.exe +
// server.mjs, exactly as the old console shortcut did), keeps its last log lines, restarts it if it stops by itself,
// and reads its state from its own API on loopback (where this PC is the trusted master). Free of Electron so it can be
// tested; server-mode.ts puts it in a window and the tray.
import { spawn, type ChildProcess } from 'node:child_process';
import { networkInterfaces } from 'node:os';

export interface ServerCommand {
  node: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Where the server listens (for its API and the addresses shown). */
  port: number;
  dataDir: string;
}

export type ServerPhase = 'starting' | 'running' | 'stopping' | 'stopped' | 'crashed' | 'external';

export interface LogLine {
  at: string;
  level: 'info' | 'warn' | 'error';
  text: string;
}

export interface ServerSnapshot {
  phase: ServerPhase;
  pid: number | null;
  restarts: number;
  lastExit: string | null;
  port: number;
  dataDir: string;
  addresses: string[];
  health: Record<string, unknown> | null;
  devices: Array<{ id: string; name: string; kind: string; lastSeenAt: string | null; master?: boolean; revokedAt?: string | null }>;
  pendingPairings: number;
  printers: Array<{ id: string; name: string; status: string; lastError?: string; agent?: { name: string } }>;
  cloud: { enabled: boolean; paired: boolean; connection: string; deviceUrl: string | null } | null;
  checkedAt: string | null;
}

/** IPv4 addresses on this PC's networks (what phones and other terminals use). */
export function lanAddresses(ifaces: ReturnType<typeof networkInterfaces> = networkInterfaces()): string[] {
  const out: string[] = [];
  for (const list of Object.values(ifaces)) for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')) out.push(i.address);
  return [...new Set(out)];
}

/** A server log line (JSON from the server's logger, or plain text) for the window. */
export function parseLogLine(raw: string): LogLine | null {
  const text = raw.trimEnd();
  if (!text.trim()) return null;
  try {
    const j = JSON.parse(text) as { level?: number; msg?: string; time?: number; err?: { message?: string }; res?: { statusCode?: number }; [k: string]: unknown };
    if (typeof j.msg === 'string') {
      // each request is noise here (the window itself asks every few seconds); server errors still show
      if (j.msg === 'incoming request') return null;
      if (j.msg === 'request completed' && (j.res?.statusCode ?? 0) < 500) return null;
      const level = (j.level ?? 30) >= 50 ? 'error' : (j.level ?? 30) >= 40 ? 'warn' : 'info';
      const extra = j.err?.message ? `: ${j.err.message}` : '';
      return { at: new Date(typeof j.time === 'number' ? j.time : Date.now()).toISOString(), level, text: `${j.msg}${extra}` };
    }
  } catch {
    // plain text (the start-up banner)
  }
  // the start-up banner's console advice does not apply to this window (Stop and Quit do it)
  if (/Ctrl\+C/.test(text)) return null;
  return { at: new Date().toISOString(), level: /error|failed|refused/i.test(text) ? 'error' : 'info', text };
}

export interface SupervisorOptions {
  command: ServerCommand;
  fetch?: typeof fetch;
  /** Waits before restarting a server that stopped by itself (the last one repeats). */
  restartMs?: number[];
  maxLines?: number;
  onChange?: () => void;
}

export class ServerSupervisor {
  private readonly o: Required<Omit<SupervisorOptions, 'onChange'>> & Pick<SupervisorOptions, 'onChange'>;
  private child: ChildProcess | null = null;
  private phase: ServerPhase = 'stopped';
  private restarts = 0;
  private lastExit: string | null = null;
  private wanted = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly lines: LogLine[] = [];
  private state: Omit<ServerSnapshot, 'phase' | 'pid' | 'restarts' | 'lastExit' | 'port' | 'dataDir' | 'addresses'> = { health: null, devices: [], pendingPairings: 0, printers: [], cloud: null, checkedAt: null };

  constructor(o: SupervisorOptions) {
    this.o = { fetch: (i, init) => fetch(i, init), restartMs: [1000, 3000, 10_000, 30_000], maxLines: 500, ...o };
  }

  private get base(): string {
    return `http://127.0.0.1:${this.o.command.port}`;
  }

  log(): LogLine[] {
    return [...this.lines];
  }

  snapshot(): ServerSnapshot {
    return {
      phase: this.phase,
      pid: this.child?.pid ?? null,
      restarts: this.restarts,
      lastExit: this.lastExit,
      port: this.o.command.port,
      dataDir: this.o.command.dataDir,
      addresses: lanAddresses(),
      ...this.state,
    };
  }

  private add(line: LogLine | null): void {
    if (!line) return;
    this.lines.push(line);
    if (this.lines.length > this.o.maxLines) this.lines.splice(0, this.lines.length - this.o.maxLines);
    this.o.onChange?.();
  }

  private set(phase: ServerPhase): void {
    this.phase = phase;
    this.o.onChange?.();
  }

  /** Starts the server, unless one already answers on its port (then it is shown, not controlled). */
  async start(): Promise<void> {
    this.wanted = true;
    if (this.child) return;
    if (await this.answers()) {
      this.set('external');
      this.add({ at: new Date().toISOString(), level: 'warn', text: `A DinePOS server is already running on port ${this.o.command.port} (not started from this window). It is shown here but cannot be stopped from here.` });
      return;
    }
    this.spawnServer();
  }

  private spawnServer(): void {
    const c = this.o.command;
    this.set('starting');
    const child = spawn(c.node, c.args, { cwd: c.cwd, env: c.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    let buf = '';
    const onData = (d: Buffer) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        this.add(parseLogLine(buf.slice(0, i)));
        buf = buf.slice(i + 1);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (e) => this.add({ at: new Date().toISOString(), level: 'error', text: `The server could not start: ${e.message}` }));
    child.on('exit', (code, signal) => {
      this.child = null;
      const by = signal ?? `exit code ${code}`;
      if (!this.wanted) {
        this.lastExit = null;
        this.set('stopped');
        this.add({ at: new Date().toISOString(), level: 'info', text: 'The server was stopped.' });
        return;
      }
      this.lastExit = by;
      this.restarts++;
      this.set('crashed');
      const wait = this.o.restartMs[Math.min(this.restarts - 1, this.o.restartMs.length - 1)]!;
      this.add({ at: new Date().toISOString(), level: 'error', text: `The server stopped (${by}). Starting it again in ${Math.round(wait / 1000)} s.` });
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.wanted && !this.child) this.spawnServer();
      }, wait);
    });
  }

  /** Stops the server (terminals stop working until it starts again). */
  async stop(): Promise<void> {
    this.wanted = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const child = this.child;
    if (!child) {
      if (this.phase !== 'external') this.set('stopped');
      return;
    }
    this.set('stopping');
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        child.kill('SIGKILL');
      }, 8000);
      child.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
      // SQLite runs in WAL mode with synchronous=FULL: a stop never loses a committed bill
      child.kill();
    });
  }

  async restart(): Promise<void> {
    await this.stop();
    this.restarts = 0;
    await this.start();
  }

  private async answers(): Promise<boolean> {
    try {
      const r = await this.o.fetch(`${this.base}/v1/health`, { signal: AbortSignal.timeout(1500) });
      return r.status > 0;
    } catch {
      return false;
    }
  }

  private async get<T>(path: string): Promise<T | null> {
    try {
      const r = await this.o.fetch(`${this.base}${path}`, { signal: AbortSignal.timeout(3000) });
      return r.ok || r.status === 503 ? ((await r.json()) as T) : null;
    } catch {
      return null;
    }
  }

  /** Reads the server's state (every few seconds while the window is open). */
  async poll(): Promise<void> {
    const health = await this.get<Record<string, unknown>>('/v1/health');
    if (health) {
      if (this.phase === 'starting' || this.phase === 'crashed') this.set('running');
      const [devices, printers, cloud] = await Promise.all([
        this.get<{ devices: ServerSnapshot['devices']; pending?: unknown[] }>('/v1/devices'),
        this.get<{ printers: ServerSnapshot['printers'] }>('/v1/printers'),
        this.get<NonNullable<ServerSnapshot['cloud']>>('/v1/cloud'),
      ]);
      this.state = {
        health,
        devices: devices?.devices ?? [],
        pendingPairings: devices?.pending?.length ?? 0,
        printers: printers?.printers ?? [],
        cloud: cloud ?? null,
        checkedAt: new Date().toISOString(),
      };
    } else {
      this.state = { ...this.state, health: null, checkedAt: new Date().toISOString() };
      if (this.phase === 'external') this.set('stopped');
    }
    this.o.onChange?.();
  }
}
