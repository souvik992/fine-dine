import { ulidSchema } from '@dinepos/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireRight } from '../auth/require-right.js';
import { PosError } from '../core/errors.js';
import type { Db } from '../db/connection.js';
import { getPurchase, listPurchases, listRecipes, listStock, recentSuppliers, stockMovements, stockUsage } from '../queries/stock.js';

const page = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }).strict();
const usage = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .strict()
  .refine((q) => q.from <= q.to, { message: 'from must not be after to' });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new PosError('VALIDATION', 'Invalid query.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

/** Stock reads (docs/03 "Stock queries"): signed-in users with the stock.manage right. */
export function stockRoutes(app: FastifyInstance, deps: { db: Db; now: () => Date }): void {
  const { db, now } = deps;
  const guard = (req: FastifyRequest) => requireRight(db, req, 'stock.manage', now());
  const noStore = { 'cache-control': 'no-store' };

  app.get('/v1/stock', (req, reply) => {
    guard(req);
    return reply.headers(noStore).send({ items: listStock(db) });
  });

  app.get<{ Params: { id: string } }>('/v1/stock/:id/movements', (req, reply) => {
    guard(req);
    const id = parse(ulidSchema, req.params.id);
    const { limit } = parse(page, req.query);
    return reply.headers(noStore).send({ movements: stockMovements(db, id, limit) });
  });

  app.get('/v1/stock/usage', (req, reply) => {
    guard(req);
    const q = parse(usage, req.query);
    return reply.headers(noStore).send({ from: q.from, to: q.to, rows: stockUsage(db, q.from, q.to) });
  });

  app.get('/v1/purchases', (req, reply) => {
    guard(req);
    const q = parse(page, req.query);
    return reply.headers(noStore).send({ purchases: listPurchases(db, q.limit, q.offset), suppliers: recentSuppliers(db) });
  });

  app.get<{ Params: { id: string } }>('/v1/purchases/:id', (req, reply) => {
    guard(req);
    const purchase = getPurchase(db, parse(ulidSchema, req.params.id));
    if (!purchase) throw new PosError('NOT_FOUND', 'Purchase not found.', { purchaseId: req.params.id });
    return reply.headers(noStore).send(purchase);
  });

  app.get('/v1/recipes', (req, reply) => {
    guard(req);
    return reply.headers(noStore).send({ lines: listRecipes(db) });
  });
}
