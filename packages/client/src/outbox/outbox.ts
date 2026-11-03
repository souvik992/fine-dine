// Offline outbox (docs/05 "Client offline outbox"): every order change from the phone is stored first, then sent
// in order. Online it goes out at once; offline it waits and is replayed when the outlet server is back.
import type { CommandSuccess, OrderSnapshot } from '@dinepos/shared';
import { ApiError, type ApiClient } from '../client.js';
import { MAX_REBASES } from '../order/order-session.js';
import { MAX_LINE_QTY } from '../order/order-lines.js';

/** Allowed in the outbox (docs/05: everything else needs the server and is disabled offline). */
export type OutboxCommand = 'OpenTable' | 'AddItems' | 'UpdateHeldItem' | 'RemoveHeldItem' | 'FireKOT' | 'SetCovers' | 'RequestBill';

export interface OutboxEntry {
  /** Order of creation; replay is strictly in this order. */
  seq: number;
  /** Kept for every resend: a command whose answer was lost is answered DUPLICATE, never applied twice. */
  commandId: string;
  type: OutboxCommand;
  orderId: string;
  /** The order version this change was decided on (none for OpenTable). */
  expectedVersion?: number;
  payload: Record<string, unknown>;
  /** UpdateHeldItem qty: the line's quantity when decided, so a rebase applies the same difference. */
  qtyFrom?: number;
  table: { id: string; label: string; areaId: string | null };
  /** What the captain did, for the Needs attention list ("Add 2 × Dal Makhani"). */
  label: string;
  /** Who made it: the command is sent with their session. */
  by: { userId: string; name: string; token: string | null };
  queuedAt: string;
  /** Waited for the network at least once: if the server refuses it, it goes to Needs attention (not a toast). */
  offline: boolean;
  status: 'queued' | 'attention';
  problem?: { code: string; message: string };
}

export type NewEntry = Omit<OutboxEntry, 'seq' | 'status' | 'problem' | 'offline'> & { offline?: boolean };

export interface OutboxStore {
  load(): Promise<OutboxEntry[]>;
  put(e: OutboxEntry): Promise<void>;
  remove(seqs: readonly number[]): Promise<void>;
}

export class MemoryOutboxStore implements OutboxStore {
  rows = new Map<number, OutboxEntry>();
  load() {
    return Promise.resolve([...this.rows.values()].map((e) => structuredClone(e)));
  }
  put(e: OutboxEntry) {
    this.rows.set(e.seq, structuredClone(e));
    return Promise.resolve();
  }
  remove(seqs: readonly number[]) {
    for (const s of seqs) this.rows.delete(s);
    return Promise.resolve();
  }
}

export interface OutboxEvents {
  /** Sent and accepted (or answered DUPLICATE): keep the newer order snapshot. */
  onSent?(e: OutboxEntry, res: CommandSuccess): void;
  /** A newer snapshot arrived with a conflict. */
  onSnapshot?(order: OrderSnapshot): void;
  /** Refused while the captain was online and looking: show it now. `dropped` are the changes that depended on it. */
  onRejected?(e: OutboxEntry, err: ApiError, dropped: OutboxEntry[]): void;
  /** Not needed any more (another device already did it), e.g. the dish was already sent to the kitchen. */
  onSkipped?(e: OutboxEntry, reason: string): void;
  onUnpaired?(): void;
}

export type ReplayResult = 'done' | 'offline';

export const seatLabel = (table: string, covers: number) => `Seat ${table} (${covers} guest${covers === 1 ? '' : 's'})`;

/** Line ids an entry creates (AddItems) — later changes to those lines depend on it. */
function createdLines(e: OutboxEntry): string[] {
  return e.type === 'AddItems' ? (e.payload.items as Array<{ id: string }>).map((i) => i.id) : [];
}

/**
 * Drops `dropped` and every later change that cannot happen without it: everything for an order whose OpenTable is
 * dropped; changes and fires of lines it would have added (a fire keeps its other lines).
 */
export function withoutDependents(entries: readonly OutboxEntry[], dropped: OutboxEntry): { keep: OutboxEntry[]; changed: OutboxEntry[]; dropped: OutboxEntry[] } {
  const gone = new Set(createdLines(dropped));
  const keep: OutboxEntry[] = [];
  const changed: OutboxEntry[] = [];
  const out: OutboxEntry[] = [dropped];
  for (const e of entries) {
    if (e.seq === dropped.seq) continue;
    const later = e.seq > dropped.seq && e.orderId === dropped.orderId;
    if (later && dropped.type === 'OpenTable') {
      out.push(e);
      continue;
    }
    if (later && (e.type === 'UpdateHeldItem' || e.type === 'RemoveHeldItem') && gone.has(e.payload.orderItemId as string)) {
      out.push(e);
      continue;
    }
    if (later && e.type === 'FireKOT' && Array.isArray(e.payload.itemIds)) {
      const ids = (e.payload.itemIds as string[]).filter((id) => !gone.has(id));
      if (ids.length === 0) {
        out.push(e);
        continue;
      }
      if (ids.length !== (e.payload.itemIds as string[]).length) {
        const next = { ...e, payload: { itemIds: ids } };
        keep.push(next);
        changed.push(next);
        continue;
      }
    }
    keep.push(e);
  }
  return { keep, changed, dropped: out };
}

/**
 * The same change, decided again on a newer order (another device changed it meanwhile). `drop` when it no longer
 * makes sense: the line is gone, or everything it would send was already sent.
 */
export function rebaseEntry(e: OutboxEntry, order: OrderSnapshot): { entry: OutboxEntry } | { drop: string } {
  const next: OutboxEntry = { ...e, expectedVersion: order.version };
  const line = (id: unknown) => order.items.find((i) => i.id === id);
  if (e.type === 'UpdateHeldItem') {
    const l = line(e.payload.orderItemId);
    if (!l) return { drop: 'That dish was removed on another device.' };
    if (l.status === 'held' && typeof e.payload.qty === 'number' && e.qtyFrom !== undefined) {
      const qty = Math.min(MAX_LINE_QTY, l.qty + (e.payload.qty - e.qtyFrom));
      if (qty < 1) return { entry: { ...next, type: 'RemoveHeldItem', payload: { orderItemId: l.id }, qtyFrom: undefined } };
      return { entry: { ...next, payload: { ...e.payload, qty }, qtyFrom: l.qty } };
    }
  }
  if (e.type === 'RemoveHeldItem' && !line(e.payload.orderItemId)) return { drop: 'That dish was already removed on another device.' };
  if (e.type === 'FireKOT' && Array.isArray(e.payload.itemIds)) {
    const ids = (e.payload.itemIds as string[]).filter((id) => line(id)?.status === 'held');
    if (ids.length === 0) return { drop: 'Already sent to the kitchen from another device.' };
    return { entry: { ...next, payload: { itemIds: ids } } };
  }
  return { entry: next };
}

/**
 * The outbox: durable (the store), strictly ordered, one replay at a time. A change refused after waiting offline
 * goes to Needs attention, and later changes to that order wait behind it until the captain retries or discards it.
 */
export class Outbox {
  private entries: OutboxEntry[] = [];
  private nextSeq = 1;
  private running: Promise<ReplayResult> | null = null;
  private again = false;
  private readonly listeners = new Set<(entries: readonly OutboxEntry[]) => void>();

  constructor(
    private readonly store: OutboxStore,
    private readonly api: Pick<ApiClient, 'command'>,
    private readonly events: OutboxEvents = {},
  ) {}

  async init(): Promise<void> {
    this.entries = (await this.store.load()).sort((a, b) => a.seq - b.seq);
    this.nextSeq = Math.max(0, ...this.entries.map((e) => e.seq)) + 1;
    this.notify();
  }

  list(): readonly OutboxEntry[] {
    return this.entries;
  }

  subscribe(l: (entries: readonly OutboxEntry[]) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  async enqueue(e: NewEntry): Promise<OutboxEntry> {
    const entry: OutboxEntry = { ...e, seq: this.nextSeq++, status: 'queued', offline: e.offline ?? false };
    await this.store.put(entry);
    this.entries = [...this.entries, entry];
    this.notify();
    return entry;
  }

  /** Try a Needs attention change again, as the captain signed in now when given. */
  async retry(seq: number, by?: OutboxEntry['by']): Promise<void> {
    const e = this.entries.find((x) => x.seq === seq);
    if (!e) return;
    await this.save({ ...e, status: 'queued', problem: undefined, ...(by ? { by } : {}) });
  }

  /** Seat a refused offline OpenTable at another table; the order keeps its id, so its dishes follow. */
  async reseat(seq: number, table: OutboxEntry['table']): Promise<void> {
    const e = this.entries.find((x) => x.seq === seq);
    if (!e || e.type !== 'OpenTable') return;
    for (const x of this.entries.filter((y) => y.orderId === e.orderId)) {
      await this.save(x.seq === seq ? { ...x, table, payload: { ...x.payload, tableId: table.id }, label: seatLabel(table.label, x.payload.covers as number), status: 'queued', problem: undefined } : { ...x, table });
    }
  }

  /** Give up a change (and the changes that need it). */
  async discard(seq: number): Promise<OutboxEntry[]> {
    const e = this.entries.find((x) => x.seq === seq);
    if (!e) return [];
    return this.dropWith(e);
  }

  /**
   * Sends everything that can go, in order. Stops at the first network failure (still offline). Safe to call
   * often: a call while a replay runs makes that replay look again before it finishes.
   */
  replay(): Promise<ReplayResult> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        for (;;) {
          this.again = false;
          const result = await this.drain();
          if (result === 'offline' || !this.again) return result;
        }
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async drain(): Promise<ReplayResult> {
    for (;;) {
      const blocked = new Set<string>();
      let next: OutboxEntry | undefined;
      for (const e of this.entries) {
        if (e.status === 'attention') blocked.add(e.orderId);
        else if (!blocked.has(e.orderId)) {
          next = e;
          break;
        }
      }
      if (!next) return 'done';
      if ((await this.sendOne(next)) === 'offline') return 'offline';
    }
  }

  private async sendOne(first: OutboxEntry): Promise<'ok' | 'offline'> {
    let e = first;
    for (let rebases = 0; ; rebases++) {
      try {
        const res = await this.api.command(e.type, e.payload, {
          ...(e.type === 'OpenTable' ? {} : { orderId: e.orderId, expectedVersion: e.expectedVersion }),
          commandId: e.commandId,
          attempts: 1,
          sessionToken: e.by.token,
        });
        this.events.onSent?.(e, res); // the newer snapshot first, so the screen never shows the change missing
        await this.removeAll([e]);
        return 'ok';
      } catch (raw) {
        const err = raw instanceof ApiError ? raw : new ApiError('INTERNAL', raw instanceof Error ? raw.message : 'Unexpected error.');
        if (err.code === 'NETWORK') {
          for (const x of this.entries) if (x.status === 'queued' && !x.offline) await this.save({ ...x, offline: true }, false);
          this.notify();
          return 'offline';
        }
        if (err.code === 'UNAUTHENTICATED' && (err.details as { reason?: string } | undefined)?.reason === 'device_not_paired') {
          this.events.onUnpaired?.();
          return 'offline';
        }
        if (err.code === 'VERSION_CONFLICT' && err.order && rebases < MAX_REBASES) {
          this.events.onSnapshot?.(err.order);
          const r = rebaseEntry(e, err.order);
          if ('drop' in r) {
            await this.removeAll([e]);
            this.events.onSkipped?.(e, r.drop);
            return 'ok';
          }
          e = r.entry;
          await this.save(e); // stored before it is sent, so a lost answer is retried with exactly this
          continue;
        }
        if (e.offline) {
          await this.save({ ...e, status: 'attention', problem: { code: err.code, message: err.message } });
        } else {
          const dropped = await this.dropWith(e);
          this.events.onRejected?.(e, err, dropped.slice(1));
        }
        return 'ok';
      }
    }
  }

  private async dropWith(e: OutboxEntry): Promise<OutboxEntry[]> {
    const { changed, dropped } = withoutDependents(this.entries, e);
    for (const c of changed) await this.save(c, false);
    await this.removeAll(dropped);
    return dropped;
  }

  private async save(e: OutboxEntry, notify = true): Promise<void> {
    await this.store.put(e);
    this.entries = this.entries.map((x) => (x.seq === e.seq ? e : x));
    if (notify) this.notify();
  }

  private async removeAll(list: readonly OutboxEntry[]): Promise<void> {
    const seqs = new Set(list.map((x) => x.seq));
    await this.store.remove([...seqs]);
    this.entries = this.entries.filter((x) => !seqs.has(x.seq));
    this.notify();
  }

  private notify(): void {
    for (const l of this.listeners) l(this.entries);
  }
}
