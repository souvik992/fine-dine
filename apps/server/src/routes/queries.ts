import { ulidSchema, type CaptainSection, type CaptainSections } from '@dinepos/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PosError } from '../core/errors.js';
import { getConfig } from '../core/outlet-config.js';
import type { Db } from '../db/connection.js';
import { getFloor } from '../queries/floor.js';
import { getMenu } from '../queries/menu.js';
import { getOrderSnapshot } from '../queries/order-snapshot.js';
import { getPrinters } from '../queries/printers.js';
import type { PrinterStatus } from '../print/print-queue.js';

export interface QueryDeps {
  db: Db;
  timeZone: string;
  now: () => Date;
  printerStatus?: (printerId: string) => PrinterStatus | undefined;
}

const menuQuery = z
  .object({ areaId: ulidSchema.optional(), since: z.coerce.number().int().min(0).optional() })
  .strict();

export function queryRoutes(app: FastifyInstance, deps: QueryDeps): void {
  app.get('/v1/floor', (_req, reply) => {
    void reply.header('cache-control', 'no-store').send(getFloor(deps.db, deps.now(), deps.timeZone));
    return reply;
  });

  app.get<{ Params: { id: string } }>('/v1/orders/:id', (req, reply) => {
    if (!ulidSchema.safeParse(req.params.id).success) throw new PosError('VALIDATION', 'Order id must be a ULID.');
    const order = getOrderSnapshot(deps.db, req.params.id);
    if (!order) throw new PosError('NOT_FOUND', 'Order not found.', { orderId: req.params.id });
    void reply.header('cache-control', 'no-store').send(order);
    return reply;
  });

  // P3-04: every captain's section and who can have one (Settings › Captain sections; the floor carries them per table).
  app.get('/v1/captain-sections', (_req, reply) => {
    const rows = deps.db.prepare('SELECT user_id, area_id, table_id FROM captain_section ORDER BY user_id').all() as Array<{ user_id: string; area_id: string | null; table_id: string | null }>;
    const byUser = new Map<string, CaptainSection>();
    for (const r of rows) {
      const s = byUser.get(r.user_id) ?? { userId: r.user_id, areaIds: [], tableIds: [] };
      if (r.area_id) s.areaIds.push(r.area_id);
      if (r.table_id) s.tableIds.push(r.table_id);
      byUser.set(r.user_id, s);
    }
    const people = deps.db
      .prepare(
        `SELECT u.id, u.name, r.name AS roleName FROM app_user u JOIN role r ON r.id = u.role_id
         WHERE u.active = 1 AND EXISTS (SELECT 1 FROM role_permission p WHERE p.role_id = u.role_id AND p.permission = 'order.create')
         ORDER BY u.name COLLATE NOCASE`,
      )
      .all() as CaptainSections['people'];
    const body: CaptainSections = { sections: [...byUser.values()], people };
    void reply.header('cache-control', 'no-store').send(body);
    return reply;
  });

  // Outlet and billing settings (nothing secret is stored here).
  app.get('/v1/config', (_req, reply) => {
    void reply.header('cache-control', 'no-store').send(getConfig(deps.db));
    return reply;
  });

  app.get('/v1/printers', (_req, reply) => {
    void reply.header('cache-control', 'no-store').send({ printers: getPrinters(deps.db, deps.printerStatus, deps.now()) });
    return reply;
  });

  app.get('/v1/menu', (req, reply) => {
    const q = menuQuery.safeParse(req.query);
    if (!q.success) {
      throw new PosError('VALIDATION', 'Invalid menu query.', q.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    void reply.header('cache-control', 'no-store').send(getMenu(deps.db, q.data));
    return reply;
  });
}
