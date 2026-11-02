import { upsertUserSchema } from '@dinepos/shared';
import { hashPin, verifyPin } from '../auth/pin.js';
import { endSessionsOf } from '../auth/sessions.js';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import type { Db } from '../db/connection.js';
import { requireRef } from './admin-support.js';

interface UserRow {
  id: string;
  name: string;
  role_id: string;
  pin_hash: string;
  active: number;
}

/** People who can still manage staff (users.manage without a PIN) if `change` is applied. */
function managersAfter(db: Db, change: { id: string; roleId: string; active: boolean }): number {
  const rows = db
    .prepare(
      `SELECT u.id, u.role_id, u.active FROM app_user u
       JOIN role_permission p ON p.role_id = u.role_id AND p.permission = 'users.manage' AND p.needs_pin = 0`,
    )
    .all() as Array<{ id: string; role_id: string; active: number }>;
  const canManage = db.prepare(`SELECT 1 FROM role_permission WHERE role_id = ? AND permission = 'users.manage' AND needs_pin = 0`).get(change.roleId) !== undefined;
  const others = rows.filter((r) => r.id !== change.id && r.active === 1).length;
  return others + (change.active && canManage ? 1 : 0);
}

/**
 * Adds or changes a staff member (docs/07). Names are unique among active staff and PINs unique per outlet. A new
 * PIN also clears a lockout. Changing the PIN, role or active flag signs the person out everywhere. Nobody can
 * deactivate themselves or change their own role, and the last person who can manage staff is protected.
 */
export const upsertUser = defineCommand({
  type: 'UpsertUser',
  schema: upsertUserSchema,
  right: 'users.manage',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    const { db } = ctx;
    requireRef(db, 'role', p.roleId, 'roleId');
    const before = db.prepare('SELECT id, name, role_id, pin_hash, active FROM app_user WHERE id = ?').get(p.id) as UserRow | undefined;
    if (!before && !p.pin) throw new PosError('VALIDATION', 'A new person needs a PIN.', [{ path: 'pin', message: 'required for a new person' }]);

    if (p.active) {
      const clash = db.prepare('SELECT 1 FROM app_user WHERE active = 1 AND name = ? COLLATE NOCASE AND id <> ?').get(p.name, p.id);
      if (clash) throw new PosError('INVALID_STATE', `Someone called ${p.name} is already on the staff list. Add a surname or initial.`);
    }
    if (p.pin) {
      const others = db.prepare('SELECT pin_hash FROM app_user WHERE id <> ? AND active = 1').pluck().all(p.id) as string[];
      if (others.some((h) => verifyPin(p.pin!, h))) throw new PosError('INVALID_STATE', 'Another person already uses this PIN. Choose a different one.');
    }
    if (before && ctx.actor.userId === p.id && (!p.active || p.roleId !== before.role_id)) {
      throw new PosError('INVALID_STATE', 'You cannot deactivate yourself or change your own role. Ask another owner.');
    }
    if (managersAfter(db, { id: p.id, roleId: p.roleId, active: p.active }) === 0) {
      throw new PosError('INVALID_STATE', 'At least one active person must be able to manage staff.');
    }

    const pinHash = p.pin ? hashPin(p.pin) : before!.pin_hash;
    if (before) {
      db.prepare('UPDATE app_user SET name = ?, role_id = ?, pin_hash = ?, active = ?' + (p.pin ? ', failed_attempts = 0, locked_until = NULL' : '') + ' WHERE id = ?').run(
        p.name,
        p.roleId,
        pinHash,
        p.active ? 1 : 0,
        p.id,
      );
      if (p.pin || !p.active || p.roleId !== before.role_id) endSessionsOf(db, p.id);
    } else {
      db.prepare('INSERT INTO app_user (id, name, role_id, pin_hash, active) VALUES (?, ?, ?, ?, ?)').run(p.id, p.name, p.roleId, pinHash, p.active ? 1 : 0);
    }

    ctx.audit({
      entity: 'user',
      entityId: p.id,
      action: before ? 'user.update' : 'user.create',
      // Never the PIN or its hash.
      before: before ? { name: before.name, roleId: before.role_id, active: before.active === 1 } : undefined,
      after: { name: p.name, roleId: p.roleId, active: p.active, pinChanged: Boolean(p.pin) },
    });
    ctx.emit('system', 'staff.changed', { userId: p.id });
    return { result: { id: p.id, created: !before } };
  },
});
