import { OWNER_ROLE_ID, upsertRoleSchema } from '@dinepos/shared';
import { roleRights } from '../auth/sessions.js';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';

/**
 * Adds or changes a role: name, discount limit and its rights (each allowed, optionally only with a manager PIN).
 * Rights are read on every request, so changes apply at once. The Owner role always keeps "manage staff" without a
 * PIN, so nobody can lock the outlet out of its own settings.
 */
export const upsertRole = defineCommand({
  type: 'UpsertRole',
  schema: upsertRoleSchema,
  right: 'users.manage',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    const { db } = ctx;
    if (p.id === OWNER_ROLE_ID && !p.rights.some((r) => r.right === 'users.manage' && !r.needsPin)) {
      throw new PosError('INVALID_STATE', 'The Owner role must keep "Manage staff, PINs and roles" without a PIN.');
    }
    const clash = db.prepare('SELECT 1 FROM role WHERE name = ? COLLATE NOCASE AND id <> ?').get(p.name, p.id);
    if (clash) throw new PosError('INVALID_STATE', `A role called ${p.name} already exists.`);

    const before = db.prepare('SELECT name, discount_limit_bp FROM role WHERE id = ?').get(p.id) as { name: string; discount_limit_bp: number } | undefined;
    const beforeRights = before ? roleRights(db, p.id) : [];
    db.prepare(
      'INSERT INTO role (id, name, discount_limit_bp) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, discount_limit_bp = excluded.discount_limit_bp',
    ).run(p.id, p.name, p.discountLimitBp);
    db.prepare('DELETE FROM role_permission WHERE role_id = ?').run(p.id);
    const ins = db.prepare('INSERT INTO role_permission (role_id, permission, needs_pin) VALUES (?, ?, ?)');
    for (const r of p.rights) ins.run(p.id, r.right, r.needsPin ? 1 : 0);

    ctx.audit({
      entity: 'role',
      entityId: p.id,
      action: before ? 'role.update' : 'role.create',
      before: before ? { name: before.name, discountLimitBp: before.discount_limit_bp, rights: beforeRights } : undefined,
      after: { name: p.name, discountLimitBp: p.discountLimitBp, rights: p.rights },
    });
    ctx.emit('system', 'staff.changed', { roleId: p.id });
    return { result: { id: p.id, created: !before } };
  },
});
