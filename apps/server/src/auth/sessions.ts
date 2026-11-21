// Staff sign-in and sessions (docs/07 "Users and PINs"). Sign-in is not a POS command (docs/03 lists
// POST /v1/sessions); it still writes its audit rows inside one transaction.
import { createHash, randomBytes } from 'node:crypto';
import { RIGHTS, UNPAIRED_DEVICE_ID, type LoginResult, type RoleRight, type SessionInfo, type SetupState } from '@dinepos/shared';
import { PosError } from '../core/errors.js';
import { getConfig } from '../core/outlet-config.js';
import type { Db } from '../db/connection.js';
import { verifyPin } from './pin.js';

export const MAX_PIN_FAILURES = 5;
export const LOCK_MINUTES = 5;
/**
 * Sign-ins never end with time (the owner's choice, as in Tiffin POS: a busy counter must not lose its cashier).
 * Only Sign out, deactivating the person or changing their PIN or role ends one. `expires_at` holds this sentinel.
 */
export const NEVER_EXPIRES = '9999-12-31T23:59:59.999Z';

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

interface UserRow {
  id: string;
  name: string;
  role_id: string;
  pin_hash: string;
  active: number;
  failed_attempts: number;
  locked_until: string | null;
}

function audit(db: Db, at: string, userId: string | null, action: string, after: unknown): void {
  db.prepare(`INSERT INTO audit_event (ts, user_id, device_id, entity, entity_id, action, after_json) VALUES (?, ?, ?, 'user', ?, ?, ?)`).run(
    at,
    userId,
    UNPAIRED_DEVICE_ID,
    userId,
    action,
    JSON.stringify(after),
  );
}

export function staffCount(db: Db): number {
  return db.prepare('SELECT count(*) FROM app_user').pluck().get() as number;
}

export function setupState(db: Db): SetupState {
  const users = db
    .prepare(`SELECT u.id, u.name, r.name AS roleName FROM app_user u JOIN role r ON r.id = u.role_id WHERE u.active = 1 ORDER BY u.name COLLATE NOCASE`)
    .all() as SetupState['users'];
  return { setupNeeded: staffCount(db) === 0, outletName: getConfig(db)['outlet.name'], users };
}

export function roleRights(db: Db, roleId: string): RoleRight[] {
  const rows = db.prepare('SELECT permission, needs_pin FROM role_permission WHERE role_id = ?').all(roleId) as Array<{ permission: string; needs_pin: number }>;
  const order = new Map(RIGHTS.map((r, i) => [r as string, i]));
  return rows
    .filter((r) => order.has(r.permission))
    .sort((a, b) => order.get(a.permission)! - order.get(b.permission)!)
    .map((r) => ({ right: r.permission as RoleRight['right'], needsPin: r.needs_pin === 1 }));
}

function sessionInfo(db: Db, userId: string, expiresAt: string): SessionInfo {
  const u = db
    .prepare('SELECT u.id, u.name, u.role_id, r.name AS role_name, r.discount_limit_bp FROM app_user u JOIN role r ON r.id = u.role_id WHERE u.id = ?')
    .get(userId) as { id: string; name: string; role_id: string; role_name: string; discount_limit_bp: number };
  return {
    user: { id: u.id, name: u.name, roleId: u.role_id, roleName: u.role_name },
    rights: roleRights(db, u.role_id),
    discountLimitBp: u.discount_limit_bp,
    expiresAt,
  };
}

/**
 * Checks a person's PIN with lockout: 5 wrong PINs lock that person for 5 minutes (audited). The failure count is
 * written even though the check fails, so guessing cannot be retried for free. Call inside a transaction; returns the
 * error to throw after it commits, or null when the PIN is right (the failure count is then cleared).
 */
function checkPin(db: Db, u: UserRow, pin: string, now: Date, wrongPin = 'Wrong name or PIN.'): PosError | null {
  const at = now.toISOString();
  if (u.locked_until && u.locked_until > at) {
    const minutes = Math.max(1, Math.ceil((Date.parse(u.locked_until) - now.getTime()) / 60_000));
    return new PosError('UNAUTHENTICATED', `Too many wrong PINs. Try again in ${minutes} minute${minutes > 1 ? 's' : ''}, or ask a manager.`, { locked: true });
  }
  if (!verifyPin(pin, u.pin_hash)) {
    const fails = u.failed_attempts + 1;
    const lockedUntil = fails >= MAX_PIN_FAILURES ? new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString() : null;
    db.prepare('UPDATE app_user SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(lockedUntil ? 0 : fails, lockedUntil, u.id);
    audit(db, at, u.id, lockedUntil ? 'auth.lock' : 'auth.fail', { fails });
    return new PosError('UNAUTHENTICATED', lockedUntil ? `Too many wrong PINs. ${u.name} is locked for ${LOCK_MINUTES} minutes.` : wrongPin, {
      locked: lockedUntil !== null,
      attemptsLeft: lockedUntil ? 0 : MAX_PIN_FAILURES - fails,
    });
  }
  db.prepare('UPDATE app_user SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(u.id);
  return null;
}

/**
 * Signs in after checking the PIN (see checkPin).
 */
export function login(db: Db, userId: string, pin: string, now: Date, deviceId: string = UNPAIRED_DEVICE_ID): LoginResult {
  const at = now.toISOString();
  const result = db
    .transaction((): LoginResult | PosError => {
      const u = db.prepare('SELECT * FROM app_user WHERE id = ?').get(userId) as UserRow | undefined;
      if (!u || u.active !== 1) return new PosError('UNAUTHENTICATED', 'Wrong name or PIN.');
      const refused = checkPin(db, u, pin, now);
      if (refused) return refused;
      const token = randomBytes(32).toString('base64url');
      const expiresAt = NEVER_EXPIRES;
      db.prepare('INSERT INTO user_session (token_hash, user_id, device_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(
        tokenHash(token),
        u.id,
        deviceId,
        at,
        expiresAt,
      );
      db.prepare('DELETE FROM user_session WHERE expires_at < ?').run(at); // housekeeping (sessions from before sign-ins stopped expiring)
      audit(db, at, u.id, 'auth.login', {});
      return { token, ...sessionInfo(db, u.id, expiresAt) };
    })
    .immediate();
  if (result instanceof PosError) throw result;
  return result;
}

/** The signed-in user for a session token. Throws UNAUTHENTICATED. */
export function resolveSession(db: Db, token: string | undefined, now: Date): SessionInfo {
  if (!token) throw new PosError('UNAUTHENTICATED', 'Please sign in.');
  const at = now.toISOString();
  const row = db
    .prepare(
      `SELECT s.user_id, s.expires_at, s.locked_at, u.name FROM user_session s JOIN app_user u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
    )
    .get(tokenHash(token), at) as { user_id: string; expires_at: string; locked_at: string | null; name: string } | undefined;
  if (!row) throw new PosError('UNAUTHENTICATED', 'Your session has ended. Please sign in again.');
  if (row.locked_at) throw new PosError('UNAUTHENTICATED', `Locked. ${row.name}, enter your PIN to continue.`, { sessionLocked: true, userId: row.user_id, name: row.name });
  // A session from before sign-ins stopped expiring is kept from now on.
  if (row.expires_at !== NEVER_EXPIRES) db.prepare('UPDATE user_session SET expires_at = ? WHERE token_hash = ?').run(NEVER_EXPIRES, tokenHash(token));
  return sessionInfo(db, row.user_id, NEVER_EXPIRES);
}

/** The Lock button: the sign-in stays, but every request is refused until unlockSession (audited `auth.session_lock`). */
export function lockSession(db: Db, token: string | undefined, now: Date): void {
  resolveSession(db, token, now); // a signed-in, unlocked session only
  const at = now.toISOString();
  db.transaction(() => {
    const row = db.prepare('SELECT user_id FROM user_session WHERE token_hash = ?').get(tokenHash(token!)) as { user_id: string };
    db.prepare('UPDATE user_session SET locked_at = ? WHERE token_hash = ?').run(at, tokenHash(token!));
    audit(db, at, row.user_id, 'auth.session_lock', {});
  }).immediate();
}

/**
 * Unlocks with the PIN of the person who is signed in (same lockout as sign-in). Also accepts an unlocked session, so
 * a terminal that locked itself while the server was out of reach can continue.
 */
export function unlockSession(db: Db, token: string | undefined, pin: string, now: Date): SessionInfo {
  if (!token) throw new PosError('UNAUTHENTICATED', 'Please sign in.');
  const at = now.toISOString();
  const result = db
    .transaction((): PosError | null => {
      const row = db
        .prepare('SELECT s.user_id, s.locked_at FROM user_session s WHERE s.token_hash = ? AND s.expires_at > ?')
        .get(tokenHash(token), at) as { user_id: string; locked_at: string | null } | undefined;
      const u = row && (db.prepare('SELECT * FROM app_user WHERE id = ?').get(row.user_id) as UserRow | undefined);
      if (!row || !u || u.active !== 1) return new PosError('UNAUTHENTICATED', 'Your session has ended. Please sign in again.', { sessionEnded: true });
      const refused = checkPin(db, u, pin, now, 'Wrong PIN. Try again.');
      if (refused) return refused;
      if (row.locked_at) {
        db.prepare('UPDATE user_session SET locked_at = NULL WHERE token_hash = ?').run(tokenHash(token));
        audit(db, at, u.id, 'auth.unlock', {});
      }
      return null;
    })
    .immediate();
  if (result) throw result;
  return resolveSession(db, token, now);
}

export function logout(db: Db, token: string | undefined, now: Date): void {
  if (!token) return;
  db.transaction(() => {
    const row = db.prepare('SELECT user_id FROM user_session WHERE token_hash = ?').get(tokenHash(token)) as { user_id: string } | undefined;
    if (!row) return;
    db.prepare('DELETE FROM user_session WHERE token_hash = ?').run(tokenHash(token));
    audit(db, now.toISOString(), row.user_id, 'auth.logout', {});
  }).immediate();
}

/** Ends every session of a person (PIN changed, deactivated, role changed). Call inside the command transaction. */
export function endSessionsOf(db: Db, userId: string): void {
  db.prepare('DELETE FROM user_session WHERE user_id = ?').run(userId);
}
