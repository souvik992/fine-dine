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
    const after = {
      id: p.id,
      name: p.name,
      transport: p.transport,
      host: p.transport === 'tcp' ? p.host : null,
      port: p.port,
      windows_name: p.transport === 'usb' ? p.windowsName : null,
      width_mm: p.widthMm,
      bitmap_text: bool(p.bitmapText),
      copies: p.copies,
      cutter: bool(p.cutter),
      backup_printer_id: p.backupPrinterId,
      role: p.role,
    };
    const before = upsertById(ctx.db, 'printer', after);
    auditUpsert(ctx, 'printer', p.id, before, after);
    ctx.emit('printers', 'printer.changed', { printerId: p.id });
    return { result: { id: p.id, created: !before } satisfies UpsertResult };
  },
});
