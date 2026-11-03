// Shared by PayIn, PayOut and OpenDrawer (P2-06): the slip opens the drawer on the bill printer, where the cash
// drawer is plugged in.
import { renderCashSlip, type CashSlip } from '@dinepos/printing';
import { newId } from '@dinepos/shared';
import type { CommandContext } from '../core/context.js';
import { getConfig } from '../core/outlet-config.js';
import { billPrinter, printedDateTime, userName } from './billing-support.js';

/** A pay-in or pay-out row of the business date (day-end "cash expected" adds pay-ins and takes off pay-outs). */
export function recordCash(ctx: CommandContext, kind: 'pay_in' | 'pay_out', amountPaise: number, reason: string): string {
  const id = newId();
  ctx.db
    .prepare('INSERT INTO cash_movement (id, business_date, kind, amount_paise, reason, user_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, ctx.businessDate, kind, amountPaise, reason, ctx.actor.userId, ctx.nowIso);
  ctx.emit('cash', 'cash.changed', { kind, amountPaise });
  return id;
}

/** Prints the slip (and kicks the drawer) on the bill printer. Returns the printer id, or null when there is none. */
export function printCashSlip(ctx: CommandContext, kind: CashSlip['kind'], reason: string, amountPaise: number | null): string | null {
  const cfg = getConfig(ctx.db);
  const printer = billPrinter(ctx.db, cfg);
  if (!printer) return null;
  const when = printedDateTime(ctx.now, ctx.timeZone);
  const { bytes, preview } = renderCashSlip(
    { kind, outletName: cfg['outlet.name'], amountPaise, reason, by: userName(ctx.db, ctx.actor.userId), at: `${when.date} ${when.time}` },
    { paper: printer.paper },
  );
  ctx.print({ printerId: printer.id, docKind: 'drawer', refId: null, bytes, previewText: preview });
  return printer.id;
}
