// Bill appearance shared by PrintBill, the bill preview and PrintSampleBill (Settings › Bill design).
import type { BillDocument, BillLogoBits } from '@dinepos/printing';
import { base64ToBytes, calculateBill, financialYearAt, type OutletConfig } from '@dinepos/shared';
import { printedDateTime } from './billing-support.js';

/** The outlet part of a bill document, from settings. */
export function billOutlet(cfg: OutletConfig): BillDocument['outlet'] {
  return {
    name: cfg['outlet.name'],
    addressLines: cfg['outlet.addressLines'],
    gstin: cfg['outlet.gstin'],
    fssai: cfg['outlet.fssai'],
    phone: cfg['outlet.phone'],
    footerLines: cfg['bill.footerLines'],
  };
}

/** The saved logo as printer bits, or null. */
export function billLogoBits(cfg: Pick<OutletConfig, 'bill.logo'>): BillLogoBits | null {
  const l = cfg['bill.logo'];
  return l ? { width: l.width, height: l.height, data: base64ToBytes(l.bits) } : null;
}

const SAMPLE_LINES = [
  { id: 's1', name: 'Paneer Tikka', qty: 1, unitPricePaise: 32_000, taxRateBp: 500, addons: [{ name: 'Medium spicy', qty: 1, pricePaise: 0 }] },
  { id: 's2', name: 'Dal Makhani', qty: 1, unitPricePaise: 28_000, taxRateBp: 500, addons: [] },
  { id: 's3', name: 'Butter Naan', qty: 3, unitPricePaise: 6_000, taxRateBp: 500, addons: [{ name: 'Extra butter', qty: 1, pricePaise: 3_000 }] },
  { id: 's4', name: 'Fresh Lime Soda (Sweet)', qty: 2, unitPricePaise: 12_000, taxRateBp: 500, addons: [] },
];

/** A made-up dine-in bill with the outlet's settings, marked SAMPLE (never stored, never numbered). */
export function sampleBillDocument(cfg: OutletConfig, now: Date, timeZone: string): BillDocument {
  const scBp = cfg['bill.serviceChargeBp'];
  const breakup = calculateBill(
    SAMPLE_LINES.map((l) => ({ id: l.id, qty: l.qty, unitPricePaise: l.unitPricePaise, taxRateBp: l.taxRateBp, addons: l.addons.map((a) => ({ qty: a.qty, pricePaise: a.pricePaise })) })),
    { serviceChargeBp: scBp, roundOffStep: cfg['bill.roundOffStep'], roundOffTie: cfg['bill.roundOffTie'] },
  );
  const when = printedDateTime(now, timeZone);
  return {
    outlet: billOutlet(cfg),
    billNo: `${cfg['bill.prefix']}/${financialYearAt(now, timeZone)}/SAMPLE`,
    date: when.date,
    time: when.time,
    orderType: 'dine_in',
    tableLabel: 'T7',
    areaName: 'Main Hall',
    covers: 4,
    captainName: 'Ravi',
    cashierName: 'Meena',
    customer: { name: 'Guest name', phone: '98XXXXXX10', gstin: null },
    lines: SAMPLE_LINES.map((l) => ({
      name: l.name,
      qty: l.qty,
      unitPricePaise: l.unitPricePaise,
      amountPaise: l.unitPricePaise * l.qty,
      addons: l.addons.map((a) => ({ name: a.name, qty: a.qty, amountPaise: a.pricePaise * a.qty })),
    })),
    breakup,
    serviceChargeBp: scBp || null,
    interState: false,
    upi: cfg['bill.upiVpa'] ? { vpa: cfg['bill.upiVpa'], payeeName: cfg['bill.upiPayeeName'] ?? cfg['outlet.name'] } : null,
    display: cfg['bill.display'],
    sample: true,
  };
}
