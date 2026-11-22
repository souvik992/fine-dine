import { upsertPrinterSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { auditUpsert, bool, requireRef, upsertById, type UpsertResult } from './admin-support.js';

export const upsertPrinter = defineCommand({
  type: 'UpsertPrinter',
  schema: upsertPrinterSchema,
  right: 'admin',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    requireRef(ctx.db, 'printer', p.backupPrinterId, 'backupPrinterId');
    if (p.backupPrinterId) {
      const backupOfBackup = ctx.db.prepare('SELECT backup_printer_id FROM printer WHERE id = ?').pluck().get(p.backupPrinterId);
      if (backupOfBackup === p.id) {
        throw new PosError('INVALID_STATE', 'Two printers cannot be each other’s backup.', { backupPrinterId: p.backupPrinterId });
      }
    }
    for (const s of p.stationIds ?? []) requireRef(ctx.db, 'station', s, 'stationIds');
    const after = {
      id: p.id,
      name: p.name,
      transport: p.transport,
      host: p.transport === 'tcp' ? p.host : null,
      port: p.port,
      windows_name: p.transport === 'usb' ? p.windowsName : null,
      device: p.transport === 'usbdirect' || p.transport === 'serial' ? p.device : null,
      width_mm: p.widthMm,
      bitmap_text: bool(p.bitmapText),
      copies: p.copies,
      cutter: bool(p.cutter),
      backup_printer_id: p.backupPrinterId,
      role: p.role,
      profile: p.profile,
      active: bool(p.active),
      drawer: bool(p.drawer && p.role !== 'kot'), // the drawer opens on cash bills, which a KOT-only printer never prints
    };
    const before = upsertById(ctx.db, 'printer', after);
    // Settings › Printers › "Kitchen tickets for": this printer's stations, set from the printer's side
    let stations: string[] | undefined;
    if (p.stationIds) {
      stations = p.role === 'bill' ? [] : [...new Set(p.stationIds)].sort();
      ctx.db.prepare('DELETE FROM station_printer WHERE printer_id = ?').run(p.id);
      const add = ctx.db.prepare('INSERT INTO station_printer (station_id, printer_id) VALUES (?, ?)');
      for (const s of stations) add.run(s, p.id);
    }
    auditUpsert(ctx, 'printer', p.id, before, stations ? { ...after, stationIds: stations } : after);
    // turned off: what was waiting for it stops waiting and rings in the print alarm (send it again or elsewhere)
    let released = 0;
    if (before && before.active === 1 && !p.active) {
      released = ctx.db
        .prepare(`UPDATE print_job SET state = 'failed', last_error = 'The printer was turned off.', done_at = ? WHERE printer_id = ? AND state IN ('queued', 'retry')`)
        .run(ctx.nowIso, p.id).changes;
    }
    ctx.emit('printers', 'printer.changed', { printerId: p.id });
    return { result: { id: p.id, created: !before, ...(released ? { released } : {}) } satisfies UpsertResult & { released?: number } };
  },
});
