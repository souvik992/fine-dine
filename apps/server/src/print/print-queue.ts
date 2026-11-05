// Durable print queue (docs/06-printing-kds.md "Worker"). Jobs are rows written inside command transactions;
// this module only sends them after commit. One sequential worker per printer keeps tickets in order.
import { EscPos, type PaperWidth, type PrinterTarget, type Transport } from '@dinepos/printing';
import { isoInZone, newId } from '@dinepos/shared';
import type { EventBus, PrintWaker, PublishedEvent } from '../core/events.js';
import type { Db } from '../db/connection.js';

export type TransportKind = PrinterTarget['transport'];
export type PrinterStatus = 'ok' | 'retrying' | 'offline';

export interface PrintQueueOptions {
  db: Db;
  bus: EventBus;
  timeZone: string;
  transports: Record<TransportKind, Transport>;
  /** Waits before retry 1, 2, 3 … ; after the last one the job fails (docs/06: 2 s / 5 s / 15 s). */
  backoffMs?: number[];
  now?: () => Date;
  log?: (level: 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>) => void;
}

interface JobRow {
  id: string;
  printer_id: string;
  doc_kind: string;
  ref_id: string | null;
  bytes: Buffer;
  preview_text: string | null;
  attempts: number;
}

interface PrinterRow {
  id: string;
  name: string;
  transport: TransportKind;
  host: string | null;
  port: number | null;
  windows_name: string | null;
  width_mm: number;
  copies: number;
  backup_printer_id: string | null;
}

export const REROUTE_MARK = '** REROUTED FROM';

class PrinterWorker {
  private running: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private wakeAgain = false;
  status: PrinterStatus = 'ok';
  /** Why the printer is not ok (the last failed job or status check); null when ok. */
  error: string | null = null;

  constructor(
    private readonly q: PrintQueue,
    readonly printerId: string,
  ) {}

  get busy(): boolean {
    return this.running !== null || this.timer !== null;
  }

  /** Starts draining unless already draining or waiting out a backoff (order must hold). */
  kick(): void {
    if (this.q.stopped) return;
    if (this.running) {
      this.wakeAgain = true;
      return;
    }
    if (this.timer) return;
    this.running = this.drain().finally(() => {
      this.running = null;
      if (this.wakeAgain && !this.timer) {
        this.wakeAgain = false;
        this.kick();
      }
      this.q.notifyIdle();
    });
  }

  async waitCurrent(): Promise<void> {
    await this.running;
  }

  cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async drain(): Promise<void> {
    this.wakeAgain = false;
    while (!this.q.stopped) {
      const job = this.q.nextJob(this.printerId);
      if (!job) return;
      const printer = this.q.printer(this.printerId);
      if (!printer) {
        this.q.finishFailed(job, null, 'The printer was removed.', this);
        continue;
      }
      try {
        const bytes = repeat(job.bytes, Math.max(1, printer.copies));
        await this.q.transportFor(printer).send({ printer: target(printer), jobId: job.id, bytes, preview: job.preview_text });
        this.q.finishDone(job, this);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const attempt = job.attempts + 1;
        const waits = this.q.backoffMs;
        if (attempt <= waits.length && !this.q.stopped) {
          this.q.markRetry(job, message, this);
          this.timer = setTimeout(() => {
            this.timer = null;
            this.kick();
          }, waits[attempt - 1]);
          return;
        }
        this.q.finishFailed(job, printer, message, this);
      }
    }
  }
}

export class PrintQueue implements PrintWaker {
  readonly backoffMs: number[];
  stopped = false;
  private readonly workers = new Map<string, PrinterWorker>();
  private idleWaiters: Array<() => void> = [];
  private readonly now: () => Date;
  private monitor: NodeJS.Timeout | null = null;
  private checking: Promise<void> | null = null;

  constructor(private readonly opts: PrintQueueOptions) {
    this.backoffMs = opts.backoffMs ?? [2_000, 5_000, 15_000];
    this.now = opts.now ?? (() => new Date());
  }

  /** Resumes every printer with queued or retrying jobs (server start). */
  start(): void {
    const ids = this.opts.db.prepare(`SELECT DISTINCT printer_id FROM print_job WHERE state IN ('queued', 'retry')`).pluck().all() as string[];
    this.wake(ids);
  }

  wake(printerIds: readonly string[]): void {
    for (const id of new Set(printerIds)) this.worker(id).kick();
  }

  /** Stops new sends, cancels backoff timers and waits for tickets being sent right now. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.monitor) clearInterval(this.monitor);
    this.monitor = null;
    for (const w of this.workers.values()) w.cancelTimer();
    await Promise.all([...[...this.workers.values()].map((w) => w.waitCurrent()), this.checking]);
  }

  /** Checks every printer now and then every `intervalMs`, so a printer switched off shows before the next ticket. */
  startMonitor(intervalMs = 30_000): void {
    if (this.monitor || this.stopped) return;
    void this.checkPrinters();
    this.monitor = setInterval(() => void this.checkPrinters(), intervalMs);
    this.monitor.unref();
  }

  /**
   * The status check between jobs (docs/06 "Printer status"): asks each printer whose transport can be checked
   * whether it is there, without printing. A printer with jobs waiting is left to the worker (its sends say it).
   * A change (down, or back) is a `print.status` event like one from a job. Never rejects.
   */
  checkPrinters(): Promise<void> {
    this.checking ??= this.runChecks().finally(() => (this.checking = null));
    return this.checking;
  }

  private async runChecks(): Promise<void> {
    const printers = this.opts.db.prepare('SELECT * FROM printer').all() as PrinterRow[];
    const waiting = new Set(this.opts.db.prepare(`SELECT DISTINCT printer_id FROM print_job WHERE state IN ('queued', 'retry')`).pluck().all() as string[]);
    await Promise.all(
      printers.map(async (p) => {
        const transport = this.transportFor(p);
        if (!transport?.probe || waiting.has(p.id) || this.workers.get(p.id)?.busy) return;
        let error: string | null = null;
        try {
          await transport.probe(target(p));
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
        if (this.stopped) return;
        const w = this.worker(p.id);
        if (w.busy) return; // a ticket started meanwhile: its result is the truth
        const status: PrinterStatus = error ? 'offline' : 'ok';
        if (status === w.status && error === w.error) return;
        const changed = status !== w.status;
        w.status = status;
        w.error = error;
        if (!changed) return;
        if (error) this.opts.log?.('warn', 'printer not answering the status check', { printerId: p.id, error });
        else this.opts.log?.('info', 'printer answering again', { printerId: p.id });
        try {
          this.publish(this.tx(() => [this.statusEvent(p.id, status, error, this.now())]));
        } catch (err) {
          this.opts.log?.('error', 'printer status not recorded', { printerId: p.id, err: String(err) });
        }
      }),
    ).catch((err: unknown) => this.opts.log?.('error', 'printer status check failed', { err: String(err) }));
  }

  private worker(id: string): PrinterWorker {
    let w = this.workers.get(id);
    if (!w) {
      w = new PrinterWorker(this, id);
      this.workers.set(id, w);
    }
    return w;
  }

  /** Resolves when no printer is sending or waiting to retry (tests, graceful shutdown). */
  idle(): Promise<void> {
    if (![...this.workers.values()].some((w) => w.busy)) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** Live status of a printer this run has used; undefined when it has not printed since start. */
  status(printerId: string): PrinterStatus | undefined {
    return this.workers.get(printerId)?.status;
  }

  /** Why the printer is not ok, as this run last saw it (failed job or status check). */
  error(printerId: string): string | undefined {
    return this.workers.get(printerId)?.error ?? undefined;
  }

  // ---- used by workers ----

  notifyIdle(): void {
    if ([...this.workers.values()].some((w) => w.busy)) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const r of waiters) r();
  }

  nextJob(printerId: string): JobRow | undefined {
    return this.opts.db
      .prepare(
        `SELECT id, printer_id, doc_kind, ref_id, bytes, preview_text, attempts FROM print_job
         WHERE printer_id = ? AND state IN ('queued', 'retry') ORDER BY created_at, rowid LIMIT 1`,
      )
      .get(printerId) as JobRow | undefined;
  }

  printer(id: string): PrinterRow | undefined {
    return this.opts.db.prepare('SELECT * FROM printer WHERE id = ?').get(id) as PrinterRow | undefined;
  }

  transportFor(p: PrinterRow): Transport {
    return this.opts.transports[p.transport];
  }

  finishDone(job: JobRow, w: PrinterWorker): void {
    const at = this.now();
    const events = this.tx(() => {
      this.opts.db
        .prepare(`UPDATE print_job SET state = 'done', attempts = attempts + 1, last_error = NULL, done_at = ? WHERE id = ?`)
        .run(at.toISOString(), job.id);
      return w.status === 'ok' ? [] : [this.statusEvent(job.printer_id, 'ok', null, at)];
    });
    w.status = 'ok';
    w.error = null;
    this.publish(events);
  }

  markRetry(job: JobRow, error: string, w: PrinterWorker): void {
    const at = this.now();
    const events = this.tx(() => {
      this.opts.db.prepare(`UPDATE print_job SET state = 'retry', attempts = attempts + 1, last_error = ? WHERE id = ?`).run(error, job.id);
      return w.status === 'ok' ? [this.statusEvent(job.printer_id, 'retrying', error, at)] : [];
    });
    if (w.status === 'ok') this.opts.log?.('warn', 'printer not responding; will retry', { printerId: job.printer_id, jobId: job.id, error });
    w.status = w.status === 'offline' ? 'offline' : 'retrying';
    w.error = error;
    this.publish(events);
  }

  finishFailed(job: JobRow, printer: PrinterRow | null, error: string, w: PrinterWorker): void {
    const at = this.now();
    let backupId: string | null = null;
    const events = this.tx(() => {
      const db = this.opts.db;
      db.prepare(`UPDATE print_job SET state = 'failed', attempts = attempts + 1, last_error = ?, done_at = ? WHERE id = ?`).run(error, at.toISOString(), job.id);
      const out = [this.statusEvent(job.printer_id, 'offline', error, at)];
      const backup = printer?.backup_printer_id ? this.printer(printer.backup_printer_id) : undefined;
      if (printer && backup && !(job.preview_text ?? '').trimStart().startsWith(REROUTE_MARK)) {
        const header = new EscPos(paper(backup.width_mm)).init().bold(true).center(`${REROUTE_MARK} ${printer.name} **`).bold(false);
        const copyId = newId();
        db.prepare(
          `INSERT INTO print_job (id, printer_id, doc_kind, ref_id, bytes, preview_text, state, attempts, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?)`,
        ).run(copyId, backup.id, job.doc_kind, job.ref_id, Buffer.from(EscPos.prefix(header.bytes(), job.bytes)), header.preview() + (job.preview_text ?? ''), at.toISOString());
        db.prepare(
          `INSERT INTO audit_event (ts, entity, entity_id, action, before_json, after_json, reason)
           VALUES (?, 'print_job', ?, 'print.reroute', ?, ?, ?)`,
        ).run(at.toISOString(), job.id, JSON.stringify({ printerId: printer.id }), JSON.stringify({ printerId: backup.id, jobId: copyId }), error);
        backupId = backup.id;
      }
      return out;
    });
    w.status = 'offline';
    w.error = error;
    this.opts.log?.('error', 'print job failed', { printerId: job.printer_id, jobId: job.id, error, reroutedTo: backupId });
    this.publish(events);
    if (backupId) this.wake([backupId]);
  }

  private tx<T>(fn: () => T): T {
    return this.opts.db.transaction(fn).immediate();
  }

  /** Writes a `print.status` event_log row (inside the caller's transaction). */
  private statusEvent(printerId: string, status: PrinterStatus, error: string | null, at: Date): PublishedEvent {
    const queued = this.opts.db.prepare(`SELECT count(*) FROM print_job WHERE printer_id = ? AND state IN ('queued', 'retry')`).pluck().get(printerId) as number;
    const data = { printerId, status, queued, error };
    const ts = isoInZone(at, this.opts.timeZone);
    const seq = Number(
      this.opts.db.prepare(`INSERT INTO event_log (topic, event, payload_json, at) VALUES ('printers', 'print.status', ?, ?)`).run(JSON.stringify(data), ts).lastInsertRowid,
    );
    return { seq, topic: 'printers', event: 'print.status', at: ts, data };
  }

  private publish(events: PublishedEvent[]): void {
    for (const err of this.opts.bus.publish(events)) this.opts.log?.('error', 'print.status listener failed', { err: String(err) });
  }
}

function target(p: PrinterRow): PrinterTarget {
  return { id: p.id, name: p.name, transport: p.transport, host: p.host, port: p.port, windowsName: p.windows_name };
}

const paper = (mm: number): PaperWidth => (mm === 58 ? 58 : 80);

function repeat(bytes: Uint8Array, n: number): Uint8Array {
  if (n === 1) return bytes;
  const out = new Uint8Array(bytes.length * n);
  for (let i = 0; i < n; i++) out.set(bytes, i * bytes.length);
  return out;
}
