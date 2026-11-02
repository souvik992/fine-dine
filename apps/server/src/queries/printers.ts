import type { Db } from '../db/connection.js';
import type { PrinterStatus } from '../print/print-queue.js';

export interface PrinterInfo {
  id: string;
  name: string;
  transport: 'tcp' | 'usb' | 'fake';
  role: 'kot' | 'bill' | 'both';
  widthMm: number;
  backupPrinterId?: string;
  status: PrinterStatus;
  queued: number;
  failedToday: number;
  lastError?: string;
}

/**
 * Printer list + status for `GET /v1/printers`. Status comes from the live worker when there is one,
 * otherwise from the queue: a job waiting to retry → retrying; last finished job failed → offline.
 */
export function getPrinters(db: Db, liveStatus?: (printerId: string) => PrinterStatus | undefined): PrinterInfo[] {
  const rows = db.prepare('SELECT id, name, transport, role, width_mm, backup_printer_id FROM printer ORDER BY name COLLATE NOCASE').all() as Array<{
    id: string;
    name: string;
    transport: PrinterInfo['transport'];
    role: PrinterInfo['role'];
    width_mm: number;
    backup_printer_id: string | null;
  }>;
  const pending = db.prepare(`SELECT count(*) FROM print_job WHERE printer_id = ? AND state IN ('queued', 'retry')`).pluck();
  const retrying = db.prepare(`SELECT 1 FROM print_job WHERE printer_id = ? AND state = 'retry' LIMIT 1`).pluck();
  const last = db.prepare(`SELECT state, last_error FROM print_job WHERE printer_id = ? AND state IN ('done', 'failed') ORDER BY done_at DESC, rowid DESC LIMIT 1`);
  const failedToday = db.prepare(`SELECT count(*) FROM print_job WHERE printer_id = ? AND state = 'failed' AND created_at >= ?`).pluck();
  const dayStart = new Date(Date.now() - 24 * 3600_000).toISOString();

  return rows.map((r) => {
    const lastRow = last.get(r.id) as { state: string; last_error: string | null } | undefined;
    const derived: PrinterStatus = retrying.get(r.id) ? 'retrying' : lastRow?.state === 'failed' ? 'offline' : 'ok';
    const lastError = lastRow?.state === 'failed' ? lastRow.last_error : null;
    return {
      id: r.id,
      name: r.name,
      transport: r.transport,
      role: r.role,
      widthMm: r.width_mm,
      ...(r.backup_printer_id ? { backupPrinterId: r.backup_printer_id } : {}),
      status: liveStatus?.(r.id) ?? derived,
      queued: pending.get(r.id) as number,
      failedToday: failedToday.get(r.id, dayStart) as number,
      ...(lastError ? { lastError } : {}),
    };
  });
}
