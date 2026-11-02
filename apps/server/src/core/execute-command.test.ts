import { newId, type Right } from '@dinepos/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/connection.js';
import { createTestDb } from '../testing/test-db.js';
import { testRegistry } from '../testing/fake-commands.js';
import { ensureBusinessDay } from './business-day.js';
import type { Actor } from './context.js';
import { PosError } from './errors.js';
import { EventBus, type PublishedEvent } from './events.js';
import { executeCommand, type ExecuteDeps } from './execute-command.js';
import { allowAllRights, forbidden, pinRequired, type RightsPolicy } from './rights.js';

const TZ = 'Asia/Kolkata';
const now = () => new Date('2026-11-02T08:00:00Z');
const actor: Actor = { deviceId: null, userId: null };

let db: Db;
let bus: EventBus;
let wake: ReturnType<typeof vi.fn<(ids: readonly string[]) => void>>;
let deps: ExecuteDeps;

beforeEach(() => {
  db = createTestDb();
  ensureBusinessDay(db, TZ, now);
  bus = new EventBus();
  wake = vi.fn<(ids: readonly string[]) => void>();
  deps = { db, registry: testRegistry, rights: allowAllRights, bus, printWaker: { wake }, timeZone: TZ, now };
});
afterEach(() => db.close());

const env = (type: string, payload: unknown, order?: { orderId: string; expectedVersion: number }) => ({
  commandId: newId(),
  type,
  ...order,
  payload,
  createdAt: '2026-11-02T13:30:00+05:30',
});

const count = (table: string) => db.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number;

function openOrder(): string {
  const orderId = newId();
  executeCommand(deps, env('TestOpen', { orderId }), actor);
  return orderId;
}

function expectPosError(fn: () => unknown, code: string): PosError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(PosError);
    expect((err as PosError).code).toBe(code);
    return err as PosError;
  }
  throw new Error(`expected ${code}`);
}

describe('executeCommand — happy path', () => {
  it('creates an order and returns its snapshot at version 1', () => {
    const orderId = newId();
    const res = executeCommand(deps, env('TestOpen', { orderId }), actor);
    expect(res).toMatchObject({ ok: true, version: 1, result: { orderId }, order: { id: orderId, state: 'open', type: 'takeaway' } });
    expect(res.order?.businessDate).toBe('2026-11-02');
  });

  it('bumps the version by exactly one and writes audit, event, print and outbox rows', () => {
    const orderId = openOrder();
    db.prepare("INSERT INTO printer (id, name, transport) VALUES ('p1', 'Kitchen', 'fake')").run();
    const e = env('TestNote', { note: 'window seat', printerId: 'p1' }, { orderId, expectedVersion: 1 });
    const res = executeCommand(deps, e, actor);

    expect(res.version).toBe(2);
    expect(res.order?.version).toBe(2);
    expect(res.result).toEqual({ noted: 'window seat' });

    const audit = db.prepare("SELECT command_id, entity, action, after_json FROM audit_event WHERE action = 'order.note'").get();
    expect(audit).toEqual({ command_id: e.commandId, entity: 'order', action: 'order.note', after_json: '{"note":"window seat"}' });

    const events = db.prepare('SELECT topic, event FROM event_log WHERE seq > 2 ORDER BY seq').all();
    expect(events).toEqual([
      { topic: 'station:test', event: 'kot.created' },
      { topic: `order:${orderId}`, event: 'order.updated' },
      { topic: 'floor', event: 'order.updated' },
    ]);
    expect(db.prepare('SELECT printer_id, doc_kind, state FROM print_job').get()).toEqual({ printer_id: 'p1', doc_kind: 'kot', state: 'queued' });
    expect(db.prepare('SELECT kind FROM outbox').pluck().get()).toBe('order.note');
    expect(db.prepare('SELECT type FROM processed_command WHERE command_id = ?').pluck().get(e.commandId)).toBe('TestNote');
  });

  it('publishes events and wakes printers only after commit', () => {
    const orderId = openOrder();
    db.prepare("INSERT INTO printer (id, name, transport) VALUES ('p1', 'Kitchen', 'fake')").run();
    const seen: Array<{ e: PublishedEvent; inTx: boolean; version: number }> = [];
    bus.subscribe((e) =>
      seen.push({ e, inTx: db.inTransaction, version: db.prepare('SELECT version FROM "order" WHERE id = ?').pluck().get(orderId) as number }),
    );
    executeCommand(deps, env('TestNote', { note: 'x', printerId: 'p1' }, { orderId, expectedVersion: 1 }), actor);

    expect(seen.map((s) => s.e.event)).toEqual(['kot.created', 'order.updated', 'order.updated']);
    expect(seen.every((s) => !s.inTx && s.version === 2)).toBe(true);
    expect(seen.map((s) => s.e.seq)).toEqual([...seen.map((s) => s.e.seq)].sort((a, b) => a - b));
    expect(seen[1]!.e.at).toBe('2026-11-02T13:30:00.000+05:30');
    expect(wake).toHaveBeenCalledWith(['p1']);
  });

  it('a failing listener or printer wake never fails the command', () => {
    const orderId = openOrder();
    const onPostCommitError = vi.fn();
    bus.subscribe(() => {
      throw new Error('ws down');
    });
    const res = executeCommand({ ...deps, onPostCommitError }, env('TestNote', { note: 'x' }, { orderId, expectedVersion: 1 }), actor);
    expect(res.ok).toBe(true);
    expect(onPostCommitError).toHaveBeenCalledWith(expect.any(Error), 'publish');
  });
});

describe('executeCommand — idempotency (DUPLICATE)', () => {
  it('a replay returns the original result and does no work', () => {
    const orderId = openOrder();
    const e = env('TestNote', { note: 'once' }, { orderId, expectedVersion: 1 });
    const first = executeCommand(deps, e, actor);
    const before = { audit: count('audit_event'), events: count('event_log'), outbox: count('outbox') };
    const listener = vi.fn();
    bus.subscribe(listener);

    const replay = executeCommand(deps, e, actor);
    expect(replay).toEqual({ ...first, duplicate: true });
    expect({ audit: count('audit_event'), events: count('event_log'), outbox: count('outbox') }).toEqual(before);
    expect(db.prepare('SELECT version FROM "order" WHERE id = ?').pluck().get(orderId)).toBe(2);
    expect(listener).not.toHaveBeenCalled();
  });

  it('matches a retry whose payload keys arrive in a different order', () => {
    const orderId = openOrder();
    db.prepare("INSERT INTO printer (id, name, transport) VALUES ('p1', 'K', 'fake')").run();
    const e = env('TestNote', { note: 'a', printerId: 'p1' }, { orderId, expectedVersion: 1 });
    executeCommand(deps, e, actor);
    const reordered = { ...e, payload: { printerId: 'p1', note: 'a' } };
    expect(executeCommand(deps, reordered, actor).duplicate).toBe(true);
  });

  it('rejects a commandId reused for a different command', () => {
    const orderId = openOrder();
    const e = env('TestNote', { note: 'a' }, { orderId, expectedVersion: 1 });
    executeCommand(deps, e, actor);
    expectPosError(() => executeCommand(deps, { ...e, payload: { note: 'b' } }, actor), 'VALIDATION');
  });

  it('replays even after the business day was closed', () => {
    const orderId = openOrder();
    const e = env('TestNote', { note: 'a' }, { orderId, expectedVersion: 1 });
    executeCommand(deps, e, actor);
    db.prepare("UPDATE business_day SET closed_at = 'now'").run();
    expect(executeCommand(deps, e, actor).duplicate).toBe(true);
  });
});

describe('executeCommand — VERSION_CONFLICT', () => {
  it('rejects a stale expectedVersion, returns the current snapshot and writes nothing', () => {
    const orderId = openOrder();
    executeCommand(deps, env('TestNote', { note: 'first' }, { orderId, expectedVersion: 1 }), actor);
    const before = { audit: count('audit_event'), events: count('event_log'), done: count('processed_command') };

    const err = expectPosError(
      () => executeCommand(deps, env('TestNote', { note: 'stale' }, { orderId, expectedVersion: 1 }), actor),
      'VERSION_CONFLICT',
    );
    expect(err.httpStatus).toBe(409);
    expect(err.details).toEqual({ currentVersion: 2, expectedVersion: 1 });
    expect(err.order).toMatchObject({ id: orderId, version: 2 });
    expect({ audit: count('audit_event'), events: count('event_log'), done: count('processed_command') }).toEqual(before);
    expect(db.prepare('SELECT customer_name FROM "order" WHERE id = ?').pluck().get(orderId)).toBe('first');
  });

  it('two commands built on the same version: the second loses', () => {
    const orderId = openOrder();
    const a = env('TestNote', { note: 'a' }, { orderId, expectedVersion: 1 });
    const b = env('TestNote', { note: 'b' }, { orderId, expectedVersion: 1 });
    executeCommand(deps, a, actor);
    expectPosError(() => executeCommand(deps, b, actor), 'VERSION_CONFLICT');
  });
});

describe('executeCommand — VALIDATION', () => {
  it.each([
    ['missing commandId', { type: 'TestOpen', payload: {}, createdAt: '2026-11-02T13:30:00+05:30' }],
    ['bad ULID', { commandId: 'abc', type: 'TestOpen', payload: {}, createdAt: '2026-11-02T13:30:00+05:30' }],
    ['unknown envelope key', { ...env('TestOpen', {}), extra: 1 }],
    ['createdAt without offset', { ...env('TestOpen', {}), createdAt: '2026-11-02 13:30' }],
    ['orderId without expectedVersion', { ...env('TestOpen', {}), orderId: newId() }],
  ])('rejects an envelope with %s', (_name, body) => {
    expectPosError(() => executeCommand(deps, body, actor), 'VALIDATION');
  });

  it('rejects an unknown command type', () => {
    const err = expectPosError(() => executeCommand(deps, env('NoSuchCommand', {}), actor), 'VALIDATION');
    expect(err.details).toEqual({ type: 'NoSuchCommand' });
  });

  it('rejects an invalid payload with field paths', () => {
    const orderId = openOrder();
    const err = expectPosError(() => executeCommand(deps, env('TestNote', { note: '' }, { orderId, expectedVersion: 1 }), actor), 'VALIDATION');
    expect(err.details).toEqual([expect.objectContaining({ path: 'note' })]);
  });

  it('requires orderId for order commands and refuses it elsewhere', () => {
    expectPosError(() => executeCommand(deps, env('TestNote', { note: 'x' }), actor), 'VALIDATION');
    expectPosError(() => executeCommand(deps, env('TestOpen', { orderId: newId() }, { orderId: newId(), expectedVersion: 1 }), actor), 'VALIDATION');
  });

  it('nothing is written for a rejected command', () => {
    const before = count('processed_command');
    expect(() => executeCommand(deps, env('TestOpen', { orderId: 'bad' }), actor)).toThrow();
    expect(count('processed_command')).toBe(before);
  });
});

describe('executeCommand — rollback on handler throw', () => {
  it.each([
    ['a PosError', false, 'INVALID_STATE'],
    ['an unexpected error', true, null],
  ])('leaves no partial rows when the handler throws %s', (_name, crash, code) => {
    const orderId = openOrder();
    const before = { audit: count('audit_event'), events: count('event_log'), done: count('processed_command') };
    const e = env('TestFail', { crash }, { orderId, expectedVersion: 1 });
    if (code) expectPosError(() => executeCommand(deps, e, actor), code);
    else expect(() => executeCommand(deps, e, actor)).toThrow('disk on fire');

    expect({ audit: count('audit_event'), events: count('event_log'), done: count('processed_command') }).toEqual(before);
    expect(db.prepare('SELECT customer_name, version FROM "order" WHERE id = ?').get(orderId)).toEqual({ customer_name: null, version: 1 });
    expect(db.inTransaction).toBe(false);
  });

  it('a failed command is not remembered, so its retry runs again', () => {
    const orderId = openOrder();
    const e = env('TestFail', {}, { orderId, expectedVersion: 1 });
    expectPosError(() => executeCommand(deps, e, actor), 'INVALID_STATE');
    expectPosError(() => executeCommand(deps, e, actor), 'INVALID_STATE');
  });
});

describe('executeCommand — rights, missing order, closed day', () => {
  const policy = (fn: (right: Right) => { approvedBy?: string } | void): RightsPolicy => ({ check: ({ right }) => fn(right) });

  it('FORBIDDEN when the policy refuses the right', () => {
    const orderId = openOrder();
    const err = expectPosError(
      () =>
        executeCommand(
          { ...deps, rights: policy((r) => { throw forbidden(r); }) },
          env('TestNote', { note: 'x' }, { orderId, expectedVersion: 1 }),
          actor,
        ),
      'FORBIDDEN',
    );
    expect(err.details).toEqual({ right: 'order.edit' });
  });

  it('PIN_REQUIRED when the right needs a manager PIN', () => {
    const orderId = openOrder();
    expectPosError(
      () =>
        executeCommand(
          { ...deps, rights: policy((r) => { throw pinRequired(r); }) },
          env('TestNote', { note: 'x' }, { orderId, expectedVersion: 1 }),
          actor,
        ),
      'PIN_REQUIRED',
    );
  });

  it('records the approving manager and leakage flag in the audit row', () => {
    const orderId = openOrder();
    executeCommand(
      { ...deps, rights: policy(() => ({ approvedBy: 'mgr-1' })) },
      env('TestNote', { note: 'leak' }, { orderId, expectedVersion: 1 }),
      { deviceId: 'dev-1', userId: 'cashier-1' },
    );
    expect(db.prepare("SELECT device_id, user_id, approved_by, leakage_flag FROM audit_event WHERE action = 'order.note'").get()).toEqual({
      device_id: 'dev-1',
      user_id: 'cashier-1',
      approved_by: 'mgr-1',
      leakage_flag: 1,
    });
  });

  it('NOT_FOUND for an unknown order', () => {
    expectPosError(() => executeCommand(deps, env('TestNote', { note: 'x' }, { orderId: newId(), expectedVersion: 1 }), actor), 'NOT_FOUND');
  });

  it('DAY_CLOSED when no business date is open', () => {
    db.prepare("UPDATE business_day SET closed_at = 'now'").run();
    expectPosError(() => executeCommand(deps, env('TestOpen', { orderId: newId() }), actor), 'DAY_CLOSED');
  });
});
