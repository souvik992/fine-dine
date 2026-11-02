import { loginSchema, type RoleInfo, type StaffMember } from '@dinepos/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { login, logout, resolveSession, roleRights, setupState } from '../auth/sessions.js';
import { PosError } from '../core/errors.js';
import { getAdminCatalog } from '../queries/admin-catalog.js';
import type { Db } from '../db/connection.js';

const token = (req: FastifyRequest) => {
  const v = req.headers['x-user-session'];
  return typeof v === 'string' && v ? v : undefined;
};

export function sessionRoutes(app: FastifyInstance, deps: { db: Db; now: () => Date }): void {
  const { db, now } = deps;
  const noStore = { 'cache-control': 'no-store' };

  /** Public: what the terminal shows before sign-in (first-run setup, or the staff list). No PINs or hashes. */
  app.get('/v1/setup-state', (_req, reply) => reply.headers(noStore).send(setupState(db)));

  app.post('/v1/sessions', (req, reply) => {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) throw new PosError('VALIDATION', 'Choose your name and type your PIN (4 to 6 digits).');
    return reply.headers(noStore).send(login(db, body.data.userId, body.data.pin, now()));
  });

  app.get('/v1/session', (req, reply) => reply.headers(noStore).send(resolveSession(db, token(req), now())));

  app.delete('/v1/session', (req, reply) => {
    logout(db, token(req), now());
    return reply.status(204).send();
  });

  /** Settings reads need a session whose role has the right without a PIN. */
  const requireRight = (req: FastifyRequest, right: 'users.manage' | 'admin') => {
    const s = resolveSession(db, token(req), now());
    if (!s.rights.some((r) => r.right === right && !r.needsPin)) {
      throw new PosError('FORBIDDEN', `You do not have the "${right}" right.`, { right });
    }
  };
  const requireManageStaff = (req: FastifyRequest) => requireRight(req, 'users.manage');

  /** Everything the menu, floor and printer settings edit (inactive items included). */
  app.get('/v1/admin/catalog', (req, reply) => {
    requireRight(req, 'admin');
    return reply.headers(noStore).send(getAdminCatalog(db));
  });

  app.get('/v1/staff', (req, reply) => {
    requireManageStaff(req);
    const at = now().toISOString();
    const rows = db
      .prepare(
        `SELECT u.id, u.name, u.role_id AS roleId, r.name AS roleName, u.active, u.locked_until
         FROM app_user u JOIN role r ON r.id = u.role_id ORDER BY u.active DESC, u.name COLLATE NOCASE`,
      )
      .all() as Array<{ id: string; name: string; roleId: string; roleName: string; active: number; locked_until: string | null }>;
    const staff: StaffMember[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      roleId: r.roleId,
      roleName: r.roleName,
      active: r.active === 1,
      locked: r.locked_until !== null && r.locked_until > at,
    }));
    return reply.headers(noStore).send({ staff });
  });

  app.get('/v1/roles', (req, reply) => {
    requireManageStaff(req);
    const rows = db
      .prepare(`SELECT r.id, r.name, r.discount_limit_bp, (SELECT count(*) FROM app_user u WHERE u.role_id = r.id AND u.active = 1) AS members FROM role r ORDER BY r.rowid`)
      .all() as Array<{ id: string; name: string; discount_limit_bp: number; members: number }>;
    const roles: RoleInfo[] = rows.map((r) => ({ id: r.id, name: r.name, discountLimitBp: r.discount_limit_bp, members: r.members, rights: roleRights(db, r.id) }));
    return reply.headers(noStore).send({ roles });
  });
}
