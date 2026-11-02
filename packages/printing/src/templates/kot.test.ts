import { describe, expect, it } from 'vitest';
import { sanitize, wrapText } from '../escpos.js';
import { renderKot, type KotTicket } from './kot.js';

const ticket: KotTicket = {
  kotNo: 42,
  kind: 'new',
  orderType: 'dine_in',
  stationName: 'Tandoor',
  tableLabel: 'T7',
  areaName: 'Main Hall',
  covers: 4,
  captainName: 'Ravi',
  time: '20:14',
  date: '02-11-26',
  lines: [
    { qty: 2, name: 'Paneer Tikka', course: 1, addons: [{ name: 'Mild', qty: 1 }], note: 'less spicy' },
    { qty: 1, name: 'Tandoori Chicken (Half)', course: 1, addons: [] },
  ],
};

describe('renderKot', () => {
  it('80 mm preview', () => {
    expect(renderKot(ticket, { paper: 80 }).preview).toBe(
      [
        'KOT 0042',
        'Station: Tandoor                         DINE-IN',
        'Table T7 (Main Hall)                    Covers 4',
        'Captain: Ravi                    20:14  02-11-26',
        '------------------------------------------------',
        '2  Paneer Tikka',
        '     + Mild',
        '     ! less spicy',
        '1  Tandoori Chicken (Half)',
        '------------------------------------------------',
        '',
      ].join('\n'),
    );
  });

  it('58 mm preview wraps long names and shows courses when more than one', () => {
    const t: KotTicket = {
      ...ticket,
      lines: [
        { qty: 1, name: 'Paneer Butter Masala with extra gravy on the side', course: 1, addons: [] },
        { qty: 3, name: 'Gulab Jamun', course: 2, addons: [{ name: 'Extra syrup', qty: 2 }] },
      ],
    };
    expect(renderKot(t, { paper: 58 }).preview).toMatchInlineSnapshot(`
      "KOT 0042
      Station: Tandoor         DINE-IN
      Table T7 (Main Hall)    Covers 4
      Captain: Ravi    20:14  02-11-26
      --------------------------------
      Course 1
      1  Paneer Butter Masala with
         extra gravy on the side
      Course 2
      3  Gulab Jamun
           + 2 x Extra syrup
      --------------------------------
      "
    `);
  });

  it('takeaway has no table line; duplicates are marked', () => {
    const preview = renderKot({ ...ticket, orderType: 'takeaway', tableLabel: null, captainName: null, duplicate: true }, { paper: 80 }).preview;
    expect(preview.split('\n')[0]).toContain('** DUPLICATE **');
    expect(preview).toContain('TAKEAWAY');
    expect(preview).not.toContain('Table');
  });

  it('bytes start with ESC @ and end with a cut', () => {
    const { bytes } = renderKot(ticket, { paper: 80 });
    expect([...bytes.slice(0, 2)]).toEqual([0x1b, 0x40]);
    expect([...bytes.slice(-4)]).toEqual([0x1d, 0x56, 66, 3]);
    expect([...bytes].every((b) => b <= 0xff)).toBe(true);
  });
});

describe('text helpers', () => {
  it('sanitize keeps printable ASCII only', () => {
    expect(sanitize('Café ₹120 “hot” – now')).toBe('Caf? Rs120 "hot" - now');
  });

  it('wrapText splits long words', () => {
    expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapText('', 10)).toEqual(['']);
  });
});

describe('change slips (P2-04)', () => {
  const base = { kotNo: 43, orderType: 'dine_in' as const, stationName: 'Tandoor', tableLabel: 'T7', time: '21:10', date: '02-11-26' };

  it('a modify slip shows the KOT it changes, the quantity removed, what is left and the reason', () => {
    const p = renderKot({ ...base, kind: 'modify', forKotNo: 41, reason: 'Guest changed mind', lines: [{ qty: -1, nowQty: 2, name: 'Butter Naan', course: 1, addons: [] }] }, { paper: 80 }).preview;
    expect(p).toContain('MODIFIED KOT 0043');
    expect(p).toContain('Changes KOT 0041');
    expect(p).toMatch(/-1 Butter Naan/);
    expect(p).toContain('now 2');
    expect(p).toContain('Reason: Guest changed mind');
  });

  it('a cancel slip and a duplicate', () => {
    const p = renderKot({ ...base, kind: 'cancel', forKotNo: 41, reason: 'Wrong order', duplicate: true, lines: [{ qty: -2, name: 'Dal Makhani', course: 1, addons: [] }] }, { paper: 58 }).preview;
    expect(p.split('\n')[0]).toContain('** DUPLICATE **');
    expect(p.split('\n').slice(1, 3)).toEqual(['CANCELLED KOT', '0043']); // wraps on 58 mm, never cut
    expect(p).toMatch(/-2 Dal Makhani/);
    expect(p).not.toContain('now');
  });
});
