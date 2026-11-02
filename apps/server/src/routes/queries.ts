import { ulidSchema } from '@dinepos/shared';
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

  // Outlet and billing settings (nothing secret is stored here).
  app.get('/v1/config', (_req, reply) => {
    void reply.header('cache-control', 'no-store').send(getConfig(deps.db));
    return reply;
  });

  app.get('/v1/printers', (_req, reply) => {
    void reply.header('cache-control', 'no-store').send({ printers: getPrinters(deps.db, deps.printerStatus) });
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
