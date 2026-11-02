// Day-end Z-report (docs/06 "Z-report"). Lays out figures the server computed; adds nothing itself.
import { EscPos, type PaperWidth } from '../escpos.js';
import { money } from '../layout.js';

export interface ZReportData {
  outletName: string;
  businessDate: string;
  closedAt: string; // local "dd-mm-yy HH:MM"
  bills: number;
  covers: number;
  kots: number;
  grossSalesPaise: number;
  discountPaise: number;
  serviceChargePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  roundOffPaise: number;
  netSalesPaise: number;
  byMode: Array<{ mode: string; amountPaise: number }>;
  byArea: Array<{ name: string; bills: number; amountPaise: number }>;
  byCategory: Array<{ name: string; qty: number; amountPaise: number }>;
  cancelledAfterFire: number;
  cashExpectedPaise: number;
  cashCountedPaise: number;
}

const signed = (p: number) => `${p < 0 ? '-' : p > 0 ? '+' : ''}${money(Math.abs(p))}`;

export function renderZReport(z: ZReportData, opts: { paper: PaperWidth; feed?: number }): { bytes: Uint8Array; preview: string } {
  const p = new EscPos(opts.paper).init();
  p.bold(true).size(1, 2).center('Z REPORT').size(1, 1).bold(false);
  p.center(z.outletName);
  p.twoCol(`Business date ${z.businessDate}`, '');
  p.twoCol('Closed', z.closedAt);
  p.rule();
  p.twoCol('Bills', String(z.bills));
  p.twoCol('Covers', String(z.covers));
  p.twoCol('KOTs', String(z.kots));
  p.rule();
  p.twoCol('Gross sales', money(z.grossSalesPaise));
  p.twoCol('Discounts', `-${money(z.discountPaise)}`);
  p.twoCol('Service charge', money(z.serviceChargePaise));
  if (z.igstPaise) p.twoCol('IGST', money(z.igstPaise));
  p.twoCol('CGST', money(z.cgstPaise));
  p.twoCol('SGST', money(z.sgstPaise));
  p.twoCol('Round off', signed(z.roundOffPaise));
  p.bold(true).twoCol('NET SALES', money(z.netSalesPaise)).bold(false);
  p.rule();
  p.bold(true).line('Payments').bold(false);
  for (const m of z.byMode) p.twoCol(`  ${m.mode.toUpperCase()}`, money(m.amountPaise));
  p.bold(true).line('Areas').bold(false);
  for (const a of z.byArea) p.twoCol(`  ${a.name} (${a.bills})`, money(a.amountPaise));
  p.bold(true).line('Categories (before discount)').bold(false);
  for (const c of z.byCategory) p.twoCol(`  ${c.name} x${c.qty}`, money(c.amountPaise));
  p.rule();
  p.twoCol('Cancelled after KOT', String(z.cancelledAfterFire));
  p.twoCol('Cash expected', money(z.cashExpectedPaise));
  p.twoCol('Cash counted', money(z.cashCountedPaise));
  p.bold(true).twoCol('Difference', signed(z.cashCountedPaise - z.cashExpectedPaise)).bold(false);
  p.feed(opts.feed ?? 3).cut();
  return { bytes: p.bytes(), preview: p.preview() };
}
