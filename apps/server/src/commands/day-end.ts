import { renderZReport, type ZReportData } from '@dinepos/printing';
import { dayEndSchema, lineAmount } from '@dinepos/shared';
import { openNextBusinessDay } from '../core/business-day.js';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { getConfig } from '../core/outlet-config.js';
import type { Db } from '../db/connection.js';
import { billPrinter, printedDateTime } from './billing-support.js';

const KEEP_PROCESSED_DAYS = 7;
const KEEP_EVENTS = 10_000;

/** Z-report figures for one business date (all its orders are settled or void when this runs). */
export function buildZReport(db: Db, businessDate: string, cashCountedPaise: number, outletName: string, closedAt: string): ZReportData {
  const totals = db
    .prepare(
      `SELECT count(*) AS bills, COALESCE(sum(b.subtotal_paise), 0) AS gross, COALESCE(sum(b.discount_paise), 0) AS discount,
              COALESCE(sum(b.service_charge_paise), 0) AS sc, COALESCE(sum(b.cgst_paise), 0) AS cgst, COALESCE(sum(b.sgst_paise), 0) AS sgst,
              COALESCE(sum(b.igst_paise), 0) AS igst, COALESCE(sum(b.round_off_paise), 0) AS ro, COALESCE(sum(b.total_paise), 0) AS net
       FROM bill b JOIN "order" o ON o.id = b.order_id WHERE o.business_date = ? AND b.state = 'settled'`,
    )
    .get(businessDate) as { bills: number; gross: number; discount: number; sc: number; cgst: number; sgst: number; igst: number; ro: number; net: number };

  const byMode = db
    .prepare(
      `SELECT p.mode, sum(p.amount_paise) AS amountPaise FROM payment p JOIN bill b ON b.id = p.bill_id JOIN "order" o ON o.id = b.order_id
       WHERE o.business_date = ? AND b.state = 'settled' GROUP BY p.mode ORDER BY p.mode`,
    )
    .all(businessDate) as ZReportData['byMode'];

  const byArea = db
    .prepare(
      `SELECT COALESCE(a.name, 'Takeaway') AS name, count(*) AS bills, sum(b.total_paise) AS amountPaise
       FROM bill b JOIN "order" o ON o.id = b.order_id LEFT JOIN dining_table t ON t.id = o.table_id LEFT JOIN area a ON a.id = t.area_id
       WHERE o.business_date = ? AND b.state = 'settled' GROUP BY 1 ORDER BY 1`,
    )
    .all(businessDate) as ZReportData['byArea'];

  const lines = db
    .prepare(
      `SELECT oi.id, oi.qty, oi.unit_price_paise, oi.tax_rate_bp, COALESCE(c.name, 'Other') AS category
       FROM order_item oi JOIN "order" o ON o.id = oi.order_id LEFT JOIN menu_item mi ON mi.id = oi.item_id LEFT JOIN category c ON c.id = mi.category_id
       WHERE o.business_date = ? AND o.state = 'settled' AND oi.status = 'fired'`,
    )
    .all(businessDate) as Array<{ id: string; qty: number; unit_price_paise: number; tax_rate_bp: number; category: string }>;
  const addonsOf = db.prepare('SELECT qty, price_paise AS pricePaise FROM order_item_addon WHERE order_item_id = ?');
  const cats = new Map<string, { qty: number; amountPaise: number }>();
  for (const l of lines) {
    const amount = lineAmount({ id: l.id, qty: l.qty, unitPricePaise: l.unit_price_paise, taxRateBp: l.tax_rate_bp, addons: addonsOf.all(l.id) as Array<{ qty: number; pricePaise: number }> });
    const c = cats.get(l.category) ?? { qty: 0, amountPaise: 0 };
    cats.set(l.category, { qty: c.qty + l.qty, amountPaise: c.amountPaise + amount });
  }

  const one = (sql: string) => (db.prepare(sql).pluck().get(businessDate) as number | null) ?? 0;
  const cashPayments = byMode.find((m) => m.mode === 'cash')?.amountPaise ?? 0;
  const payIn = one(`SELECT sum(amount_paise) FROM cash_movement WHERE business_date = ? AND kind IN ('opening', 'pay_in')`);
  const payOut = one(`SELECT sum(amount_paise) FROM cash_movement WHERE business_date = ? AND kind = 'pay_out'`);

  return {
    outletName,
    businessDate,
    closedAt,
    bills: totals.bills,
    covers: one(`SELECT sum(covers) FROM "order" WHERE business_date = ? AND state = 'settled'`),
    kots: one(`SELECT count(*) FROM kot WHERE business_date = ?`),
    grossSalesPaise: totals.gross,
    discountPaise: totals.discount,
    serviceChargePaise: totals.sc,
    cgstPaise: totals.cgst,
    sgstPaise: totals.sgst,
    igstPaise: totals.igst,
    roundOffPaise: totals.ro,
    netSalesPaise: totals.net,
    byMode,
    byArea,
    byCategory: [...cats.entries()].map(([name, c]) => ({ name, ...c })).sort((a, b) => b.amountPaise - a.amountPaise),
    cancelledAfterFire: one(`SELECT count(*) FROM order_item oi JOIN "order" o ON o.id = oi.order_id WHERE o.business_date = ? AND oi.status = 'cancelled' AND oi.kot_id IS NOT NULL`),
    cashExpectedPaise: cashPayments + payIn - payOut,
    cashCountedPaise,
  };
}

/**
 * DayEnd (docs/08 "Day-end"): refused while any order is open or billed. Closes the business date with its
 * Z-report, records the counted cash, prints the report, opens the next date and prunes old idempotency
 * records and events (docs/04, docs/05).
 */
export const dayEnd = defineCommand({
  type: 'DayEnd',
  schema: dayEndSchema,
  right: 'dayend',
  needsOrder: false,
  apply(ctx, p) {
    const { db } = ctx;
    const open = db
      .prepare(`SELECT o.id, COALESCE(t.label, 'Takeaway') AS label FROM "order" o LEFT JOIN dining_table t ON t.id = o.table_id WHERE o.state IN ('open', 'billed') ORDER BY 2`)
      .all() as Array<{ id: string; label: string }>;
    if (open.length > 0) {
      throw new PosError('INVALID_STATE', `${open.length} order${open.length > 1 ? 's are' : ' is'} still open (${open.map((o) => o.label).join(', ')}). Settle them first.`, {
        openOrders: open,
      });
    }

    const cfg = getConfig(db);
    const when = printedDateTime(ctx.now, ctx.timeZone);
    const z = buildZReport(db, ctx.businessDate, p.cashCountedPaise, cfg['outlet.name'], `${when.date} ${when.time}`);
    db.prepare('UPDATE business_day SET closed_at = ?, closed_by = ?, z_report_json = ? WHERE date = ? AND closed_at IS NULL').run(
      ctx.nowIso,
      ctx.actor.userId,
      JSON.stringify(z),
      ctx.businessDate,
    );
    db.prepare(`INSERT INTO cash_movement (id, business_date, kind, amount_paise, reason, user_id, at) VALUES (?, ?, 'closing', ?, 'day end count', ?, ?)`).run(
      ctx.commandId,
      ctx.businessDate,
      p.cashCountedPaise,
      ctx.actor.userId,
      ctx.nowIso,
    );
    const next = openNextBusinessDay(db, ctx.timeZone, ctx.now, `day end of ${ctx.businessDate}`);

    const printer = billPrinter(db, cfg);
    if (printer) {
      const { bytes, preview } = renderZReport(z, { paper: printer.paper });
      ctx.print({ printerId: printer.id, docKind: 'zreport', refId: ctx.businessDate, bytes, previewText: preview });
    }

    const cutoff = new Date(ctx.now.getTime() - KEEP_PROCESSED_DAYS * 86_400_000).toISOString();
    db.prepare('DELETE FROM processed_command WHERE at < ?').run(cutoff);
    db.prepare('DELETE FROM event_log WHERE seq <= (SELECT max(seq) FROM event_log) - ?').run(KEEP_EVENTS);

    ctx.audit({
      entity: 'business_day',
      entityId: ctx.businessDate,
      action: 'day.close',
      after: { netSalesPaise: z.netSalesPaise, bills: z.bills, cashExpectedPaise: z.cashExpectedPaise, cashCountedPaise: p.cashCountedPaise, nextDate: next },
      leakage: p.cashCountedPaise !== z.cashExpectedPaise,
    });
    ctx.emit('system', 'day.changed', { businessDate: next, closedDate: ctx.businessDate });
    ctx.outbox('day.closed', { businessDate: ctx.businessDate, zReport: z });
    return { result: { closedDate: ctx.businessDate, nextDate: next, zReport: z, printerId: printer?.id ?? null } };
  },
});
