import { calculateBill, DEFAULT_BILL_DISPLAY } from '@dinepos/shared';
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

describe('bill display options (Settings › Bill design)', () => {
  const free = { ...doc, lines: [...doc.lines, { name: 'Dal Makhani', qty: 1, unitPricePaise: 0, amountPaise: 0, addons: [{ name: 'Mild', qty: 1, amountPaise: 0 }] }] };
  const show = (display: BillDocument['display'], paper: 58 | 80 = 80, d: BillDocument = doc) => renderBill({ ...d, display }, { paper }).preview;

  it('the default display is exactly the standard bill', () => {
    expect(show(null)).toBe(renderBill(doc, { paper: 80 }).preview);
    expect(show({ ...DEFAULT_BILL_DISPLAY })).toBe(renderBill(doc, { paper: 80 }).preview);
    for (const paper of [58, 80] as const) {
      expect(renderBill({ ...doc, display: DEFAULT_BILL_DISPLAY }, { paper }).bytes).toEqual(renderBill(doc, { paper }).bytes);
    }
  });

  it('hides what is switched off and never the legal fields', () => {
    const p = show({ ...DEFAULT_BILL_DISPLAY, showPhone: false, showCaptain: false, showCashier: false, showCovers: false, showTable: false, showTaxableAmount: false });
    for (const gone of ['Ph:', 'Captain', 'Cashier', 'Covers', 'Table T7', ' on ']) expect(p, gone).not.toContain(gone);
    for (const kept of ['GSTIN: 19ABCDE1234F1Z5', 'FSSAI:', 'TAX INVOICE', 'Bill: T1/26-27/000123', 'CGST @2.5%', 'TOTAL']) expect(p, kept).toContain(kept);
  });

  it('header lines, normal-size name, item count, no rate column', () => {
    const p = show({ ...DEFAULT_BILL_DISPLAY, nameSize: 'normal', headerLines: ['A unit of Spice Hospitality'], showItemCount: true, showRate: false });
    const lines = p.split('\n');
    expect(lines.findIndex((l) => l.includes('A unit of Spice Hospitality'))).toBeGreaterThan(lines.findIndex((l) => l.includes('Spice Garden')));
    expect(p).toContain('Items 3');
    expect(p).toMatch(/Qty 7\n/);
    expect(p).not.toContain('Rate');
    expect(p).toMatch(/Paneer Tikka\s+2\s+640\.00/);
    expect(show({ ...DEFAULT_BILL_DISPLAY, showRate: false }, 58)).toContain('  Qty 2');
  });

  it('free choices can be left off; priced add-ons always print', () => {
    expect(show(null, 80, free)).toContain('  + Mild');
    const p = show({ ...DEFAULT_BILL_DISPLAY, showFreeChoices: false }, 80, free);
    expect(p).not.toContain('Mild');
    expect(p).toContain('+ Extra cheese');
  });

  it('a logo prints as a centred raster image; a sample is marked top and bottom', () => {
    const logo = { width: 16, height: 2, data: new Uint8Array([0xff, 0x0f, 0xf0, 0xff]) };
    const r = renderBill({ ...doc, sample: true }, { paper: 58, logo });
    const lines = r.preview.split('\n');
    expect(lines[0]).toContain('SAMPLE - NOT A BILL');
    expect(lines[1]!.trim()).toBe('[logo]');
    expect(r.preview.trimEnd().split('\n').at(-1)).toContain('SAMPLE - NOT A BILL');
    // GS v 0, 48 bytes per row on 58 mm (384 dots): 23 bytes of padding, then the two logo bytes.
    const bytes = Array.from(r.bytes);
    const at = bytes.findIndex((b, i) => b === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30);
    expect(bytes.slice(at + 4, at + 8)).toEqual([25, 0, 2, 0]);
    expect(bytes.slice(at + 8 + 23, at + 8 + 25)).toEqual([0xff, 0x0f]);
    expect(() => renderBill(doc, { paper: 58, logo: { width: 392, height: 1, data: new Uint8Array(49) } })).toThrow(/wider than the paper/);
  });
});

describe('split parts (P2-05)', () => {
  it('a shared line prints its fraction of the whole line; parts print "Part 2 of 3"', () => {
    const share = { ...doc, part: { no: 2, of: 3 }, lines: [{ name: 'Paneer Tikka', qty: 2, qtyText: '1/3', unitPricePaise: 64_000, amountPaise: 21_333 }] };
    for (const paper of [80, 58] as const) {
      const p = renderBill(share, { paper }).preview;
      expect(p).toContain('Part 2 of 3');
      expect(p).toMatch(/1\/3 of 640\.00\s+213\.33/);
    }
  });
});

describe('void (P2-06)', () => {
  it('a void copy says VOID at the top and bottom with the reason', () => {
    const p = renderBill({ ...doc, voided: { reason: 'Wrong table billed', at: '02-11-26 22:10' } }, { paper: 80 }).preview;
    expect(p.split('\n')[0]).toContain('*** VOID ***');
    expect(p).toContain('Reason: Wrong table billed');
    expect(p).toContain('T1/26-27/000123'); // same number
  });
});
