// Print agents (P6-03, ADR-0005): a printer assigned to an agent is printed by that agent, not by this server. The
// print queue still owns every job (order, retries, backup printer, status, audit); for such a printer its transport is
// this broker, which hands the job to the agent when it next asks (a long poll over the LAN or through DinePOS Cloud)
// and resolves when the agent says it printed (or rejects with the agent's reason, so the queue retries as usual).
import type { PrinterTarget, PrintRequest, Transport } from '@dinepos/printing';

export interface AgentJob {
  jobId: string;
  printer: PrinterTarget;
  /** ESC/POS bytes, base64. */
  bytes: string;
}

interface Pending {
  job: AgentJob;
  sent: boolean;
  resolve: () => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export interface BrokerOptions {
  /** How long an agent may take to print one job. */
  jobTimeoutMs?: number;
  /** An agent not heard from for this long is offline (it asks at least every ~20 s). */
  offlineAfterMs?: number;
  now?: () => number;
}

export class AgentBroker {
  private readonly pending = new Map<string, Map<string, Pending>>();
  private readonly waiters = new Map<string, Array<() => void>>();
  private readonly seen = new Map<string, number>();
  private readonly jobTimeoutMs: number;
  private readonly offlineAfterMs: number;
  private readonly now: () => number;

  constructor(o: BrokerOptions = {}) {
    this.jobTimeoutMs = o.jobTimeoutMs ?? 30_000;
    this.offlineAfterMs = o.offlineAfterMs ?? 45_000;
    this.now = o.now ?? Date.now;
  }

  online(agentId: string): boolean {
    const t = this.seen.get(agentId);
    return t !== undefined && this.now() - t < this.offlineAfterMs;
  }

  lastSeen(agentId: string): number | null {
    return this.seen.get(agentId) ?? null;
  }

  /** The transport for a printer printed by this agent (its name for messages). */
  transport(agentId: string, agentName: string): Transport {
    return {
      send: (req) => this.dispatch(agentId, agentName, req),
      probe: () => (this.online(agentId) ? Promise.resolve() : Promise.reject(new Error(offline(agentName)))),
    };
  }

  private dispatch(agentId: string, agentName: string, req: PrintRequest): Promise<void> {
    if (!this.online(agentId)) return Promise.reject(new Error(offline(agentName)));
    const jobs = this.pending.get(agentId) ?? new Map<string, Pending>();
    this.pending.set(agentId, jobs);
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        jobs.delete(req.jobId);
        reject(new Error(`The print agent "${agentName}" did not print in time. Check that PC and the printer.`));
      }, this.jobTimeoutMs);
      jobs.set(req.jobId, { job: { jobId: req.jobId, printer: req.printer, bytes: Buffer.from(req.bytes).toString('base64') }, sent: false, resolve, reject, timer });
      for (const w of this.waiters.get(agentId)?.splice(0) ?? []) w();
    });
  }

  /** The agent asks for work: jobs not yet handed over, at once, or the first that comes within `waitMs`. */
  async poll(agentId: string, waitMs: number): Promise<AgentJob[]> {
    this.seen.set(agentId, this.now());
    const take = () => {
      const out: AgentJob[] = [];
      for (const p of this.pending.get(agentId)?.values() ?? []) {
        if (p.sent) continue;
        p.sent = true;
        out.push(p.job);
      }
      return out;
    };
    let jobs = take();
    if (jobs.length || waitMs <= 0) return jobs;
    await new Promise<void>((resolve) => {
      const t = setTimeout(done, waitMs);
      function done() {
        clearTimeout(t);
        resolve();
      }
      const list = this.waiters.get(agentId) ?? [];
      list.push(done);
      this.waiters.set(agentId, list);
    });
    this.seen.set(agentId, this.now());
    jobs = take();
    return jobs;
  }

  /** The agent's answer for one job it was given. */
  result(agentId: string, jobId: string, ok: boolean, error: string | null): boolean {
    const jobs = this.pending.get(agentId);
    const p = jobs?.get(jobId);
    if (!p || !p.sent) return false;
    jobs!.delete(jobId);
    clearTimeout(p.timer);
    this.seen.set(agentId, this.now());
    if (ok) p.resolve();
    else p.reject(new Error(error?.trim() ? error.trim().slice(0, 300) : 'The print agent could not print.'));
    return true;
  }

  /** Server stopping, or the agent removed: its waiting jobs fail (the queue retries or reroutes them). */
  drop(agentId: string, reason: string): void {
    for (const p of this.pending.get(agentId)?.values() ?? []) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.delete(agentId);
    for (const w of this.waiters.get(agentId)?.splice(0) ?? []) w();
    this.seen.delete(agentId);
  }

  close(): void {
    for (const id of [...this.pending.keys(), ...this.waiters.keys()]) this.drop(id, 'The server is stopping.');
  }
}

const offline = (name: string) => `The print agent "${name}" is offline. Check that its PC is on and connected.`;
