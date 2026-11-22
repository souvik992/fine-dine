import { renderBill, type BillDocument } from '@dinepos/printing';
import { printOnlineOrderSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { getConfig } from '../core/outlet-config.js';
import { requireOnline, unprintedKots } from '../online/online-support.js';
import { billLogoBits } from './bill-design.js';
import { billPrinter } from './billing-support.js';
import { printStoredKot } from './kot-support.js';

/**
 * The order card's Print bill / Print KOT (quickPOS ODS): an online order accepted with printing off (Settings › Online
 * orders › When an order is accepted, print) prints its bill or KOTs now, as originals. Something that already printed
 * is printed again with Reprint (DUPLICATE, its own right and PIN), never here.
 */
export const printOnlineOrder = defineCommand({
  type: 'PrintOnlineOrder',
  schema: printOnlineOrderSchema,
  right: 'online.orders',
  needsOrder: false,
  apply(ctx, p) {
    const { db } = ctx;
    const oo = requireOnline(ctx, p.onlineOrderId);
    if (!oo.local_order_id) throw new PosError('INVALID_STATE', 'Accept the order first.');
    if (p.what === 'kot') {
      const kots = unprintedKots(db, oo.local_order_id);
      if (!kots.length) throw new PosError('INVALID_STATE', 'Its kitchen tickets have printed. Use Reprint KOT on the order to print one again.');
      for (const k of kots) printStoredKot(ctx, k);
      ctx.audit({ entity: 'order', entityId: oo.local_order_id, action: 'kot.print', after: { onlineOrderId: oo.id, kots: kots.length } });
      return { result: { printed: kots.length } };
    }
    if (!oo.bill_id) throw new PosError('INVALID_STATE', 'This order has no bill.');
    if (db.prepare("SELECT 1 FROM print_job WHERE doc_kind = 'bill' AND ref_id = ?").get(oo.bill_id)) {
      throw new PosError('INVALID_STATE', 'The bill has printed. Use Reprint on the bill to print it again.');
    }
    const doc = db.prepare('SELECT doc_json, bill_no_text FROM bill_document WHERE bill_id = ? ORDER BY revision DESC LIMIT 1').get(oo.bill_id) as
      | { doc_json: string; bill_no_text: string }
      | undefined;
    if (!doc) throw new PosError('INVALID_STATE', 'This bill has no stored copy.', { billId: oo.bill_id });
    const cfg = getConfig(db);
    const printer = billPrinter(db, cfg);
    if (!printer) throw new PosError('INVALID_STATE', 'No bill printer is set up. Add one in Settings › Printers.');
    const { bytes, preview } = renderBill(JSON.parse(doc.doc_json) as BillDocument, { paper: printer.paper, logo: billLogoBits(cfg) });
    ctx.print({ printerId: printer.id, docKind: 'bill', refId: oo.bill_id, bytes, previewText: preview });
    ctx.audit({ entity: 'bill', entityId: oo.bill_id, action: 'bill.print', after: { billNo: doc.bill_no_text, onlineOrderId: oo.id, late: true } });
    return { result: { printed: 1 } };
  },
});
