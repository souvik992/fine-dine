// The cloud sync agent (P4-05, docs/05 "Cloud sync"). While the outlet is paired with the hub (the same link as online
// orders, Settings › Online orders), the master server:
//  - sends the outbox up in order (POST /v1/pos/sync/batches), each batch resent as it is until the hub answers, and
//    marks what the hub acks as sent through a command (RecordSyncAck);
//  - fetches a renewed licence key the vendor put on the hub (GET /v1/pos/licence) and installs it through a command
//    (RenewLicence), which checks it is for this PC and ends later.
// Billing never waits for this: the outbox only grows while the hub cannot be reached, and is sent when it can.
import type { SyncStatus } from '@dinepos/shared';
import { PosError } from '../core/errors.js';
import type { EventBus } from '../core/events.js';
import type { Db } from '../db/connection.js';
import type { Execute } from '../online/connector.js';
import { linkRow } from '../online/online-support.js';
import { pendingSummary, syncStream, unsentRows, type OutboxRow } from './sync-support.js';

export interface SyncAgentOptions {
  db: Db;
  now: () => Date;
  execute: Execute;
  bus: EventBus;
  fetch?: typeof fetch;
  /** How often to send while there is something to send, and to retry after a failure (ms). */
  tickMs?: number;
  /** How often to look for a renewed licence key (ms). */
  licenceEveryMs?: number;
  /** Rows per batch (the hub takes at most 500) and the largest batch body (bytes; at least one row is sent). */
  batchSize?: number;
  maxBatchBytes?: number;
  log?: { info: (msg: string, data?: unknown) => void; warn: (msg: string, data?: unknown) => void };
}

interface HubErrorBody {
  error?: { code?: string; message?: string; details?: { ackSeq?: number } };
}

/** Rewinds in one run at most (a hub that keeps losing records is not followed for ever). */
const MAX_REWINDS = 3;

export class SyncAgent {
  private readonly o: Required<Omit<SyncAgentOptions, 'log'>> & Pick<SyncAgentOptions, 'log'>;
  private state: 'idle' | 'sending' | 'offline' | 'stuck' = 'idle';
  private lastError: string | null = null;
  private lastSyncAt: string | null = null;
  private conflict = false;
  private licenceCheckedAt: string | null = null;
  private licenceResult: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private licenceTimer: NodeJS.Timeout | null = null;
  private sending: Promise<void> | null = null;
  private sendAgain = false;
  private checking: Promise<void> | null = null;
  private unsubscribe: (() => void) | null = null;
  private debounce: NodeJS.Timeout | null = null;

  constructor(opts: SyncAgentOptions) {
    this.o = { fetch: (input, init) => fetch(input, init), tickMs: 30_000, licenceEveryMs: 3_600_000, batchSize: 200, maxBatchBytes: 1_000_000, ...opts };
  }

  /** Sends whatever is waiting now and on every tick; a committed command (a bill, a day end) wakes it soon after. */
  start(): void {
    this.unsubscribe ??= this.o.bus.subscribe((e) => {
      if (e.event === 'online.linked') {
        this.conflict = false;
        void this.checkLicence();
      }
      if (e.event === 'sync.changed') this.conflict = false;
      this.debounce ??= setTimeout(() => {
        this.debounce = null;
        void this.send();
      }, 1000);
    });
    this.timer ??= setInterval(() => void this.send(), this.o.tickMs);
    this.licenceTimer ??= setInterval(() => void this.checkLicence(), this.o.licenceEveryMs);
    this.timer.unref?.();
    this.licenceTimer.unref?.();
    void this.send();
    void this.checkLicence();
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const t of [this.timer, this.licenceTimer]) if (t) clearInterval(t);
    if (this.debounce) clearTimeout(this.debounce);
    this.timer = this.licenceTimer = this.debounce = null;
    await this.sending;
    await this.checking;
  }

  status(): SyncStatus {
    const link = linkRow(this.o.db);
    const paired = Boolean(link.device_key && link.hub_url);
    return {
      paired,
      hubUrl: link.hub_url,
      store: link.store_slug ? { slug: link.store_slug, name: link.store_name ?? link.store_slug } : null,
      state: paired ? (this.conflict ? 'stuck' : this.state) : 'not-paired',
      ...pendingSummary(this.o.db),
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
      conflict: this.conflict,
      licence: { checkedAt: this.licenceCheckedAt, result: this.licenceResult },
    };
  }

  /** Settings › Cloud sync "Sync now": send everything and look for a renewed key, then report. */
  async syncNow(): Promise<SyncStatus> {
    await this.send();
    await this.checkLicence();
    return this.status();
  }

  /** One run at a time; a wake-up during a run makes it go round once more. */
  send(): Promise<void> {
    if (this.sending) {
      this.sendAgain = true;
      return this.sending;
    }
    this.sending = (async () => {
      do {
        this.sendAgain = false;
        await this.drain();
      } while (this.sendAgain);
    })()
      .catch((e: unknown) => this.o.log?.warn('cloud sync failed', String(e)))
      .finally(() => {
        this.sending = null;
      });
    return this.sending;
  }

  private hub(): { url: string; key: string } | null {
    const link = linkRow(this.o.db);
    return link.hub_url && link.device_key ? { url: link.hub_url.replace(/\/+$/, ''), key: link.device_key } : null;
  }

  private async drain(): Promise<void> {
    let rewinds = 0;
    for (;;) {
      const hub = this.hub();
      if (!hub || this.conflict) return;
      const rows = this.batch();
      if (rows.length === 0) {
        if (this.state !== 'stuck') this.state = 'idle';
        return;
      }
      const { streamId } = syncStream(this.o.db);
      this.state = 'sending';
      let r: Response;
      try {
        r = await this.o.fetch(`${hub.url}/v1/pos/sync/batches`, {
          method: 'POST',
          headers: { authorization: `Bearer ${hub.key}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            streamId,
            fromSeq: rows[0]!.seq,
            events: rows.map((x) => ({ seq: x.seq, kind: x.kind, payload: JSON.parse(x.payload_json) as unknown, createdAt: x.created_at })),
          }),
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        this.fail('offline', 'The hub could not be reached. Sales are kept here and sent when it can be.');
        return;
      }
      const j = (await r.json().catch(() => null)) as ({ ackSeq?: number } & HubErrorBody) | null;
      if (r.ok && typeof j?.ackSeq === 'number') {
        this.o.execute('RecordSyncAck', { streamId, ackSeq: j.ackSeq });
        this.lastSyncAt = this.o.now().toISOString();
        this.lastError = null;
        continue;
      }
      const code = j?.error?.code;
      if (code === 'SYNC_GAP' && typeof j?.error?.details?.ackSeq === 'number' && rewinds < MAX_REWINDS) {
        rewinds++;
        this.o.execute('RecordSyncAck', { streamId, ackSeq: j.error.details.ackSeq, rewind: true });
        this.o.log?.warn('the hub is missing sales records: sending them again', { ackSeq: j.error.details.ackSeq });
        continue;
      }
      if (code === 'SYNC_CONFLICT') {
        this.conflict = true;
        this.fail('stuck', j?.error?.message ?? 'The hub holds different records under the same numbers.');
        return;
      }
      if (r.status === 401) this.fail('stuck', 'The hub does not know this outlet any more. Connect it again in Settings › Online orders.');
      else if (r.status >= 500) this.fail('offline', `The hub had a problem (${r.status}). Trying again shortly.`);
      else this.fail('stuck', j?.error?.message ?? `The hub refused the sales records (${r.status}).`);
      return;
    }
  }

  /** The next rows to send, within the size limit (at least one). */
  private batch(): OutboxRow[] {
    const rows = unsentRows(this.o.db, this.o.batchSize);
    let bytes = 0;
    const out: OutboxRow[] = [];
    for (const r of rows) {
      bytes += r.payload_json.length + 100;
      if (out.length > 0 && bytes > this.o.maxBatchBytes) break;
      out.push(r);
    }
    return out;
  }

  private fail(state: 'offline' | 'stuck', message: string): void {
    if (this.lastError !== message) this.o.log?.warn('cloud sync: ' + message);
    this.state = state;
    this.lastError = message;
  }

  /** Looks for a renewed key on the hub and installs it when it is newer; the result is shown in Settings. */
  checkLicence(): Promise<void> {
    this.checking ??= this.fetchLicence()
      .catch((e: unknown) => this.o.log?.warn('licence check failed', String(e))) // never rejects: callers fire and forget
      .finally(() => {
        this.checking = null;
      });
    return this.checking;
  }

  private async fetchLicence(): Promise<void> {
    const hub = this.hub();
    if (!hub) return;
    let key: string | null;
    try {
      const r = await this.o.fetch(`${hub.url}/v1/pos/licence`, { headers: { authorization: `Bearer ${hub.key}` }, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) {
        this.licenceResult = `The hub did not answer (${r.status}).`;
        return;
      }
      key = ((await r.json()) as { key?: string | null }).key ?? null;
    } catch {
      this.licenceResult = 'The hub could not be reached.';
      return;
    } finally {
      this.licenceCheckedAt = this.o.now().toISOString();
    }
    if (!key) {
      this.licenceResult = 'No renewed key on the hub.';
      return;
    }
    try {
      const res = this.o.execute('RenewLicence', { key }).result as { status: string; expiresAt?: string };
      this.licenceResult = res.status === 'renewed' ? `Renewed from the hub: now ends ${res.expiresAt?.slice(0, 10)}.` : 'The installed key is the one on the hub.';
      if (res.status === 'renewed') this.o.log?.info('licence renewed from the hub', { expiresAt: res.expiresAt });
    } catch (e) {
      this.licenceResult = e instanceof PosError ? `The key on the hub was not installed: ${e.message}` : 'The key on the hub could not be installed.';
    }
  }
}
