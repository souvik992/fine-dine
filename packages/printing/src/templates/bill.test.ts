import { calculateBill } from '@dinepos/shared';
import { describe, expect, it } from 'vitest';
import { halfPercent, percent, plainRupees } from '../layout.js';
import { renderBill, upiUri, type BillDocument } from './bill.js';

const breakup = calculateBill(
  [
    { id: 'a', qty: 2, unitPricePaise: 32_000, taxRateBp: 500 },
    { id: 'b', qty: 4, unitPricePaise: 6_000, taxRateBp: 500, addons: [{ qty: 1, pricePaise: 4_000 }] },
    { id: 'c', qty: 1, unitPricePaise: 18_000, taxRateBp: 1800 },
  ],
  { discount: { kind: 'pct', valueBp: 1000 }, serviceChargeBp: 1000 },
);

const doc: BillDocument = {
  outlet: {
    name: 'Spice Garden',
    addressLines: ['12 Park Street', 'Kolkata 700016'],
    gstin: '19ABCDE1234F1Z5',
    fssai: '12822999000123',
    phone: '033 4000 1234',
    footerLines: ['Thank you! Visit again.'],
  },
  billNo: 'T1/26-27/000123',
  date: '02-11-26',
  time: '21:05',
  orderType: 'dine_in',
  tableLabel: 'T7',
  areaName: 'Main Hall',
  covers: 4,
  captainName: 'Ravi',
  cashierName: 'Meena',
  lines: [
    { name: 'Paneer Tikka', qty: 2, unitPricePaise: 32_000, amountPaise: 64_000 },
    { name: 'Butter Naan', qty: 4, unitPricePaise: 6_000, amountPaise: 24_000, addons: [{ name: 'Extra cheese', qty: 1, amountPaise: 4_000 }] },
    { name: 'Fresh Lime Soda (Sweet) with extra mint', qty: 1, unitPricePaise: 18_000, amountPaise: 18_000 },
  ],
  breakup,
  discountReason: 'Regular guest',
  serviceChargeBp: 1000,
  upi: { vpa: 'spicegarden@okbank', payeeName: 'Spice Garden' },
};

describe('renderBill', () => {
  it('80 mm preview', () => {
    expect(renderBill(doc, { paper: 80 }).preview).toMatchInlineSnapshot(`
      "                  Spice Garden
                       12 Park Street
                       Kolkata 700016
                     Ph: 033 4000 1234
                   GSTIN: 19ABCDE1234F1Z5
                   FSSAI: 12822999000123
                        TAX INVOICE
      ------------------------------------------------
      Bill: T1/26-27/000123             02-11-26 21:05
      Table T7 (Main Hall)                    Covers 4
      Captain: Ravi                     Cashier: Meena
      ------------------------------------------------
      Item                    Qty      Rate     Amount
      Paneer Tikka              2    320.00     640.00
      Butter Naan               4     60.00     240.00
        + Extra cheese                           40.00
      Fresh Lime Soda           1    180.00     180.00
      (Sweet) with extra
      mint
      ------------------------------------------------
      Subtotal                                1,100.00
      Discount (Regular guest)                 -110.00
      Service charge @10%                        99.00
      CGST @2.5% on 910.80                       22.77
      SGST @2.5% on 910.80                       22.77
      CGST @9% on 178.20                         16.04
      SGST @9% on 178.20                         16.04
      Round off                                  +0.38
      ================================================
      TOTAL                                Rs 1,167.00
      ================================================
                Scan to pay with any UPI app
                          [UPI QR]
                  Thank you! Visit again.
      "
    `);
  });

  it('58 mm preview', () => {
    expect(renderBill(doc, { paper: 58 }).preview).toMatchInlineSnapshot(`
      "          Spice Garden
               12 Park Street
               Kolkata 700016
             Ph: 033 4000 1234
           GSTIN: 19ABCDE1234F1Z5
           FSSAI: 12822999000123
                TAX INVOICE
      --------------------------------
      Bill: T1/26-27/000123
                        02-11-26 21:05
      Table T7 (Main Hall)    Covers 4
      Captain: Ravi     Cashier: Meena
      --------------------------------
      Paneer Tikka
        2 x 320.00              640.00
      Butter Naan
        4 x 60.00               240.00
        + Extra cheese           40.00
      Fresh Lime Soda (Sweet) with
      extra mint
        1 x 180.00              180.00
      --------------------------------
      Subtotal                1,100.00
      Discount (Regular guest) -110.00
      Service charge @10%        99.00
      CGST @2.5%                 22.77
      SGST @2.5%                 22.77
      CGST @9%                   16.04
      SGST @9%                   16.04
      Round off                  +0.38
      ================================
      TOTAL                Rs 1,167.00
      ================================
        Scan to pay with any UPI app
                  [UPI QR]
          Thank you! Visit again.
      "
    `);
  });

  it('prints only figures from the breakup, and the total matches', () => {
    const preview = renderBill(doc, { paper: 80 }).preview;
    // 1,100 − 110 discount + 99 service + 77.62 GST = 1,166.62 → round-off +0.38
    expect(breakup.total).toBe(116_700);
    expect(preview).toContain('Rs 1,167.00');
    expect(preview).toContain('T1/26-27/000123');
    expect(preview).toContain('Round off');
  });

  it('marks duplicates and split parts; IGST when inter-state; no QR without UPI', () => {
    const preview = renderBill(
      { ...doc, duplicate: true, part: { no: 2, of: 3 }, interState: true, upi: null, breakup: calculateBill([{ id: 'x', qty: 1, unitPricePaise: 10_000, taxRateBp: 500 }], { interState: true }) },
      { paper: 80 },
    ).preview;
    expect(preview.split('\n')[0]).toContain('** DUPLICATE **');
    expect(preview).toContain('Part 2 of 3');
    expect(preview).toContain('IGST @5% on 100.00');
    expect(preview).not.toContain('CGST');
    expect(preview).not.toContain('[UPI QR]');
  });

  it('bytes contain a QR code command and end with a cut', () => {
    const { bytes } = renderBill(doc, { paper: 80 });
    const hex = Buffer.from(bytes).toString('hex');
    expect(hex).toContain('1d286b04003141'); // GS ( k: QR model select
    expect([...bytes.slice(-4)]).toEqual([0x1d, 0x56, 66, 3]);
  });
});

describe('layout helpers', () => {
  it('formats rates and UPI amounts without floats', () => {
    expect([percent(500), percent(250), percent(1800), percent(225)]).toEqual(['5', '2.5', '18', '2.25']);
    expect([halfPercent(500), halfPercent(1800), halfPercent(5), halfPercent(1250)]).toEqual(['2.5', '9', '0.025', '6.25']);
    expect(plainRupees(168_000)).toBe('1680.00');
    expect(upiUri('a@b', 'Spice Garden', 5, 'Bill T1/1')).toBe('upi://pay?pa=a%40b&pn=Spice%20Garden&am=0.05&cu=INR&tn=Bill%20T1%2F1');
  });
});

describe('free addons', () => {
  it('print without an amount', () => {
    const preview = renderBill({ ...doc, lines: [{ name: 'Paneer Tikka', qty: 1, unitPricePaise: 32_000, amountPaise: 32_000, addons: [{ name: 'Mild', qty: 1, amountPaise: 0 }] }] }, { paper: 80 }).preview;
    expect(preview.split('\n')).toContain('  + Mild'); // indented, no amount, no trailing spaces
  });
});
