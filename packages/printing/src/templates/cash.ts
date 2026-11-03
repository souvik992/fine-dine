// Cash drawer slips (P2-06): pay-in, pay-out and "drawer opened", for the cash box and the audit trail.
import { EscPos, type PaperWidth } from '../escpos.js';
import { money } from '../layout.js';

export interface CashSlip {
  kind: 'pay_in' | 'pay_out' | 'drawer';
  outletName: string;
  amountPaise?: number | null;
  reason: string;
  by: string | null;
  /** Local "dd-mm-yy HH:MM". */
  at: string;
}

const TITLE: Record<CashSlip['kind'], string> = { pay_in: 'CASH PAID IN', pay_out: 'CASH PAID OUT', drawer: 'DRAWER OPENED' };

/** A short slip; the drawer opens with it (ESC p). */
export function renderCashSlip(s: CashSlip, opts: { paper: PaperWidth; feed?: number }): { bytes: Uint8Array; preview: string } {
  const p = new EscPos(opts.paper).init().drawerKick();
  p.bold(true).center(TITLE[s.kind]).bold(false);
  p.center(s.outletName).rule();
  if (s.amountPaise) p.bold(true).twoCol('Amount', `Rs ${money(s.amountPaise)}`).bold(false);
  p.wrapped(`Reason: ${s.reason}`);
  p.twoCol(s.by ? `By: ${s.by}` : '', s.at);
  if (s.kind === 'pay_out') p.line('').line('Received by: ____________________');
  p.feed(opts.feed ?? 3).cut();
  return { bytes: p.bytes(), preview: p.preview() };
}
