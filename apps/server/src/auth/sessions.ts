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
/** Sliding expiry: a session ends 12 h after its last use. Terminals also lock themselves when idle. */
export const SESSION_HOURS = 12;

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
 * Checks a PIN with lockout: 5 wrong PINs lock that person for 5 minutes (audited). The failure count is
 * written even though sign-in fails, so guessing cannot be retried for free.
 */
export function login(db: Db, userId: string, pin: string, now: Date, deviceId: string = UNPAIRED_DEVICE_ID): LoginResult {
  const at = now.toISOString();
  const result = db
    .transaction((): LoginResult | PosError => {
      const u = db.prepare('SELECT * FROM app_user WHERE id = ?').get(userId) as UserRow | undefined;
      if (!u || u.active !== 1) return new PosError('UNAUTHENTICATED', 'Wrong name or PIN.');
      if (u.locked_until && u.locked_until > at) {
        const minutes = Math.max(1, Math.ceil((Date.parse(u.locked_until) - now.getTime()) / 60_000));
        return new PosError('UNAUTHENTICATED', `Too many wrong PINs. Try again in ${minutes} minute${minutes > 1 ? 's' : ''}, or ask a manager.`, { locked: true });
      }
      if (!verifyPin(pin, u.pin_hash)) {
        const fails = u.failed_attempts + 1;
        const lockedUntil = fails >= MAX_PIN_FAILURES ? new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString() : null;
        db.prepare('UPDATE app_user SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(lockedUntil ? 0 : fails, lockedUntil, u.id);
        audit(db, at, u.id, lockedUntil ? 'auth.lock' : 'auth.fail', { fails });
        return new PosError('UNAUTHENTICATED', lockedUntil ? `Too many wrong PINs. ${u.name} is locked for ${LOCK_MINUTES} minutes.` : 'Wrong name or PIN.', {
          locked: lockedUntil !== null,
          attemptsLeft: lockedUntil ? 0 : MAX_PIN_FAILURES - fails,
        });
      }
      db.prepare('UPDATE app_user SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(u.id);
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now.getTime() + SESSION_HOURS * 3_600_000).toISOString();
      db.prepare('INSERT INTO user_session (token_hash, user_id, device_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(
        tokenHash(token),
        u.id,
        deviceId,
        at,
        expiresAt,
      );
      db.prepare('DELETE FROM user_session WHERE expires_at < ?').run(at); // housekeeping
      audit(db, at, u.id, 'auth.login', {});
      return { token, ...sessionInfo(db, u.id, expiresAt) };
    })
    .immediate();
  if (result instanceof PosError) throw result;
  return result;
}

/** The signed-in user for a session token, extending its expiry. Throws UNAUTHENTICATED. */
export function resolveSession(db: Db, token: string | undefined, now: Date): SessionInfo {
  if (!token) throw new PosError('UNAUTHENTICATED', 'Please sign in.');
  const at = now.toISOString();
  const row = db
    .prepare(
      `SELECT s.user_id, s.expires_at FROM user_session s JOIN app_user u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
    )
    .get(tokenHash(token), at) as { user_id: string; expires_at: string } | undefined;
  if (!row) throw new PosError('UNAUTHENTICATED', 'Your session has ended. Please sign in again.');
  const expiresAt = new Date(now.getTime() + SESSION_HOURS * 3_600_000).toISOString();
  db.prepare('UPDATE user_session SET expires_at = ? WHERE token_hash = ?').run(expiresAt, tokenHash(token));
  return sessionInfo(db, row.user_id, expiresAt);
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
