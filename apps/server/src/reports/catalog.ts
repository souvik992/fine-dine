// Reports v1 (P4-03, docs/10; design from TiffinPOS). Every figure is worked out here in integer paise from settled
// bills of the business dates asked for. Void bills never count as sales; they are listed in their own report.
import { isoInZone, roundHalfUp, type ReportColumn, type ReportInfo, type ReportRow, type ReportTable } from '@dinepos/shared';
import { PosError } from '../core/errors.js';
import { getConfig } from '../core/outlet-config.js';
import type { Db } from '../db/connection.js';

interface Ctx {
  db: Db;
  from: string;
  to: string;
  timeZone: string;
}
interface Built {
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: ReportRow | null;
  summary: ReportTable['summary'];
}
interface Def extends ReportInfo {
  build(c: Ctx): Built;
}

const n = (v: unknown) => Number(v ?? 0);
const all = (c: Ctx, sql: string, ...args: unknown[]) => c.db.prepare(sql).all(...args) as ReportRow[];
const IN_RANGE = 'o.business_date BETWEEN @from AND @to';
const params = (c: Ctx) => ({ from: c.from, to: c.to });
/** Latest printed copy of a bill (number text, GST groups). */
const BILL_NO = `(SELECT d.bill_no_text FROM bill_document d WHERE d.bill_id = b.id ORDER BY d.revision DESC LIMIT 1)`;
const TABLE = `COALESCE((SELECT t.label FROM dining_table t WHERE t.id = o.table_id), 'Takeaway')`;
const rate = (bp: number) => `${Math.trunc(bp / 100)}${bp % 100 ? `.${String(bp % 100).padStart(2, '0').replace(/0$/, '')}` : ''}%`;
const avg = (total: number, count: number) => (count > 0 ? roundHalfUp(total, count) : 0);
const local = (c: Ctx, iso: string | null) => {
  if (!iso) return '';
  const s = isoInZone(new Date(iso), c.timeZone);
  return `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(2, 4)} ${s.slice(11, 16)}`;
};

/** Sums the money and count columns (integers, so nothing is rounded). */
function totalsOf(columns: ReportColumn[], rows: ReportRow[], label = 'Total'): ReportRow {
  const t: ReportRow = {};
  columns.forEach((col, i) => {
    t[col.key] = i === 0 ? label : col.type === 'text' ? null : rows.reduce((s, r) => s + n(r[col.key]), 0);
  });
  return t;
}

const col = (key: string, label: string, type: ReportColumn['type'] = 'text'): ReportColumn => ({ key, label, type });

// ---------------------------------------------------------------- sales

const daily: Def = {
  key: 'daily',
  title: 'Daily sales',
  group: 'Sales',
  description: 'Day by day (business date): bills, covers, gross, discounts, service charge, GST, round-off, net sales and voids.',
  build(c) {
    const rows = all(
      c,
      `SELECT o.business_date AS day,
              sum(CASE WHEN b.state = 'settled' THEN 1 ELSE 0 END) AS bills,
              sum(CASE WHEN b.state = 'settled' THEN b.subtotal_paise ELSE 0 END) AS gross,
              sum(CASE WHEN b.state = 'settled' THEN b.discount_paise ELSE 0 END) AS discount,
              sum(CASE WHEN b.state = 'settled' THEN b.service_charge_paise ELSE 0 END) AS serviceCharge,
              sum(CASE WHEN b.state = 'settled' THEN b.cgst_paise + b.sgst_paise + b.igst_paise ELSE 0 END) AS gst,
              sum(CASE WHEN b.state = 'settled' THEN b.round_off_paise ELSE 0 END) AS roundOff,
              sum(CASE WHEN b.state = 'settled' THEN b.total_paise ELSE 0 END) AS net,
              sum(CASE WHEN b.state = 'void' THEN 1 ELSE 0 END) AS voids,
              sum(CASE WHEN b.state = 'void' THEN b.total_paise ELSE 0 END) AS voidAmount,
              (SELECT coalesce(sum(x.covers), 0) FROM "order" x WHERE x.business_date = o.business_date AND x.state = 'settled') AS covers
       FROM bill b JOIN "order" o ON o.id = b.order_id
       WHERE ${IN_RANGE} AND b.bill_no IS NOT NULL AND b.state IN ('settled', 'void')
       GROUP BY o.business_date ORDER BY o.business_date`,
      params(c),
    );
    const columns = [
      col('day', 'Date'),
      col('bills', 'Bills', 'int'),
      col('covers', 'Covers', 'int'),
      col('gross', 'Gross', 'money'),
      col('discount', 'Discounts', 'money'),
      col('serviceCharge', 'Service charge', 'money'),
      col('gst', 'GST', 'money'),
      col('roundOff', 'Round-off', 'money'),
      col('net', 'Net sales', 'money'),
      col('voids', 'Void bills', 'int'),
      col('voidAmount', 'Void amount', 'money'),
    ];
    const totals = totalsOf(columns, rows);
    return {
      columns,
      rows,
      totals,
      summary: [
        { label: 'Net sales', value: n(totals.net), type: 'money' },
        { label: 'Bills', value: n(totals.bills), type: 'int' },
        { label: 'Average bill', value: avg(n(totals.net), n(totals.bills)), type: 'money' },
        { label: 'Per cover', value: avg(n(totals.net), n(totals.covers)), type: 'money' },
      ],
    };
  },
};

/** Items of settled orders (sent to the kitchen, not cancelled), before discount. */
const ITEM_LINES = `SELECT oi.item_id, oi.name_snapshot AS name, COALESCE(c.name, 'Other') AS category, oi.qty,
         oi.qty * oi.unit_price_paise + COALESCE((SELECT sum(a.qty * a.price_paise) FROM order_item_addon a WHERE a.order_item_id = oi.id), 0) AS amount
       FROM order_item oi JOIN "order" o ON o.id = oi.order_id LEFT JOIN menu_item mi ON mi.id = oi.item_id LEFT JOIN category c ON c.id = mi.category_id
       WHERE ${IN_RANGE} AND o.state = 'settled' AND oi.status = 'fired'`;

const items: Def = {
  key: 'items',
  title: 'Item-wise sales',
  group: 'Sales',
  description: 'Quantity and amount of each dish (and size) sold, before bill discounts. Best sellers first.',
  build(c) {
    const rows = all(c, `SELECT name AS item, category, sum(qty) AS qty, sum(amount) AS amount FROM (${ITEM_LINES}) GROUP BY item_id, name ORDER BY amount DESC, item`, params(c));
    const columns = [col('item', 'Item'), col('category', 'Category'), col('qty', 'Qty', 'int'), col('amount', 'Amount', 'money')];
    const totals = totalsOf(columns, rows);
    return { columns, rows, totals, summary: rows.slice(0, 3).map((r) => ({ label: String(r.item), value: n(r.amount), type: 'money' as const })) };
  },
};

const categories: Def = {
  key: 'categories',
  title: 'Category-wise sales',
  group: 'Sales',
  description: 'Quantity and amount per menu category, before bill discounts.',
  build(c) {
    const rows = all(c, `SELECT category, count(DISTINCT item_id) AS dishes, sum(qty) AS qty, sum(amount) AS amount FROM (${ITEM_LINES}) GROUP BY category ORDER BY amount DESC`, params(c));
    const columns = [col('category', 'Category'), col('dishes', 'Dishes', 'int'), col('qty', 'Qty', 'int'), col('amount', 'Amount', 'money')];
    return { columns, rows, totals: totalsOf(columns, rows), summary: [] };
  },
};

const areas: Def = {
  key: 'areas',
  title: 'Area-wise sales',
  group: 'Sales',
  description: 'Bills, covers and net sales per dining area, with the average per cover.',
  build(c) {
    const rows = all(
      c,
      `SELECT COALESCE(a.name, 'Takeaway') AS area, count(*) AS bills, sum(b.total_paise) AS net,
              (SELECT coalesce(sum(x.covers), 0) FROM "order" x LEFT JOIN dining_table xt ON xt.id = x.table_id
               WHERE x.business_date BETWEEN @from AND @to AND x.state = 'settled' AND COALESCE(xt.area_id, '') = COALESCE(a.id, '')) AS covers
       FROM bill b JOIN "order" o ON o.id = b.order_id LEFT JOIN dining_table t ON t.id = o.table_id LEFT JOIN area a ON a.id = t.area_id
       WHERE ${IN_RANGE} AND b.state = 'settled' GROUP BY a.id ORDER BY net DESC`,
      params(c),
    ).map((r) => ({ ...r, perCover: avg(n(r.net), n(r.covers)) }));
    const columns = [col('area', 'Area'), col('bills', 'Bills', 'int'), col('covers', 'Covers', 'int'), col('net', 'Net sales', 'money'), col('perCover', 'Per cover', 'money')];
    const totals = totalsOf(columns, rows);
    totals.perCover = avg(n(totals.net), n(totals.covers));
    return { columns, rows, totals, summary: [] };
  },
};

const tables: Def = {
  key: 'tables',
  title: 'Table turnover',
  group: 'Sales',
  description: 'How often each table was used, guests seated, average time at the table (seated to paid) and sales.',
  build(c) {
    const rows = all(
      c,
      `SELECT t.label AS tbl, COALESCE(a.name, '') AS area, count(*) AS turns, coalesce(sum(o.covers), 0) AS covers,
              CAST(round(avg((julianday(o.closed_at) - julianday(o.opened_at)) * 1440)) AS INTEGER) AS minutes,
              (SELECT coalesce(sum(b.total_paise), 0) FROM bill b JOIN "order" y ON y.id = b.order_id
               WHERE y.table_id = t.id AND y.business_date BETWEEN @from AND @to AND b.state = 'settled') AS net
       FROM "order" o JOIN dining_table t ON t.id = o.table_id LEFT JOIN area a ON a.id = t.area_id
       WHERE ${IN_RANGE} AND o.state = 'settled' GROUP BY t.id ORDER BY a.sort, length(t.label), t.label`,
      params(c),
    ).map((r) => ({ ...r, minutes: `${n(r.minutes)} min` }));
    const columns = [col('tbl', 'Table'), col('area', 'Area'), col('turns', 'Times used', 'int'), col('covers', 'Covers', 'int'), col('minutes', 'Average stay'), col('net', 'Net sales', 'money')];
    return { columns, rows, totals: totalsOf(columns, rows), summary: [] };
  },
};

// ---------------------------------------------------------------- tax and money

const gst: Def = {
  key: 'gst',
  title: 'GST summary',
  group: 'Tax & money',
  description: 'Taxable value and CGST / SGST / IGST per GST rate, from the bills as printed (settled bills only). For GSTR-1 and GSTR-3B; check with your CA.',
  build(c) {
    const rows = all(
      c,
      `SELECT json_extract(g.value, '$.rateBp') AS rateBp, count(DISTINCT b.id) AS bills,
              sum(json_extract(g.value, '$.taxable')) AS taxable, sum(json_extract(g.value, '$.cgst')) AS cgst,
              sum(json_extract(g.value, '$.sgst')) AS sgst, sum(json_extract(g.value, '$.igst')) AS igst, sum(json_extract(g.value, '$.tax')) AS tax
       FROM bill b JOIN "order" o ON o.id = b.order_id
       JOIN bill_document d ON d.bill_id = b.id AND d.revision = (SELECT max(revision) FROM bill_document WHERE bill_id = b.id)
       JOIN json_each(d.doc_json, '$.breakup.taxGroups') g
       WHERE ${IN_RANGE} AND b.state = 'settled' GROUP BY 1 ORDER BY 1`,
      params(c),
    ).map(({ rateBp, ...r }) => ({ rate: rate(n(rateBp)), ...r }));
    const columns = [
      col('rate', 'GST rate'),
      col('bills', 'Bills', 'int'),
      col('taxable', 'Taxable value', 'money'),
      col('cgst', 'CGST', 'money'),
      col('sgst', 'SGST', 'money'),
      col('igst', 'IGST', 'money'),
      col('tax', 'Total GST', 'money'),
    ];
    const totals = totalsOf(columns, rows);
    totals.bills = null; // a bill with two rates is in two rows
    const b2b = c.db.prepare(`SELECT count(*) FROM bill b JOIN "order" o ON o.id = b.order_id WHERE ${IN_RANGE} AND b.state = 'settled' AND b.customer_gstin IS NOT NULL`).pluck().get(params(c)) as number;
    return {
      columns,
      rows,
      totals,
      summary: [
        { label: 'Taxable value', value: n(totals.taxable), type: 'money' },
        { label: 'Total GST', value: n(totals.tax), type: 'money' },
        { label: 'Bills with a guest GSTIN (B2B)', value: b2b, type: 'int' },
      ],
    };
  },
};

const MODE: Record<string, string> = { cash: 'Cash', card: 'Card', upi: 'UPI', due: 'Due (pay later)', complimentary: 'Complimentary', other: 'Other', online: 'Online (website / app)' };
const payments: Def = {
  key: 'payments',
  title: 'Payment modes',
  group: 'Tax & money',
  description: 'What was received, by payment mode (settled bills; cash after change).',
  build(c) {
    const rows = all(
      c,
      `SELECT p.mode, count(*) AS payments, sum(p.amount_paise) AS amount FROM payment p JOIN bill b ON b.id = p.bill_id JOIN "order" o ON o.id = b.order_id
       WHERE ${IN_RANGE} AND b.state = 'settled' GROUP BY p.mode ORDER BY amount DESC`,
      params(c),
    ).map((r) => ({ ...r, mode: MODE[String(r.mode)] ?? String(r.mode) }));
    const columns = [col('mode', 'Mode'), col('payments', 'Payments', 'int'), col('amount', 'Amount', 'money')];
    return { columns, rows, totals: totalsOf(columns, rows), summary: [] };
  },
};

const cash: Def = {
  key: 'cash',
  title: 'Cash register',
  group: 'Tax & money',
  description: 'Per day: cash sales, pay-ins, pay-outs, cash expected in the drawer, cash counted at day end and the difference.',
  build(c) {
    const rows = all(
      c,
      `WITH days AS (SELECT business_date AS day FROM "order" WHERE business_date BETWEEN @from AND @to
                     UNION SELECT business_date FROM cash_movement WHERE business_date BETWEEN @from AND @to)
       SELECT day,
              (SELECT coalesce(sum(p.amount_paise), 0) FROM payment p JOIN bill b ON b.id = p.bill_id JOIN "order" o ON o.id = b.order_id
               WHERE o.business_date = day AND b.state = 'settled' AND p.mode = 'cash') AS cashSales,
              (SELECT coalesce(sum(amount_paise), 0) FROM cash_movement WHERE business_date = day AND kind IN ('opening', 'pay_in')) AS payIn,
              (SELECT coalesce(sum(amount_paise), 0) FROM cash_movement WHERE business_date = day AND kind = 'pay_out') AS payOut,
              (SELECT amount_paise FROM cash_movement WHERE business_date = day AND kind = 'closing' ORDER BY at DESC LIMIT 1) AS counted
       FROM days ORDER BY day`,
      params(c),
    ).map((r): ReportRow => {
      const expected = n(r.cashSales) + n(r.payIn) - n(r.payOut);
      const counted = r.counted ?? null;
      return { ...r, expected, counted, difference: counted === null ? null : n(counted) - expected };
    });
    const columns = [
      col('day', 'Date'),
      col('cashSales', 'Cash sales', 'money'),
      col('payIn', 'Paid in', 'money'),
      col('payOut', 'Paid out', 'money'),
      col('expected', 'Expected', 'money'),
      col('counted', 'Counted', 'money'),
      col('difference', 'Difference', 'money'),
    ];
    const totals = totalsOf(columns, rows);
    return { columns, rows, totals, summary: [{ label: 'Cash difference', value: n(totals.difference), type: 'money' }] };
  },
};

// ---------------------------------------------------------------- controls (leakage)

const userName = `(SELECT name FROM app_user WHERE id = %s)`;
const nameOf = (col_: string) => userName.replace('%s', col_);

const discounts: Def = {
  key: 'discounts',
  title: 'Discounts',
  group: 'Controls',
  description: 'Every settled bill with a discount: how much, why, who gave it and who approved it.',
  build(c) {
    const rows = all(
      c,
      `SELECT ${BILL_NO} AS billNo, o.business_date AS day, ${TABLE} AS tbl, b.subtotal_paise AS gross, b.discount_paise AS discount,
              COALESCE(b.discount_reason, '') AS reason,
              COALESCE((SELECT ${nameOf('a.user_id')} FROM audit_event a WHERE a.entity_id = b.id AND a.action IN ('bill.print', 'bill.reissue') ORDER BY a.seq DESC LIMIT 1), '') AS byName,
              COALESCE((SELECT ${nameOf('a.approved_by')} FROM audit_event a WHERE a.entity_id = b.id AND a.action IN ('bill.print', 'bill.reissue') ORDER BY a.seq DESC LIMIT 1), '') AS approvedBy
       FROM bill b JOIN "order" o ON o.id = b.order_id WHERE ${IN_RANGE} AND b.state = 'settled' AND b.discount_paise > 0 ORDER BY b.fy, b.bill_no`,
      params(c),
    ).map((r) => {
      const tenths = n(r.gross) ? roundHalfUp(n(r.discount) * 1000, n(r.gross)) : 0; // integer tenths of a percent
      return { ...r, pct: n(r.gross) ? `${Math.trunc(tenths / 10)}.${tenths % 10}%` : '' };
    });
    const columns = [
      col('billNo', 'Bill'),
      col('day', 'Date'),
      col('tbl', 'Table'),
      col('gross', 'Gross', 'money'),
      col('discount', 'Discount', 'money'),
      col('pct', 'Share'),
      col('reason', 'Reason'),
      col('byName', 'Given by'),
      col('approvedBy', 'Approved by'),
    ];
    const totals = totalsOf(columns, rows);
    return { columns, rows, totals, summary: [{ label: 'Discounts given', value: n(totals.discount), type: 'money' }] };
  },
};

const voids: Def = {
  key: 'voids',
  title: 'Voids and cancellations',
  group: 'Controls',
  description: 'Void bills (they keep their numbers), items cancelled or reduced after the kitchen got them, and tables released with nothing billed.',
  build(c) {
    const rows = all(
      c,
      `SELECT a.ts AS at, CASE WHEN a.reason LIKE 'Split part%' OR a.reason LIKE 'Not needed after%' THEN 'Void bill (split changed)' ELSE 'Void bill' END AS kind, (SELECT d.bill_no_text FROM bill_document d WHERE d.bill_id = b.id ORDER BY d.revision DESC LIMIT 1) AS what,
              ${TABLE} AS tbl, NULL AS qty, b.total_paise AS amount, a.reason, ${nameOf('a.user_id')} AS byName, ${nameOf('a.approved_by')} AS approvedBy, a.seq AS seq
       FROM audit_event a JOIN bill b ON b.id = a.entity_id JOIN "order" o ON o.id = b.order_id
       WHERE a.action = 'bill.void' AND ${IN_RANGE}
       UNION ALL
       SELECT a.ts, CASE a.action WHEN 'item.cancel_fired' THEN 'Cancelled after KOT' ELSE 'Reduced after KOT' END, oi.name_snapshot,
              ${TABLE}, CASE a.action WHEN 'item.cancel_fired' THEN json_extract(a.before_json, '$.qty') ELSE json_extract(a.before_json, '$.qty') - json_extract(a.after_json, '$.qty') END,
              oi.unit_price_paise * CASE a.action WHEN 'item.cancel_fired' THEN json_extract(a.before_json, '$.qty') ELSE json_extract(a.before_json, '$.qty') - json_extract(a.after_json, '$.qty') END,
              a.reason, ${nameOf('a.user_id')}, ${nameOf('a.approved_by')}, a.seq
       FROM audit_event a JOIN order_item oi ON oi.id = a.entity_id JOIN "order" o ON o.id = COALESCE(oi.original_order_id, oi.order_id)
       WHERE a.action IN ('item.cancel_fired', 'item.modify_fired') AND ${IN_RANGE}
       UNION ALL
       SELECT a.ts, 'Table released (nothing billed)', NULL, ${TABLE}, NULL, 0, a.reason, ${nameOf('a.user_id')}, ${nameOf('a.approved_by')}, a.seq
       FROM audit_event a JOIN "order" o ON o.id = a.entity_id
       WHERE a.action = 'order.release' AND ${IN_RANGE}
       ORDER BY 1, seq`,
      params(c),
    ).map(({ seq: _seq, ...r }): ReportRow => ({ ...r, at: local(c, r.at as string), approvedBy: r.approvedBy ?? '', byName: r.byName ?? '', reason: r.reason ?? '' }));
    const columns = [
      col('at', 'When'),
      col('kind', 'What'),
      col('what', 'Bill / item'),
      col('tbl', 'Table'),
      col('qty', 'Qty', 'int'),
      col('amount', 'Amount', 'money'),
      col('reason', 'Reason'),
      col('byName', 'By'),
      col('approvedBy', 'Approved by'),
    ];
    const totals = totalsOf(columns, rows);
    return {
      columns,
      rows,
      totals,
      summary: [
        { label: 'Void bills', value: rows.filter((r) => String(r.kind).startsWith('Void')).length, type: 'int' },
        { label: 'Items taken back after KOT', value: rows.filter((r) => String(r.kind).endsWith('after KOT')).length, type: 'int' },
        { label: 'Tables released', value: rows.filter((r) => String(r.kind).startsWith('Table released')).length, type: 'int' },
        { label: 'Amount', value: n(totals.amount), type: 'money' },
      ],
    };
  },
};

const KOT_KIND: Record<string, string> = { modify: 'Change slip (reduced)', cancel: 'Change slip (cancelled)', move_notice: 'Move notice' };
const kotChanges: Def = {
  key: 'kot-changes',
  title: 'KOT changes and reprints',
  group: 'Controls',
  description: 'Change slips, move notices, KOT reprints and bill reprints: everything sent to a printer again or changed after the first ticket.',
  build(c) {
    const rows = all(
      c,
      `SELECT k.fired_at AS at, k.kind AS kind, printf('KOT %04d', k.kot_no) AS ref, ${TABLE} AS tbl, s.name AS station,
              ${nameOf('k.fired_by')} AS byName, COALESCE(json_extract(kd.ticket_json, '$.reason'), json_extract(kd.ticket_json, '$.notice'), '') AS detail
       FROM kot k JOIN "order" o ON o.id = k.order_id JOIN station s ON s.id = k.station_id LEFT JOIN kot_document kd ON kd.kot_id = k.id
       WHERE ${IN_RANGE} AND k.kind <> 'new'
       UNION ALL
       SELECT a.ts, 'kot_reprint', printf('KOT %04d', k.kot_no), ${TABLE}, s.name, ${nameOf('a.user_id')}, ''
       FROM audit_event a JOIN kot k ON k.id = a.entity_id JOIN "order" o ON o.id = k.order_id JOIN station s ON s.id = k.station_id
       WHERE a.action = 'kot.reprint' AND ${IN_RANGE}
       UNION ALL
       SELECT a.ts, 'bill_reprint', json_extract(a.after_json, '$.billNo'), ${TABLE}, '', ${nameOf('a.user_id')}, printf('reprint %d', json_extract(a.after_json, '$.reprint'))
       FROM audit_event a JOIN bill b ON b.id = a.entity_id JOIN "order" o ON o.id = b.order_id
       WHERE a.action = 'bill.reprint' AND ${IN_RANGE}
       ORDER BY 1`,
      params(c),
    ).map((r) => ({
      ...r,
      at: local(c, r.at as string),
      kind: KOT_KIND[String(r.kind)] ?? (r.kind === 'kot_reprint' ? 'KOT reprinted' : 'Bill reprinted'),
      byName: r.byName ?? '',
    }));
    const columns = [col('at', 'When'), col('kind', 'What'), col('ref', 'KOT / bill'), col('tbl', 'Table'), col('station', 'Station'), col('byName', 'By'), col('detail', 'Reason / note')];
    const count = (k: string) => rows.filter((r) => String(r.kind).startsWith(k)).length;
    return {
      columns,
      rows,
      totals: null,
      summary: [
        { label: 'Change slips', value: count('Change slip'), type: 'int' },
        { label: 'Reprints', value: count('KOT reprinted') + count('Bill reprinted'), type: 'int' },
        { label: 'Move notices', value: count('Move notice'), type: 'int' },
      ],
    };
  },
};

// ---------------------------------------------------------------- staff

const captains: Def = {
  key: 'captains',
  title: 'Captain performance',
  group: 'Staff',
  description:
    'Per captain (the one looking after each order, P3-04): paid orders, guests, net sales, per cover, average bill, dishes sent, average time at the table, and changes after the KOT.',
  build(c) {
    const rows = all(
      c,
      `SELECT COALESCE(u.name, 'No captain') AS captain, count(*) AS orders, coalesce(sum(o.covers), 0) AS covers,
              sum((SELECT coalesce(sum(b.total_paise), 0) FROM bill b WHERE b.order_id = o.id AND b.state = 'settled')) AS net,
              sum((SELECT count(*) FROM bill b WHERE b.order_id = o.id AND b.state = 'settled')) AS bills,
              sum((SELECT coalesce(sum(oi.qty), 0) FROM order_item oi WHERE oi.order_id = o.id AND oi.status = 'fired')) AS dishes,
              CAST(round(avg((julianday(o.closed_at) - julianday(o.opened_at)) * 1440)) AS INTEGER) AS minutes,
              sum((SELECT count(*) FROM kot k WHERE k.order_id = o.id AND k.kind IN ('modify', 'cancel'))) AS changes
       FROM "order" o LEFT JOIN app_user u ON u.id = o.captain_id
       WHERE ${IN_RANGE} AND o.state = 'settled'
       GROUP BY o.captain_id ORDER BY o.captain_id IS NULL, net DESC, captain`,
      params(c),
    ).map(({ bills, ...r }): ReportRow => ({
      ...r,
      perCover: avg(n(r.net), n(r.covers)),
      avgBill: avg(n(r.net), n(bills)),
      bills: n(bills),
      minutes: r.minutes === null ? '' : `${n(r.minutes)} min`,
    }));
    const columns = [
      col('captain', 'Captain'),
      col('orders', 'Tables served', 'int'),
      col('covers', 'Guests', 'int'),
      col('net', 'Net sales', 'money'),
      col('perCover', 'Per cover', 'money'),
      col('avgBill', 'Average bill', 'money'),
      col('dishes', 'Dishes sent', 'int'),
      col('minutes', 'Average stay'),
      col('changes', 'Changes after KOT', 'int'),
    ];
    const totals = totalsOf(columns, rows);
    totals.perCover = avg(n(totals.net), n(totals.covers));
    totals.avgBill = avg(n(totals.net), rows.reduce((s, r) => s + n(r.bills), 0));
    const named = rows.filter((r) => r.captain !== 'No captain');
    const top = named[0];
    return {
      columns,
      rows,
      totals,
      summary: [
        ...(top ? [{ label: `Top: ${String(top.captain)}`, value: n(top.net), type: 'money' as const }] : []),
        { label: 'Captains', value: named.length, type: 'int' },
        { label: 'Per cover', value: n(totals.perCover), type: 'money' },
      ],
    };
  },
};

// ---------------------------------------------------------------- kitchen

/** "7 min 05 s". */
const duration = (seconds: number | null) => (seconds === null ? '' : `${Math.floor(seconds / 60)} min ${String(Math.round(seconds) % 60).padStart(2, '0')} s`);

const kitchen: Def = {
  key: 'kitchen',
  title: 'Kitchen speed',
  group: 'Kitchen',
  description:
    'Per station, from the kitchen screen bumps (P4-02): tickets, average and slowest time from KOT to ready, how many took longer than the amber time, and tickets never bumped.',
  build(c) {
    const amberMin = getConfig(c.db)['kds.amberMin'];
    const raw = all(
      c,
      `SELECT s.name AS station,
              sum(CASE WHEN k.ready_at IS NOT NULL THEN 1 ELSE 0 END) AS tickets,
              avg(CASE WHEN k.ready_at IS NOT NULL THEN (julianday(k.ready_at) - julianday(k.fired_at)) * 86400 END) AS avgSec,
              max(CASE WHEN k.ready_at IS NOT NULL THEN (julianday(k.ready_at) - julianday(k.fired_at)) * 86400 END) AS maxSec,
              sum(CASE WHEN k.ready_at IS NOT NULL AND (julianday(k.ready_at) - julianday(k.fired_at)) * 1440 > @amber THEN 1 ELSE 0 END) AS late,
              sum(CASE WHEN k.ready_at IS NULL THEN 1 ELSE 0 END) AS notBumped
       FROM kot k JOIN station s ON s.id = k.station_id
       WHERE k.business_date BETWEEN @from AND @to AND k.kind = 'new'
       GROUP BY s.id ORDER BY s.name COLLATE NOCASE`,
      { ...params(c), amber: amberMin },
    );
    const rows = raw.map((r): ReportRow => ({
      station: r.station ?? '',
      tickets: n(r.tickets),
      avg: duration(r.avgSec === null ? null : n(r.avgSec)),
      slowest: duration(r.maxSec === null ? null : n(r.maxSec)),
      late: n(r.late),
      onTime: n(r.tickets) ? `${Math.round(((n(r.tickets) - n(r.late)) * 100) / n(r.tickets))}%` : '',
      notBumped: n(r.notBumped),
    }));
    const columns = [
      col('station', 'Station'),
      col('tickets', 'Tickets bumped', 'int'),
      col('avg', 'Average to ready'),
      col('slowest', 'Slowest'),
      col('late', `Over ${amberMin} min`, 'int'),
      col('onTime', 'On time'),
      col('notBumped', 'Never bumped', 'int'),
    ];
    const totals = totalsOf(columns, rows);
    const bumped = n(totals.tickets);
    const totalSec = raw.reduce((s, r) => s + n(r.avgSec) * n(r.tickets), 0);
    totals.avg = bumped ? duration(totalSec / bumped) : '';
    totals.onTime = bumped ? `${Math.round(((bumped - n(totals.late)) * 100) / bumped)}%` : '';
    return {
      columns,
      rows,
      totals,
      summary: [
        { label: 'Average to ready', value: String(totals.avg || '—'), type: 'text' },
        { label: 'On time', value: String(totals.onTime || '—'), type: 'text' },
        { label: `Over ${amberMin} min`, value: n(totals.late), type: 'int' },
      ],
    };
  },
};

const DEFS: Def[] = [daily, items, categories, areas, tables, gst, payments, cash, discounts, voids, kotChanges, captains, kitchen];

export const REPORTS: ReportInfo[] = DEFS.map(({ key, title, group, description }) => ({ key, title, group, description }));

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** One report over business dates `from`..`to` (inclusive, at most 366 days). */
export function runReport(db: Db, key: string, from: string, to: string, timeZone: string): ReportTable {
  const def = DEFS.find((d) => d.key === key);
  if (!def) throw new PosError('NOT_FOUND', 'No such report.', { key });
  if (!DATE.test(from) || !DATE.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw new PosError('VALIDATION', 'Dates must be YYYY-MM-DD.');
  if (from > to) throw new PosError('VALIDATION', 'The start date must be on or before the end date.');
  if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000) throw new PosError('VALIDATION', 'Choose at most one year at a time.');
  const { key: k, title, group, description } = def;
  return { key: k, title, group, description, from, to, ...def.build({ db, from, to, timeZone }) };
}
