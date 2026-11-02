import type { Right } from '@dinepos/shared';
import { approveWithPin } from '../auth/approval.js';
import type { Actor } from './context.js';
import type { Db } from '../db/connection.js';
import { PosError } from './errors.js';

export interface RightsCheck {
  db: Db;
  actor: Actor;
  right: Right;
  commandType: string;
}

/**
 * Decides whether the actor may run a command. Throw FORBIDDEN (no right) or PIN_REQUIRED (needs a
 * manager PIN); return the approving user's id when a PIN was accepted.
 */
export interface RightsPolicy {
  check(input: RightsCheck): { approvedBy?: string | null } | void;
}

/** Grants every right. Tests and tools only; the server uses `roleRights`. */
export const allowAllRights: RightsPolicy = {
  check: () => undefined,
};

/**
 * Role-based rights (docs/07): the signed-in user's role must have the right. A right marked "needs PIN" for the
 * role is allowed only with the PIN of someone whose role has it without a PIN.
 */
export const roleRights: RightsPolicy = {
  check({ db, actor, right }) {
    if (!actor.userId) throw new PosError('UNAUTHENTICATED', 'Please sign in.');
    const row = db
      .prepare(
        `SELECT p.needs_pin FROM app_user u JOIN role_permission p ON p.role_id = u.role_id
         WHERE u.id = ? AND u.active = 1 AND p.permission = ?`,
      )
      .get(actor.userId, right) as { needs_pin: number } | undefined;
    if (!row) throw forbidden(right);
    if (row.needs_pin === 0) return undefined;
    const approvedBy = approveWithPin(db, actor.managerPin, { right }, actor.sessionKey ?? 'no-session', Date.now(), 'A manager PIN is required for this action.');
    return { approvedBy };
  },
};

export function forbidden(right: Right): PosError {
  return new PosError('FORBIDDEN', `You do not have the "${right}" right.`, { right });
}

export function pinRequired(right: Right): PosError {
  return new PosError('PIN_REQUIRED', 'A manager PIN is required for this action.', { right });
}
