// DinePOS Print Agent (P6-03, ADR-0005): runs on a PC on the printers' network and prints the tickets of the printers
// assigned to it, for an outlet server that cannot reach them (in the cloud, or on another network). It only connects
// out: it asks the server for work (a long poll, over the LAN or through DinePOS Cloud) and reports each result. The
// server's print queue keeps every job, its retries and the printer status; the agent never stores a ticket.
import type { PrinterTarget, Transport } from '@dinepos/printing';

export interface AgentJob {
  jobId: string;
  printer: PrinterTarget;
  bytes: string;
}

export interface AgentState {
  connection: 'starting' | 'connected' | 'retrying' | 'refused';
  agentName: string | null;
  printers: Array<{ id: string; name: string }>;
  lastError: string | null;
  printed: number;
  failed: number;
}

export interface AgentOptions {
  serverUrl: string;
  key: string;
  version: string;
  transports: Partial<Record<PrinterTarget['transport'], Transport>>;
  fetch?: typeof fetch;
  /** Long-poll wait asked of the server (ms). */
  waitMs?: number;
  retryMs?: number[];
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

/** "http://192.168.1.20:7420", "https://spice-garden.cloud.example" (no path); null when it is not one. */
export function normalizeServer(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
  } catch {
    return null;
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname || u.username || u.password) return null;
  const port = u.port || (u.protocol === 'http:' && !/:\d+/.test(raw.replace(/^[a-z]+:\/\//i, '')) ? '7420' : '');
  return `${u.protocol}//${u.hostname}${port ? `:${port}` : ''}`;
}

export class PrintAgent {
  readonly state: AgentState = { connection: 'starting', agentName: null, printers: [], lastError: null, printed: 0, failed: 0 };
  private readonly o: Required<Omit<AgentOptions, 'log'>> & Pick<AgentOptions, 'log'>;

  constructor(o: AgentOptions) {
    this.o = { fetch: (i, init) => fetch(i, init), waitMs: 20_000, retryMs: [1000, 2000, 5000, 10_000, 30_000], ...o };
  }

  private headers(): Record<string, string> {
    return { authorization: `Agent ${this.o.key}`, 'x-agent-version': this.o.version };
  }

  /** One ask: the agent's name, its printers and any waiting jobs (no wait: a setup check). */
  async ask(waitMs: number, signal?: AbortSignal): Promise<{ agent: { id: string; name: string }; printers: Array<{ id: string; name: string }>; jobs: AgentJob[] }> {
    const timeout = AbortSignal.timeout(waitMs + 10_000);
    const r = await this.o.fetch(`${this.o.serverUrl}/v1/print-agent/jobs?wait=${waitMs}`, { headers: this.headers(), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    const body = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
    if (r.status === 401) throw new RefusedError(body?.error?.message ?? 'This print agent key is not valid.');
    if (!r.ok) throw new Error(body?.error?.message ?? `the server answered ${r.status}`);
    return body as Awaited<ReturnType<PrintAgent['ask']>>;
  }

  /** Runs until `signal` aborts: asks for work, prints it, says how it went; reconnects with growing waits. */
  async run(signal: AbortSignal): Promise<void> {
    let attempt = 0;
    while (!signal.aborted) {
      try {
        const res = await this.ask(this.o.waitMs, signal);
        if (this.state.connection !== 'connected') this.o.log?.('info', `connected to ${this.o.serverUrl} as "${res.agent.name}" (${res.printers.map((p) => p.name).join(', ') || 'no printers assigned yet'})`);
        Object.assign(this.state, { connection: 'connected', agentName: res.agent.name, printers: res.printers, lastError: null });
        attempt = 0;
        for (const job of res.jobs) void this.print(job);
        continue;
      } catch (e) {
        if (signal.aborted) break;
        const refused = e instanceof RefusedError;
        const msg = e instanceof Error ? (e.name === 'TimeoutError' ? 'the server did not answer in time' : e.message) : String(e);
        if (this.state.lastError !== msg) this.o.log?.(refused ? 'error' : 'warn', msg);
        Object.assign(this.state, { connection: refused ? 'refused' : 'retrying', lastError: msg });
        // a removed or mistyped key: wait longer (an owner fixes it), but keep trying
        const wait = refused ? 60_000 : this.o.retryMs[Math.min(attempt++, this.o.retryMs.length - 1)]!;
        await sleep(wait, signal);
      }
    }
  }

  /** Prints one job with the printer's own way (network or Windows printer) and tells the server. */
  async print(job: AgentJob): Promise<void> {
    const transport = this.o.transports[job.printer.transport];
    let error: string | null = null;
    try {
      if (!transport) throw new Error(`This print agent cannot print to "${job.printer.transport}" printers.`);
      await transport.send({ printer: job.printer, jobId: job.jobId, bytes: Buffer.from(job.bytes, 'base64') });
      this.state.printed++;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      this.state.failed++;
      this.o.log?.('warn', `${job.printer.name}: ${error}`);
    }
    try {
      await this.o.fetch(`${this.o.serverUrl}/v1/print-agent/jobs/${encodeURIComponent(job.jobId)}`, {
        method: 'POST',
        headers: { ...this.headers(), 'content-type': 'application/json' },
        body: JSON.stringify({ ok: error === null, error }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      // the server times the job out and sends it again: a ticket may print twice, never not at all
      this.o.log?.('warn', `could not report job ${job.jobId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

export class RefusedError extends Error {}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}
