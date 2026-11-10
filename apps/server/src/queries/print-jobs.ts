// The print alarm (terminals): tickets that did not print after the print queue's retries, recent ones only.
import type { FailedPrintJob } from '@dinepos/shared';
import type { Db } from '../db/connection.js';

/** Only recent failures ring: one from hours ago (before a restart) is not news any more. */
export const FAILED_WINDOW_MS = 30 * 60_000;

/**
 * Failed jobs from the last 30 minutes, oldest first. A failed job that was sent again (RetryPrintJobs) or copied to
 * the backup printer (print.reroute) is left out: its copy is the job now, and rings itself if it fails too.
 */
export function getFailedPrintJobs(db: Db, now: Date): FailedPrintJob[] {
  const since = new Date(now.getTime() - FAILED_WINDOW_MS).toISOString();
  const rows = db
    .prepare(
      `SELECT j.id, j.printer_id, p.name AS printer_name, j.doc_kind, j.ref_id, j.last_error, j.created_at, j.done_at,
              k.kot_no, t.label AS table_label, oo.number AS online_number,
              (SELECT bd.bill_no_text FROM bill_document bd WHERE bd.bill_id = j.ref_id ORDER BY bd.revision DESC LIMIT 1) AS bill_no
         FROM print_job j
         JOIN printer p ON p.id = j.printer_id
         LEFT JOIN kot k ON j.doc_kind = 'kot' AND k.id = j.ref_id
         LEFT JOIN "order" o ON o.id = k.order_id
         LEFT JOIN dining_table t ON t.id = o.table_id
         LEFT JOIN online_order oo ON oo.local_order_id = o.id
        WHERE j.state = 'failed' AND j.created_at >= ?
          AND NOT EXISTS (SELECT 1 FROM audit_event a WHERE a.entity = 'print_job' AND a.entity_id = j.id AND a.action IN ('print.retry', 'print.reroute'))
        ORDER BY j.created_at, j.id`,
    )
    .all(since) as Array<{
    id: string;
    printer_id: string;
    printer_name: string;
    doc_kind: FailedPrintJob['docKind'];
    ref_id: string | null;
    last_error: string | null;
    created_at: string;
    done_at: string | null;
    kot_no: number | null;
    table_label: string | null;
    online_number: string | null;
    bill_no: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    printerId: r.printer_id,
    printerName: r.printer_name,
    docKind: r.doc_kind,
    label: label(r),
    error: r.last_error,
    createdAt: r.created_at,
    failedAt: r.done_at,
  }));
}

function label(r: { doc_kind: FailedPrintJob['docKind']; kot_no: number | null; table_label: string | null; online_number: string | null; bill_no: string | null }): string {
  if (r.doc_kind === 'kot') {
    const where = r.table_label ? `Table ${r.table_label}` : r.online_number;
    return `KOT ${String(r.kot_no ?? 0).padStart(4, '0')}${where ? ` · ${where}` : ''}`;
  }
  if (r.doc_kind === 'bill') return r.bill_no ? `Bill ${r.bill_no}` : 'Bill';
  return { zreport: 'Day-end report', drawer: 'Cash drawer', test: 'Test page' }[r.doc_kind];
}
