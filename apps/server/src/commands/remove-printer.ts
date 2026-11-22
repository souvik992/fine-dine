import { removePrinterSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';

/**
 * Settings › Printers › Remove (as quickPOS): a printer that never printed anything is deleted, with what points at it
 * (its stations' link, its print agent, other printers' backup, the bill printer setting). One with print history is
 * turned off instead, so every ticket it printed keeps its printer.
 */
export const removePrinter = defineCommand({
  type: 'RemovePrinter',
  schema: removePrinterSchema,
  right: 'admin',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    const { db } = ctx;
    const row = db.prepare('SELECT id, name, active FROM printer WHERE id = ?').get(p.printerId) as { id: string; name: string; active: number } | undefined;
    if (!row) throw new PosError('NOT_FOUND', 'Printer not found.', { printerId: p.printerId });
    if (db.prepare('SELECT 1 FROM print_job WHERE printer_id = ? LIMIT 1').get(p.printerId)) {
      db.prepare('UPDATE printer SET active = 0 WHERE id = ?').run(p.printerId);
      ctx.audit({ entity: 'printer', entityId: p.printerId, action: 'printer.update', before: { active: row.active === 1 }, after: { active: false }, reason: 'removed; kept for its print history' });
      ctx.emit('printers', 'printer.changed', { printerId: p.printerId });
      return { result: { removed: false, turnedOff: true } };
    }
    const stations = db.prepare('SELECT station_id FROM station_printer WHERE printer_id = ?').pluck().all(p.printerId) as string[];
    db.prepare('DELETE FROM station_printer WHERE printer_id = ?').run(p.printerId);
    db.prepare('DELETE FROM printer_agent WHERE printer_id = ?').run(p.printerId);
    db.prepare('UPDATE printer SET backup_printer_id = NULL WHERE backup_printer_id = ?').run(p.printerId);
    const billPrinter = db.prepare("SELECT value FROM config WHERE key = 'bill.printerId'").pluck().get() as string | undefined;
    const wasBillPrinter = billPrinter === JSON.stringify(p.printerId);
    if (wasBillPrinter) db.prepare("DELETE FROM config WHERE key = 'bill.printerId'").run(); // back to "the first bill printer"
    db.prepare('DELETE FROM printer WHERE id = ?').run(p.printerId);
    ctx.audit({ entity: 'printer', entityId: p.printerId, action: 'printer.delete', before: { name: row.name, stationIds: stations, billPrinter: wasBillPrinter } });
    ctx.emit('printers', 'printer.changed', { printerId: p.printerId });
    if (wasBillPrinter) ctx.emit('system', 'config.changed', { keys: ['bill.printerId'] });
    return { result: { removed: true, turnedOff: false } };
  },
});
