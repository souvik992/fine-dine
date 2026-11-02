import { describe, expect, it } from 'vitest';
import { importMenuSchema, MENU_CSV_TEMPLATE, parseCsv, parseMenuCsv } from './menu-csv.js';

describe('menu CSV upload', () => {
  it('reads quoted fields, doubled quotes, CRLF and an Excel BOM', () => {
    expect(parseCsv(String.fromCharCode(0xfeff) + 'a,"b, c","say ""hi"""\r\n\r\n1,2,3')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3'],
    ]);
  });

  it('the template parses cleanly and matches the command schema', () => {
    const r = parseMenuCsv(MENU_CSV_TEMPLATE);
    expect(r.errors).toEqual([]);
    expect(r.items.map((i) => i.name)).toEqual(['Paneer Tikka', 'Chicken 65', 'Dal Makhani, Butter', 'Fresh Lime Soda']);
    expect(r.items[1]).toMatchObject({ category: 'Starters', pricePaise: 34_000, taxRateBp: 500, shortCode: 'C65', veg: false, row: 3 });
    expect(importMenuSchema.safeParse({ importId: '01JX0000000000000000000001', items: r.items.map(({ row: _row, ...i }) => i) }).success).toBe(true);
  });

  it('columns in any order; gst defaults to 5%, veg to veg', () => {
    const r = parseMenuCsv('Price,Name,Category\n"₹ 1,250.50",Thali,Mains\n');
    expect(r.errors).toEqual([]);
    expect(r.items[0]).toMatchObject({ name: 'Thali', pricePaise: 125_050, taxRateBp: 500, veg: true, shortCode: null });
  });

  it('lists every bad row with its line number and keeps the good ones', () => {
    const r = parseMenuCsv(['name,category,price,gst,code,veg,hsn', 'A,X,abc', 'B,X,10,7', 'C,X,10,5,TOOLONGCODE', 'D,X,10,5,,maybe', 'a,X,10', 'E,,10', 'F,X,10,18,,,12', 'G,X,10,12%,g1,nv,996331'].join('\n'));
    expect(r.errors.map((e) => e.row)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(r.items).toMatchObject([{ name: 'G', taxRateBp: 1200, shortCode: 'G1', veg: false, hsnSac: '996331' }]);
  });

  it('refuses a file without the required columns or without rows', () => {
    expect(parseMenuCsv('name,price\nA,1').errors[0]?.message).toContain('"category"');
    expect(parseMenuCsv('name,category,price\n').errors).toHaveLength(1);
  });
});
