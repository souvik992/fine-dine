import type { LicenceGate } from '../licence/gate.js';
import type { Right } from '@dinepos/shared';
import type { Db } from '../db/connection.js';

/** Who sent the command. Device and user come from auth (P2-01/P2-02); `approvedBy` from a manager PIN. */
/**
 * P4-02: what kind of device sent the request; `master` = the master PC itself (loopback). `system` = the server's own
 * order-hub connector (P4-06): never set from an HTTP request.
 */
export type DeviceKind = 'terminal' | 'captain' | 'kds' | 'master' | 'system' | 'addon';

export interface Actor {
  deviceId: string | null;
  /** Lets a kitchen screen act without a staff session (DEVICE_RIGHTS). */
  deviceKind?: DeviceKind | null;
  userId: string | null;
  approvedBy?: string | null;
  /** X-Manager-Pin of this request. Checked by approval only; never logged or stored. */
  managerPin?: string | null;
  /** Identifies the session for the wrong-manager-PIN limiter (a hash, not the token). */
  sessionKey?: string | null;
  /** P5-01: an add-on's own actor (made by the server, never sent by a client) and the rights its signed manifest lists. */
  addonId?: string;
  addonRights?: readonly Right[];
}

/** What a manager's PIN must cover (see auth/approval.ts). */
export interface ApprovalRequest {
  right?: Right;
  discountBp?: number;
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
  /** P2-09: may a new business date open; seats; verifying a key. */
  readonly licence: LicenceGate;
  /** P6-04: a hosted outlet (its server runs in DinePOS Cloud): there is no master PC. */
  readonly hosted: boolean;
  audit(entry: AuditEntry): void;
  emit(topics: string | string[], event: string, data: unknown): void;
  print(job: Omit<PendingPrintJob, 'id'> & { id?: string }): string;
  outbox(kind: string, payload: unknown): void;
  /** Bumps the version of another order this command changed (e.g. the target of a merge). */
  touchOrder(orderId: string): void;
  /**
   * Requires a manager's PIN (X-Manager-Pin) covering `need`; throws PIN_REQUIRED otherwise. The approver is
   * recorded on every audit row of this command. Returns the approver's user id.
   */
  approve(need: ApprovalRequest, message: string): string;
}
