import type { Right } from '@dinepos/shared';
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
 * manager PIN); return the approving user's id when a PIN was accepted. Real roles land in P2-01.
 */
export interface RightsPolicy {
  check(input: RightsCheck): { approvedBy?: string | null } | void;
}

/** Phase 1 single-terminal mode: every right is granted. Replaced by role rights in P2-01. */
export const allowAllRights: RightsPolicy = {
  check: () => undefined,
};

export function forbidden(right: Right): PosError {
  return new PosError('FORBIDDEN', `You do not have the "${right}" right.`, { right });
}

export function pinRequired(right: Right): PosError {
  return new PosError('PIN_REQUIRED', 'A manager PIN is required for this action.', { right });
}
