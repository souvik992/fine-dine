import type { CashMovementView, DayBill } from '@dinepos/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRight } from '../auth/require-right.js';
import { currentBusinessDate } from '../core/business-day.js';
import { PosError } from '../core/errors.js';
import type { Db } from '../db/connection.js';

const dateQuery = z.object({ date: z.iso.date().optional() }).strict();

/** Today's bills and cash (P2-06): for the cashier's "Bills" and "Cash" screens. Needs the bill.settle right. */
export function cashierRoutes(app: FastifyInstance, deps: { db: Db; now: () => Date }): void {
  const { db, now } = deps;
  const dateOf = (query: unknown): string => {
    const q = dateQuery.safeParse(query);
    if (!q.success) throw new PosError('VALIDATION', 'date must be YYYY-MM-DD.');
    return q.data.date ?? currentBusinessDate(db) ?? '';
  };

  app.get('/v1/bills', (req, reply) => {
    requireRight(db, req, 'bill.settle', now());
    const date = dateOf(req.query);
    const rows = db
      .prepare(
        `SELECT b.id, b.order_id, o.version, o.state AS order_state, COALESCE(t.label, 'Takeaway') AS tbl, b.split_of, b.total_paise, b.state, b.printed_at,
                (SELECT d.bill_no_text FROM bill_document d WHERE d.bill_id = b.id ORDER BY d.revision DESC LIMIT 1) AS bill_no_text,
                (SELECT count(*) FROM bill x WHERE x.order_id = b.order_id AND x.state <> 'superseded' AND (x.fy < b.fy OR (x.fy = b.fy AND x.bill_no <= b.bill_no))) AS part_no
         FROM bill b JOIN "order" o ON o.id = b.order_id LEFT JOIN dining_table t ON t.id = o.table_id
         WHERE o.business_date = ? AND b.bill_no IS NOT NULL ORDER BY b.fy DESC, b.bill_no DESC`,
      )
      .all(date) as Array<{
      id: string;
      order_id: string;
      version: number;
      order_state: string;
      tbl: string;
      split_of: number;
      total_paise: number;
      state: DayBill['state'];
      printed_at: string | null;
      bill_no_text: string | null;
      part_no: number;
    }>;
    const paymentsOf = db.prepare('SELECT mode, sum(amount_paise) AS amountPaise FROM payment WHERE bill_id = ? GROUP BY mode HAVING sum(amount_paise) <> 0 ORDER BY mode');
    const bills: DayBill[] = rows.map((r) => ({
      billId: r.id,
      billNo: r.bill_no_text ?? '',
      orderId: r.order_id,
      orderVersion: r.version,
      orderState: r.order_state,
      table: r.tbl,
      partNo: r.part_no,
      parts: r.split_of,
      totalPaise: r.total_paise,
      state: r.state,
      payments: paymentsOf.all(r.id) as DayBill['payments'],
      printedAt: r.printed_at,
    }));
    return reply.header('cache-control', 'no-store').send({ date, bills });
  });

  app.get('/v1/cash', (req, reply) => {
    requireRight(db, req, 'bill.settle', now());
    const date = dateOf(req.query);
    const movements = db
      .prepare(
        `SELECT c.id, c.kind, c.amount_paise AS amountPaise, c.reason, u.name AS userName, c.at
         FROM cash_movement c LEFT JOIN app_user u ON u.id = c.user_id WHERE c.business_date = ? ORDER BY c.at DESC`,
      )
      .all(date) as CashMovementView[];
    return reply.header('cache-control', 'no-store').send({ date, movements });
  });
}
