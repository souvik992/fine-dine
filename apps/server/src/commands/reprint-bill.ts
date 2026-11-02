import { renderBill, type BillDocument } from '@dinepos/printing';
import { reprintBillSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { getConfig } from '../core/outlet-config.js';
import { billLogoBits } from './bill-design.js';
import { billPrinter } from './billing-support.js';

/**
 * Prints the bill again from its stored document (latest revision), marked DUPLICATE (docs/03, docs/08): same
 * number, same figures. A superseded bill is printed again with PrintBill; a void one cannot be. Reprints are
 * counted from the audit log (a settled bill row is frozen). Leakage flag; PIN per role.
 */
export const reprintBill = defineCommand({
  type: 'ReprintBill',
  schema: reprintBillSchema,
  right: 'reprint',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    const { db } = ctx;
    const bill = db.prepare('SELECT id, state FROM bill WHERE id = ?').get(p.billId) as { id: string; state: string } | undefined;
    if (!bill) throw new PosError('NOT_FOUND', 'That bill does not exist.', { billId: p.billId });
    if (bill.state === 'superseded') throw new PosError('INVALID_STATE', 'Items changed after this bill was printed. Print the bill again (F9).', { state: bill.state });
    if (bill.state === 'void') throw new PosError('INVALID_STATE', 'This bill is void.', { state: bill.state });
    const doc = db.prepare('SELECT doc_json, bill_no_text FROM bill_document WHERE bill_id = ? ORDER BY revision DESC LIMIT 1').get(bill.id) as
      | { doc_json: string; bill_no_text: string }
      | undefined;
    if (!doc) throw new PosError('INVALID_STATE', 'This bill has no stored copy to reprint.', { billId: bill.id });
    const cfg = getConfig(db);
    const printer = billPrinter(db, cfg);
    if (!printer) throw new PosError('INVALID_STATE', 'No bill printer is set up. Add one in Settings, Kitchen & printers.');
    const { bytes, preview } = renderBill({ ...(JSON.parse(doc.doc_json) as BillDocument), duplicate: true }, { paper: printer.paper, logo: billLogoBits(cfg) });
    ctx.print({ printerId: printer.id, docKind: 'bill', refId: bill.id, bytes, previewText: preview });
    const reprint = (db.prepare("SELECT count(*) FROM audit_event WHERE entity_id = ? AND action = 'bill.reprint'").pluck().get(bill.id) as number) + 1;
    ctx.audit({ entity: 'bill', entityId: bill.id, action: 'bill.reprint', after: { billNo: doc.bill_no_text, reprint }, leakage: true });
    return { result: { billId: bill.id, billNo: doc.bill_no_text, reprint } };
  },
});
