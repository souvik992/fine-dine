// Command queue for one open order (no React). Commands run one at a time on the latest known version.
// docs/05: AddItems / FireKOT / SetCovers rebase silently on VERSION_CONFLICT; everything else is shown.
import { newId, type CommandSuccess, type OrderSnapshot } from '@dinepos/shared';
import { ApiError, type ApiClient } from '../api/client.js';

/** Commands that are safe to resend on the newer version without asking (docs/05-sync-offline.md). */
export const REBASE_SAFE = new Set(['AddItems', 'FireKOT', 'SetCovers', 'UpdateHeldItem', 'RemoveHeldItem']);

export interface SessionListener {
  (snapshot: OrderSnapshot, info: { external: boolean }): void;
}

export class OrderSession {
  private snapshot: OrderSnapshot | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<SessionListener>();
  /** Versions this terminal produced; anything newer came from another terminal. */
  private ownVersions = new Set<number>();

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
      let res: CommandSuccess<R>;
      try {
        res = await send(this.snapshot!.version);
      } catch (err) {
        if (!(err instanceof ApiError) || err.code !== 'VERSION_CONFLICT' || !REBASE_SAFE.has(type) || !err.order) throw this.absorb(err);
        this.receive(err.order); // someone else changed it: show that, then rebase once
        res = await send(err.order.version).catch((e: unknown) => {
          throw this.absorb(e);
        });
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

  /** Keeps the newer snapshot that comes with a conflict, so the screen shows what changed. */
  private absorb(err: unknown): unknown {
    if (err instanceof ApiError && err.order) this.receive(err.order);
    return err;
  }
}
