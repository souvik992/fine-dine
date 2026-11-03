// Command queue for one open order (no React). Commands run one at a time on the latest known version.
// docs/05: AddItems / FireKOT / SetCovers rebase silently on VERSION_CONFLICT; everything else is shown.
import { newId, type CommandSuccess, type OrderSnapshot } from '@dinepos/shared';
import { ApiError, type ApiClient } from '../client.js';

/** Commands that are safe to resend on the newer version without asking (docs/05-sync-offline.md). */
export const REBASE_SAFE = new Set(['AddItems', 'FireKOT', 'SetCovers', 'UpdateHeldItem', 'RemoveHeldItem']);

/**
 * How many times a safe command is rebased while other devices keep changing the order (two captains and a terminal
 * punching one table at once). A refused attempt changed nothing, so trying again cannot apply anything twice.
 */
export const MAX_REBASES = 5;

export interface SessionListener {
  (snapshot: OrderSnapshot, info: { external: boolean }): void;
}

/** A refused command because the order changed elsewhere (docs/05: "Table changed by <user>", ask). */
export interface ConflictInfo {
  /** The command that was not done, e.g. "PrintBill". */
  type: string;
  /** The server's sentence: who changed the table, how and when. */
  message: string;
  by: string | null;
  what: string | null;
}

export class OrderSession {
  private snapshot: OrderSnapshot | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<SessionListener>();
  private readonly conflictListeners = new Set<(c: ConflictInfo) => void>();
  /** Versions this terminal produced; anything newer came from another terminal. */
  private ownVersions = new Set<number>();
  /**
   * The version on screen when a decision started (a dialog opened: print bill, move, settle…). Commands that are not
   * safe to rebase go out on it, so a change made elsewhere meanwhile is refused and explained, not silently included.
   */
  private decisionBase: number | null = null;

  constructor(
    private readonly api: Pick<ApiClient, 'command' | 'get'>,
    readonly orderId: string,
  ) {}

  get current(): OrderSnapshot | null {
    return this.snapshot;
  }

  subscribe(l: SessionListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** A dialog opened on this version; null when it closed. */
  holdDecision(version: number | null): void {
    this.decisionBase = version;
  }

  /** Called when a command that must not be resent blindly meets a newer version of the order. */
  onConflict(l: (c: ConflictInfo) => void): () => void {
    this.conflictListeners.add(l);
    return () => this.conflictListeners.delete(l);
  }

  /** Accepts a snapshot from a GET or a stream-triggered refetch; ignores anything older than what we have. */
  receive(s: OrderSnapshot): void {
    if (this.snapshot && s.version < this.snapshot.version) return;
    if (this.snapshot && s.version === this.snapshot.version) return;
    const external = this.snapshot !== null && !this.ownVersions.has(s.version);
    this.snapshot = s;
    for (const l of this.listeners) l(s, { external });
  }

  async refresh(): Promise<OrderSnapshot> {
    const s = await this.api.get<OrderSnapshot>(`/v1/orders/${this.orderId}`);
    this.receive(s);
    return this.snapshot!;
  }

  /**
   * Queues a command. It runs after every earlier one, on the version they produced. One commandId per call,
   * reused for network retries and for a silent rebase, so nothing is ever applied twice.
   */
  run<R = unknown>(type: string, payload: unknown): Promise<CommandSuccess<R>> {
    const commandId = newId();
    const job = this.chain.then(async () => {
      if (!this.snapshot) await this.refresh();
      const send = (expectedVersion: number) => this.api.command<R>(type, payload, { orderId: this.orderId, expectedVersion, commandId });
      let res: CommandSuccess<R> | undefined;
      let base = !REBASE_SAFE.has(type) && this.decisionBase !== null ? this.decisionBase : this.snapshot!.version;
      for (let rebases = 0; !res; rebases++) {
        try {
          res = await send(base);
        } catch (err) {
          if (err instanceof ApiError && err.code === 'VERSION_CONFLICT' && !REBASE_SAFE.has(type)) this.conflict(type, err);
          if (!(err instanceof ApiError) || err.code !== 'VERSION_CONFLICT' || !REBASE_SAFE.has(type) || !err.order || rebases >= MAX_REBASES) throw this.absorb(err);
          this.receive(err.order); // someone else changed it: show that, then rebase
          base = err.order.version;
        }
      }
      if (res.order) {
        this.ownVersions.add(res.order.version);
        this.receive(res.order);
      }
      return res;
    });
    this.chain = job.catch(() => undefined);
    return job;
  }

  /**
   * Queues a command decided when it is its turn, from the latest snapshot (e.g. "raise the held line" vs "add a
   * line"), so quick repeated taps build on each other. On a version conflict the command is decided again on the
   * newer snapshot (up to MAX_REBASES times) and sent with a new commandId (the earlier one was refused, so nothing can
   * apply twice). Only for
   * cart commands that are safe to decide again (REBASE_SAFE). Resolves to null when there is nothing to do.
   */
  runLatest<R = unknown>(build: (s: OrderSnapshot) => { type: string; payload: unknown } | null): Promise<CommandSuccess<R> | null> {
    const job = this.chain.then(async () => {
      if (!this.snapshot) await this.refresh();
      const attempt = async (s: OrderSnapshot) => {
        const cmd = build(s);
        return cmd ? { cmd, res: await this.api.command<R>(cmd.type, cmd.payload, { orderId: this.orderId, expectedVersion: s.version, commandId: newId() }) } : null;
      };
      let done: Awaited<ReturnType<typeof attempt>> | undefined;
      let latest = this.snapshot!;
      for (let rebases = 0; done === undefined; rebases++) {
        try {
          done = await attempt(latest);
        } catch (err) {
          if (!(err instanceof ApiError) || err.code !== 'VERSION_CONFLICT' || !err.order || rebases >= MAX_REBASES) throw this.absorb(err);
          this.receive(err.order); // someone else changed it: show that, then decide again
          latest = err.order;
        }
      }
      if (!done) return null;
      if (done.res.order) {
        this.ownVersions.add(done.res.order.version);
        this.receive(done.res.order);
      }
      return done.res;
    });
    this.chain = job.catch(() => undefined);
    return job;
  }

  private conflict(type: string, err: ApiError): void {
    const change = (err.details as { lastChange?: { by: string | null; what: string } | null } | undefined)?.lastChange ?? null;
    const info: ConflictInfo = { type, message: err.message, by: change?.by ?? null, what: change?.what ?? null };
    // The person is told now; trying again in the same dialog decides on what they now see.
    if (this.decisionBase !== null && err.order) this.decisionBase = err.order.version;
    for (const l of this.conflictListeners) l(info);
  }

  /** Keeps the newer snapshot that comes with a conflict, so the screen shows what changed. */
  private absorb(err: unknown): unknown {
    if (err instanceof ApiError && err.order) this.receive(err.order);
    return err;
  }
}
