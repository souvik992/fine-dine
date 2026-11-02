import { EscPos } from '@dinepos/printing';
import { ulidSchema } from '@dinepos/shared';
import { z } from 'zod';
import { defineCommand } from '../core/command-handler.js';
import { getConfig } from '../core/outlet-config.js';
import { requireRef } from './admin-support.js';
import { printedDateTime } from './billing-support.js';

export const printTestPageSchema = z.object({ printerId: ulidSchema }).strict();

/** Prints a short test page through the normal print queue (Settings › Kitchen & printers › Test print). */
export const printTestPage = defineCommand({
  type: 'PrintTestPage',
  schema: printTestPageSchema,
  right: 'admin',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    requireRef(ctx.db, 'printer', p.printerId, 'printerId');
    const printer = ctx.db.prepare('SELECT name, width_mm, transport, host, port, windows_name FROM printer WHERE id = ?').get(p.printerId) as {
      name: string;
      width_mm: number;
      transport: string;
      host: string | null;
      port: number | null;
      windows_name: string | null;
    };
    const when = printedDateTime(ctx.now, ctx.timeZone);
    const where = printer.transport === 'tcp' ? `${printer.host}:${printer.port ?? 9100}` : printer.transport === 'usb' ? `Windows printer "${printer.windows_name}"` : 'preview file';
    const page = new EscPos(printer.width_mm === 58 ? 58 : 80).init();
    page.bold(true).size(1, 2).center('DinePOS test page').size(1, 1).bold(false);
    page.center(getConfig(ctx.db)['outlet.name']).rule();
    page.twoCol('Printer', printer.name).twoCol('Connection', where).twoCol('Paper', `${printer.width_mm} mm`).twoCol('Printed', `${when.date} ${when.time}`).rule();
    page.line('ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789').center('If you can read this, the printer works.');
    page.feed(3).cut();
    ctx.print({ printerId: p.printerId, docKind: 'test', refId: null, bytes: page.bytes(), previewText: page.preview() });
    ctx.audit({ entity: 'printer', entityId: p.printerId, action: 'printer.test' });
    return { result: { printerId: p.printerId } };
  },
});
