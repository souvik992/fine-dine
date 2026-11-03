import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRight } from '../auth/require-right.js';
import { currentBusinessDate } from '../core/business-day.js';
import { PosError } from '../core/errors.js';
import type { Db } from '../db/connection.js';
import { REPORTS, runReport } from '../reports/catalog.js';

const rangeQuery = z.object({ from: z.string().optional(), to: z.string().optional() }).strict();

/** Reports (P4-03, docs/03 `/v1/reports/:name?from=&to=`): the list, and one report over business dates. reports.view. */
export function reportRoutes(app: FastifyInstance, deps: { db: Db; now: () => Date; timeZone: string }): void {
  const { db, now, timeZone } = deps;
  const noStore = { 'cache-control': 'no-store' };

  app.get('/v1/reports', (req, reply) => {
    requireRight(db, req, 'reports.view', now());
    return reply.headers(noStore).send({ reports: REPORTS, businessDate: currentBusinessDate(db) });
  });

  app.get<{ Params: { key: string } }>('/v1/reports/:key', (req, reply) => {
    requireRight(db, req, 'reports.view', now());
    const q = rangeQuery.safeParse(req.query);
    if (!q.success) throw new PosError('VALIDATION', 'Use from and to (YYYY-MM-DD).');
    const today = currentBusinessDate(db) ?? '';
    return reply.headers(noStore).send(runReport(db, req.params.key, q.data.from ?? today, q.data.to ?? q.data.from ?? today, timeZone));
  });
}
