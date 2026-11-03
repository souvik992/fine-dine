import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRight } from '../auth/require-right.js';
import { currentBusinessDate } from '../core/business-day.js';
import { PosError } from '../core/errors.js';
import type { Db } from '../db/connection.js';
import { auditPage, LEAKAGE_CARDS, leakageSummary } from '../reports/audit.js';
import { REPORTS, runReport } from '../reports/catalog.js';

const rangeQuery = z.object({ from: z.string().optional(), to: z.string().optional() }).strict();
const auditQuery = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    leakage: z.enum(['0', '1']).optional(),
    card: z.string().max(40).optional(),
    before: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();

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

  /** P4-01: the leakage cards for the dates (default today). */
  app.get('/v1/leakage', (req, reply) => {
    requireRight(db, req, 'reports.view', now());
    const q = rangeQuery.safeParse(req.query);
    if (!q.success) throw new PosError('VALIDATION', 'Use from and to (YYYY-MM-DD).');
    const today = currentBusinessDate(db) ?? '';
    const from = q.data.from ?? today;
    const to = q.data.to ?? from;
    return reply.headers(noStore).send({ from, to, ...leakageSummary(db, from, to, timeZone) });
  });

  /** P4-01 (docs/03 `/v1/audit?from=&to=&leakage=1`): the audit log, newest first, by pages; `card` drills into a leakage card. */
  app.get('/v1/audit', (req, reply) => {
    requireRight(db, req, 'reports.view', now());
    const q = auditQuery.safeParse(req.query);
    if (!q.success) throw new PosError('VALIDATION', 'Invalid audit query.');
    const today = currentBusinessDate(db) ?? '';
    const from = q.data.from ?? today;
    const card = q.data.card ? LEAKAGE_CARDS.find((c) => c.key === q.data.card) : undefined;
    if (q.data.card && !card) throw new PosError('NOT_FOUND', 'No such leakage card.');
    const page = auditPage(db, { from, to: q.data.to ?? from, leakageOnly: q.data.leakage === '1' || !!card, actions: card ? [...card.actions] : undefined, before: q.data.before, limit: q.data.limit }, timeZone);
    return reply.headers(noStore).send({ from, to: q.data.to ?? from, ...page });
  });
}
