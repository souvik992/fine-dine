import type { Db } from '../db/connection.js';

/** Who sent the command. Device and user come from auth (P2-01/P2-02); `approvedBy` from a manager PIN. */
export interface Actor {
  deviceId: string | null;
  userId: string | null;
  approvedBy?: string | null;
}

export interface AuditEntry {
  entity: string;
  entityId?: string | null;
  action: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  /** Marks the row for the leakage dashboard (docs/02-domain-model.md). */
  leakage?: boolean;
}

export interface PendingEvent {
  topics: string[];
  event: string;
  data: unknown;
}

export type PrintDocKind = 'kot' | 'bill' | 'zreport' | 'drawer' | 'test';

export interface PendingPrintJob {
  id: string;
  printerId: string;
  docKind: PrintDocKind;
  refId: string | null;
  bytes: Uint8Array;
  previewText: string | null;
}

export interface PendingOutbox {
  kind: string;
  payload: unknown;
}

/**
 * Everything a handler may touch. Writes go through `db` (already inside the command transaction);
 * side effects outside the database are only *recorded* here and happen after commit.
 */
export interface CommandContext {
  readonly db: Db;
  readonly commandId: string;
  readonly commandType: string;
  readonly actor: Actor;
  readonly businessDate: string;
  readonly timeZone: string;
  /** Server time for this command (one value per command). */
  readonly now: Date;
  readonly nowIso: string;
  audit(entry: AuditEntry): void;
  emit(topics: string | string[], event: string, data: unknown): void;
  print(job: Omit<PendingPrintJob, 'id'> & { id?: string }): string;
  outbox(kind: string, payload: unknown): void;
  /** Bumps the version of another order this command changed (e.g. the target of a merge). */
  touchOrder(orderId: string): void;
}
