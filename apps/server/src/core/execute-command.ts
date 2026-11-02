import { createHash } from 'node:crypto';
import { commandEnvelopeSchema, isoInZone, localDate, newId, type CommandEnvelope, type CommandSuccess } from '@dinepos/shared';
import type { z } from 'zod';
import type { Db } from '../db/connection.js';
import { getOrderSnapshot, loadOrderRow } from '../queries/order-snapshot.js';
import { currentBusinessDate } from './business-day.js';
import type { CommandHandler, CommandRegistry, OrderRow } from './command-handler.js';
import type { Actor, AuditEntry, CommandContext, PendingEvent, PendingOutbox, PendingPrintJob } from './context.js';
import { PosError } from './errors.js';
import type { EventBus, PrintWaker, PublishedEvent } from './events.js';
import type { RightsPolicy } from './rights.js';

export interface ExecuteDeps {
  db: Db;
  registry: CommandRegistry;
  rights: RightsPolicy;
  bus: EventBus;
  printWaker: PrintWaker;
  timeZone: string;
  now?: () => Date;
  /** Called for post-commit failures (they never fail the command). */
  onPostCommitError?: (err: unknown, stage: 'publish' | 'print') => void;
}

interface StoredCommand {
  type: string;
  requestHash: string;
  response: CommandSuccess;
}

/**
 * The single write path (docs/01-architecture.md "Command pipeline"). Inside one IMMEDIATE transaction:
 * idempotency → business day → load order → expectedVersion → rights → apply → bump version →
 * audit/event_log/print_job/outbox rows → processed_command → COMMIT. Events and printer wake-ups are
 * delivered only after the commit.
 */
export function executeCommand(deps: ExecuteDeps, body: unknown, actor: Actor): CommandSuccess {
  const envelope = parseOrThrow(commandEnvelopeSchema, body, 'Invalid command envelope.');
  const handler = deps.registry.get(envelope.type);
  if (!handler) throw new PosError('VALIDATION', `Unknown command type "${envelope.type}".`, { type: envelope.type });
  if (handler.needsOrder && envelope.orderId === undefined) {
    throw new PosError('VALIDATION', `${handler.type} needs orderId and expectedVersion.`);
  }
  if (!handler.needsOrder && envelope.orderId !== undefined) {
    throw new PosError('VALIDATION', `${handler.type} does not take orderId or expectedVersion.`);
  }
  const payload = parseOrThrow(handler.schema, envelope.payload, `Invalid ${handler.type} payload.`);
  const requestHash = hashRequest(envelope, payload);

  const now = (deps.now ?? (() => new Date()))();
  const run = deps.db.transaction(() => runInTransaction(deps, handler, envelope, payload, requestHash, actor, now));
  const outcome = run.immediate();

  if (outcome.replayed) return { ...outcome.response, duplicate: true };
  afterCommit(deps, outcome.events, outcome.printerIds);
  return outcome.response;
}

type TxOutcome =
  | { replayed: true; response: CommandSuccess }
  | { replayed: false; response: CommandSuccess; events: PublishedEvent[]; printerIds: string[] };

function runInTransaction(
  deps: ExecuteDeps,
  handler: CommandHandler<unknown>,
  envelope: CommandEnvelope,
  payload: unknown,
  requestHash: string,
  actor: Actor,
  now: Date,
): TxOutcome {
  const { db } = deps;

  // 1. Idempotency: a replay returns the original result and does no work.
  const stored = db.prepare('SELECT result_json FROM processed_command WHERE command_id = ?').pluck().get(envelope.commandId) as
    | string
    | undefined;
  if (stored !== undefined) {
    const prev = JSON.parse(stored) as StoredCommand;
    if (prev.type !== envelope.type || prev.requestHash !== requestHash) {
      throw new PosError('VALIDATION', 'This commandId was already used for a different command.', {
        commandId: envelope.commandId,
      });
    }
    return { replayed: true, response: prev.response };
  }

  // 2. Business day.
  const openDate = currentBusinessDate(db);
  if (openDate === null && !handler.allowWhenDayClosed) {
    throw new PosError('DAY_CLOSED', 'The business day is closed. Open a new day before taking orders.');
  }
  const businessDate = openDate ?? localDate(now, deps.timeZone);

  // 3. Load order + optimistic concurrency.
  let order: OrderRow | null = null;
  if (handler.needsOrder) {
    const orderId = envelope.orderId!;
    order = loadOrderRow(db, orderId) ?? null;
    if (!order) throw new PosError('NOT_FOUND', 'Order not found.', { orderId });
    if (order.version !== envelope.expectedVersion) {
      const err = new PosError('VERSION_CONFLICT', 'The order was changed on another device.', {
        currentVersion: order.version,
        expectedVersion: envelope.expectedVersion,
      });
      err.order = getOrderSnapshot(db, orderId);
      throw err;
    }
  }

  // 4. Rights (may approve with a manager PIN).
  let approvedBy = actor.approvedBy ?? null;
  if (handler.right) {
    const verdict = deps.rights.check({ db, actor, right: handler.right, commandType: handler.type });
    if (verdict?.approvedBy) approvedBy = verdict.approvedBy;
  }

  // 5. Apply.
  const audits: AuditEntry[] = [];
  const events: PendingEvent[] = [];
  const prints: PendingPrintJob[] = [];
  const outbox: PendingOutbox[] = [];
  const touched = new Set<string>();
  const nowIso = now.toISOString();
  const ctx: CommandContext = {
    db,
    commandId: envelope.commandId,
    commandType: handler.type,
    actor: { ...actor, approvedBy },
    businessDate,
    timeZone: deps.timeZone,
    now,
    nowIso,
    audit: (e) => audits.push(e),
    emit: (topics, event, data) => events.push({ topics: Array.isArray(topics) ? topics : [topics], event, data }),
    print: (job) => {
      const id = job.id ?? newId();
      prints.push({ ...job, id });
      return id;
    },
    outbox: (kind, p) => outbox.push({ kind, payload: p }),
    touchOrder: (id) => touched.add(id),
  };
  const out = handler.apply(ctx, payload, order) ?? {};

  // 6. Versions: the command's order goes up by exactly one; so does every other order it touched.
  const primaryId = order?.id ?? out.orderId ?? null;
  if (order) {
    const res = db.prepare('UPDATE "order" SET version = version + 1 WHERE id = ? AND version = ?').run(order.id, order.version);
    if (res.changes !== 1) throw new Error(`${handler.type} changed order ${order.id} version itself`);
  }
  touched.delete(primaryId ?? '');
  for (const id of touched) db.prepare('UPDATE "order" SET version = version + 1 WHERE id = ?').run(id);

  // 7. Snapshot + order.updated events for every changed order.
  const snapshot = primaryId ? getOrderSnapshot(db, primaryId) : undefined;
  if (primaryId && !snapshot) throw new Error(`${handler.type} reported order ${primaryId} but it does not exist`);
  for (const id of [primaryId, ...touched]) {
    if (!id) continue;
    const s = id === primaryId ? snapshot! : getOrderSnapshot(db, id);
    if (!s) continue;
    events.push({
      topics: [`order:${id}`, 'floor'],
      event: 'order.updated',
      data: { orderId: id, version: s.version, tableId: s.table?.id ?? null, state: s.state, totals: s.totals },
    });
  }

  // 8. Audit (append-only), event log, print jobs, outbox.
  if (audits.length === 0) {
    audits.push({ entity: 'command', entityId: primaryId, action: `command.${handler.type}`, after: payload });
  }
  const insertAudit = db.prepare(
    `INSERT INTO audit_event (ts, device_id, user_id, approved_by, command_id, entity, entity_id, action,
                              before_json, after_json, reason, leakage_flag)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const a of audits) {
    insertAudit.run(
      nowIso,
      actor.deviceId,
      actor.userId,
      approvedBy,
      envelope.commandId,
      a.entity,
      a.entityId ?? null,
      a.action,
      toJson(a.before),
      toJson(a.after),
      a.reason ?? null,
      a.leakage ? 1 : 0,
    );
  }

  const at = isoInZone(now, deps.timeZone);
  const insertEvent = db.prepare('INSERT INTO event_log (topic, event, payload_json, at) VALUES (?, ?, ?, ?)');
  const published: PublishedEvent[] = [];
  for (const e of events) {
    for (const topic of e.topics) {
      const seq = Number(insertEvent.run(topic, e.event, JSON.stringify(e.data ?? null), at).lastInsertRowid);
      published.push({ seq, topic, event: e.event, at, data: e.data });
    }
  }

  const insertPrint = db.prepare(
    `INSERT INTO print_job (id, printer_id, doc_kind, ref_id, bytes, preview_text, state, attempts, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?)`,
  );
  for (const p of prints) insertPrint.run(p.id, p.printerId, p.docKind, p.refId, Buffer.from(p.bytes), p.previewText, nowIso);

  const insertOutbox = db.prepare('INSERT INTO outbox (kind, payload_json, created_at) VALUES (?, ?, ?)');
  for (const o of outbox) insertOutbox.run(o.kind, JSON.stringify(o.payload ?? null), nowIso);

  // 9. Idempotency record, same transaction.
  const response: CommandSuccess = {
    ok: true,
    commandId: envelope.commandId,
    ...(snapshot ? { order: snapshot, version: snapshot.version } : {}),
    result: out.result ?? null,
  };
  const record: StoredCommand = { type: handler.type, requestHash, response };
  db.prepare('INSERT INTO processed_command (command_id, type, result_json, at) VALUES (?, ?, ?, ?)').run(
    envelope.commandId,
    handler.type,
    JSON.stringify(record),
    nowIso,
  );

  return { replayed: false, response, events: published, printerIds: [...new Set(prints.map((p) => p.printerId))] };
}

function afterCommit(deps: ExecuteDeps, events: PublishedEvent[], printerIds: string[]): void {
  for (const err of deps.bus.publish(events)) deps.onPostCommitError?.(err, 'publish');
  if (printerIds.length === 0) return;
  try {
    deps.printWaker.wake(printerIds);
  } catch (err) {
    deps.onPostCommitError?.(err, 'print');
  }
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  throw new PosError(
    'VALIDATION',
    message,
    r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  );
}

function toJson(v: unknown): string | null {
  return v === undefined ? null : JSON.stringify(v);
}

/** Canonical JSON (sorted keys) so a retried command hashes the same whatever its key order. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

function hashRequest(e: CommandEnvelope, payload: unknown): string {
  return createHash('sha256')
    .update(canonical({ type: e.type, orderId: e.orderId, expectedVersion: e.expectedVersion, payload }))
    .digest('hex');
}
