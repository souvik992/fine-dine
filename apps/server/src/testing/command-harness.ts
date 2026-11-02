import { newId, type CommandSuccess } from '@dinepos/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { commandRegistry } from '../commands/registry.js';
import { ensureBusinessDay } from '../core/business-day.js';
import type { Actor } from '../core/context.js';
import { PosError } from '../core/errors.js';
import { EventBus, noopPrintWaker } from '../core/events.js';
import { executeCommand, type ExecuteDeps } from '../core/execute-command.js';
import { allowAllRights, forbidden, type RightsPolicy } from '../core/rights.js';
import type { Db } from '../db/connection.js';
import { createTestDb } from './test-db.js';

export const TEST_NOW = () => new Date('2026-11-02T08:00:00Z');

export interface Harness {
  db: Db;
  run(type: string, payload: unknown, opts?: { commandId?: string; rights?: RightsPolicy; actor?: Actor; orderId?: string; expectedVersion?: number }): CommandSuccess;
  fail(type: string, payload: unknown, code: string, opts?: Parameters<Harness['run']>[2]): PosError;
  count(table: string, where?: string): number;
}

/** Fresh migrated DB with an open business day, per test. Use inside a describe block. */
export function useHarness(): Harness {
  let db!: Db;
  beforeEach(() => {
    db = createTestDb();
    ensureBusinessDay(db, 'Asia/Kolkata', TEST_NOW);
  });
  afterEach(() => db.close());

  const deps = (rights: RightsPolicy): ExecuteDeps => ({
    db,
    registry: commandRegistry,
    rights,
    bus: new EventBus(),
    printWaker: noopPrintWaker,
    timeZone: 'Asia/Kolkata',
    now: TEST_NOW,
  });

  const h: Harness = {
    get db() {
      return db;
    },
    run(type, payload, opts = {}) {
      const body = {
        commandId: opts.commandId ?? newId(),
        type,
        payload,
        createdAt: '2026-11-02T13:30:00+05:30',
        ...(opts.orderId ? { orderId: opts.orderId, expectedVersion: opts.expectedVersion ?? 1 } : {}),
      };
      return executeCommand(deps(opts.rights ?? allowAllRights), body, opts.actor ?? { deviceId: null, userId: null });
    },
    fail(type, payload, code, opts) {
      try {
        h.run(type, payload, opts);
      } catch (err) {
        expect(err).toBeInstanceOf(PosError);
        expect((err as PosError).code).toBe(code);
        return err as PosError;
      }
      throw new Error(`expected ${type} to fail with ${code}`);
    },
    count(table, where = '1 = 1') {
      return db.prepare(`SELECT count(*) FROM ${table} WHERE ${where}`).pluck().get() as number;
    },
  };
  return h;
}

export const denyAll: RightsPolicy = {
  check: ({ right }) => {
    throw forbidden(right);
  },
};

/**
 * The checks every admin upsert shares (CLAUDE.md test list): create then update, FORBIDDEN without the
 * admin right, DUPLICATE replay, and nothing written on a rejected command. VERSION_CONFLICT does not
 * apply: admin commands are not order commands.
 */
export function adminBasics(h: Harness, type: string, table: string, payload: () => Record<string, unknown>, setup: () => void = () => undefined): void {
  it('creates the record, then updates it in place', () => {
    setup();
    const p = payload();
    expect(h.run(type, p).result).toEqual({ id: p.id, created: true });
    expect(h.run(type, p).result).toEqual({ id: p.id, created: false });
    expect(h.count(table, `id = '${String(p.id)}'`)).toBe(1);
    expect(h.count('audit_event', `entity_id = '${String(p.id)}' AND action LIKE '%.create'`)).toBe(1);
    expect(h.count('audit_event', `entity_id = '${String(p.id)}' AND action LIKE '%.update'`)).toBe(1);
  });

  it('FORBIDDEN without the admin right, and writes nothing', () => {
    setup();
    const p = payload();
    const err = h.fail(type, p, 'FORBIDDEN', { rights: denyAll });
    expect(err.details).toEqual({ right: 'admin' });
    expect(h.count(table, `id = '${String(p.id)}'`)).toBe(0);
  });

  it('DUPLICATE replay returns the first result and writes no new audit row', () => {
    setup();
    const p = payload();
    const commandId = newId();
    const first = h.run(type, p, { commandId });
    const audits = h.count('audit_event');
    expect(h.run(type, p, { commandId })).toEqual({ ...first, duplicate: true });
    expect(h.count('audit_event')).toBe(audits);
  });

  it('works while the business day is closed (setup before opening)', () => {
    setup();
    h.db.prepare("UPDATE business_day SET closed_at = 'x'").run();
    expect(h.run(type, payload()).ok).toBe(true);
  });
}
