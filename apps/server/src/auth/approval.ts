// Manager approval by PIN (docs/07: rights with needsPin; discounts above the role limit). The PIN arrives in the
// X-Manager-Pin header and is checked against people whose own role allows the action without a PIN.
import type { Right } from '@dinepos/shared';
import { PosError } from '../core/errors.js';
import type { Db } from '../db/connection.js';
import { verifyPin } from './pin.js';

const WINDOW_MS = 60_000;
const MAX_TRIES = 5;

/**
 * Wrong manager PINs per session per minute. Kept in memory on purpose: the command that carried the PIN rolls
 * back, and the limit must hold anyway. A restart clears it (the per-user sign-in lockout is persistent).
 */
const tries = new Map<string, number[]>();

export function resetApprovalLimiter(): void {
  tries.clear();
}

function limited(key: string, now: number): boolean {
  const recent = (tries.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  tries.set(key, recent);
  return recent.length >= MAX_TRIES;
}

export interface ApprovalNeed {
  /** The approver's role must allow this right without a PIN. */
  right?: Right;
  /** The approver's role discount limit must be at least this. */
  discountBp?: number;
}

/**
 * Returns the id of the person whose PIN approves `need`, or throws PIN_REQUIRED (no PIN, wrong PIN, or nobody
 * entitled). `limiterKey` identifies the session asking.
 */
export function approveWithPin(db: Db, managerPin: string | null | undefined, need: ApprovalNeed, limiterKey: string, now: number, message: string): string {
  if (!managerPin) throw new PosError('PIN_REQUIRED', message, { ...need, reason: 'pin_missing' });
  if (limited(limiterKey, now)) {
    throw new PosError('PIN_REQUIRED', 'Too many wrong manager PINs. Wait a minute and try again.', { ...need, reason: 'too_many_tries' });
  }
  const candidates = db
    .prepare(
      `SELECT u.id, u.pin_hash FROM app_user u JOIN role r ON r.id = u.role_id
       WHERE u.active = 1 AND (u.locked_until IS NULL OR u.locked_until < ?)
         AND (? IS NULL OR EXISTS (SELECT 1 FROM role_permission p WHERE p.role_id = r.id AND p.permission = ? AND p.needs_pin = 0))
         AND r.discount_limit_bp >= ?`,
    )
    .all(new Date(now).toISOString(), need.right ?? null, need.right ?? null, need.discountBp ?? 0) as Array<{ id: string; pin_hash: string }>;
  const approver = candidates.find((c) => verifyPin(managerPin, c.pin_hash));
  if (!approver) {
    tries.set(limiterKey, [...(tries.get(limiterKey) ?? []), now]);
    throw new PosError('PIN_REQUIRED', 'That PIN cannot approve this. Ask a manager to enter theirs.', { ...need, reason: 'pin_wrong' });
  }
  return approver.id;
}
