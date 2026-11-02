import { renderBill } from '@dinepos/printing';
import { ulidSchema } from '@dinepos/shared';
import { z } from 'zod';
import { defineCommand } from '../core/command-handler.js';
import { getConfig } from '../core/outlet-config.js';
import { requireRef } from './admin-support.js';
import { billLogoBits, sampleBillDocument } from './bill-design.js';

export const printSampleBillSchema = z.object({ printerId: ulidSchema }).strict();

/**
 * Settings › Bill design › Print a sample: a made-up bill with the saved settings, marked "SAMPLE - NOT A BILL".
 * It takes no bill number and is not stored as a bill.
 */
export const printSampleBill = defineCommand({
  type: 'PrintSampleBill',
  schema: printSampleBillSchema,
  right: 'admin',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    requireRef(ctx.db, 'printer', p.printerId, 'printerId');
    const widthMm = ctx.db.prepare('SELECT width_mm FROM printer WHERE id = ?').pluck().get(p.printerId) as number;
    const cfg = getConfig(ctx.db);
    const { bytes, preview } = renderBill(sampleBillDocument(cfg, ctx.now, ctx.timeZone), { paper: widthMm === 58 ? 58 : 80, logo: billLogoBits(cfg) });
    ctx.print({ printerId: p.printerId, docKind: 'test', refId: null, bytes, previewText: preview });
    ctx.audit({ entity: 'printer', entityId: p.printerId, action: 'printer.sample_bill' });
    return { result: { printerId: p.printerId } };
  },
});
