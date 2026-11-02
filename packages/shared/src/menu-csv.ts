// Menu bulk upload (from TiffinPOS): a CSV file is checked row by row here, shown as a preview, and sent as one
// ImportMenu command (all rows or none). Pure: the server re-checks names and codes against the database.
import { z } from 'zod';
import { parseRupees } from './money.js';
import { ulidSchema } from './schemas/envelope.js';

/** Offered as "Download template". Columns are matched by header name, in any order. */
export const MENU_CSV_TEMPLATE =
  [
    'name,category,price,gst,code,veg,hsn',
    'Paneer Tikka,Starters,320,5,PT,veg,',
    'Chicken 65,Starters,340,5,C65,non-veg,',
    '"Dal Makhani, Butter",Mains,290,5,DM,veg,',
    'Fresh Lime Soda,Beverages,120,5,FLS,veg,',
  ].join('\r\n') + '\r\n';

export const MENU_CSV_MAX_ROWS = 1000;

/** GST rates a restaurant item can carry (basis points). */
export const ITEM_GST_RATES_BP = [0, 500, 1200, 1800, 2800] as const;

export const importMenuItemSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    category: z.string().trim().min(1).max(80),
    pricePaise: z.number().int().min(0).max(100_000_000_000),
    taxRateBp: z.number().int().min(0).max(2800),
    shortCode: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{1,8}$/)
      .transform((s) => s.toUpperCase())
      .nullable(),
    veg: z.boolean(),
    hsnSac: z.string().trim().regex(/^\d{4,8}$/).nullable(),
  })
  .strict();

export const importMenuSchema = z
  .object({
    /** Client-made id of the import, so a retried upload cannot add the items twice. */
    importId: ulidSchema,
    items: z.array(importMenuItemSchema).min(1).max(MENU_CSV_MAX_ROWS),
  })
  .strict();

export type ImportMenuItem = z.infer<typeof importMenuItemSchema>;
export type ImportMenuPayload = z.infer<typeof importMenuSchema>;

export interface MenuCsvProblem {
  /** 1-based line in the file (the header is line 1). */
  row: number;
  message: string;
}

export interface MenuCsvResult {
  items: Array<ImportMenuItem & { row: number }>;
  errors: MenuCsvProblem[];
}

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF, a UTF-8 BOM (Excel "CSV UTF-8"). Blank lines are skipped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // Excel "CSV UTF-8" starts with a BOM
  const endRow = () => {
    row.push(cur);
    cur = '';
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch !== '"') cur += ch;
      else if (src[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      endRow();
    } else cur += ch;
  }
  endRow();
  return rows;
}

const VEG = new Set(['veg', 'v', 'yes', 'y', '1', 'true', 'vegetarian', 'jain']);
const NON_VEG = new Set(['non-veg', 'nonveg', 'non veg', 'nv', 'no', 'n', '0', 'false', 'non-vegetarian', 'egg']);

/** "5", "5%", "12.0" → basis points, only for the GST slabs a restaurant item uses. */
function parseGst(raw: string): number | null {
  const m = /^(\d{1,2})(?:\.0{1,2})?\s*%?$/.exec(raw.trim());
  if (!m) return null;
  const bp = Number(m[1]) * 100;
  return (ITEM_GST_RATES_BP as readonly number[]).includes(bp) ? bp : null;
}

/** Category names compare without capitals or extra spaces: "  hot   DRINKS " is "Hot Drinks". */
export const categoryKey = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** Checks every row; rows with problems are listed in `errors` and left out of `items`. */
export function parseMenuCsv(text: string): MenuCsvResult {
  const rows = parseCsv(text);
  const errors: MenuCsvProblem[] = [];
  const items: MenuCsvResult['items'] = [];
  if (rows.length < 2) return { items, errors: [{ row: 1, message: 'The file has no items. Use the template: a header line, then one item per line.' }] };
  if (rows.length - 1 > MENU_CSV_MAX_ROWS) return { items, errors: [{ row: 1, message: `At most ${MENU_CSV_MAX_ROWS} items per file. Split it into smaller files.` }] };
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const col = (n: string) => header.indexOf(n);
  for (const need of ['name', 'category', 'price']) {
    if (col(need) < 0) errors.push({ row: 1, message: `The "${need}" column is missing.` });
  }
  if (errors.length) return { items, errors };

  const names = new Set<string>();
  const codes = new Set<string>();
  rows.slice(1).forEach((r, i) => {
    const row = i + 2;
    const v = (n: string) => (col(n) >= 0 ? (r[col(n)] ?? '').trim() : '');
    const fail = (message: string) => errors.push({ row, message });
    const name = v('name').replace(/\s+/g, ' ');
    if (!name) return fail('The name is empty.');
    if (name.length > 80) return fail('The name is longer than 80 characters.');
    if (names.has(name.toLowerCase())) return fail(`"${name}" appears twice in the file.`);
    names.add(name.toLowerCase());
    const category = v('category').replace(/\s+/g, ' ');
    if (!category) return fail('The category is empty.');
    if (category.length > 80) return fail('The category is longer than 80 characters.');
    let pricePaise: number;
    try {
      pricePaise = parseRupees(v('price').replace(/^₹\s*/, ''));
    } catch {
      return fail(`Price "${v('price')}" is not an amount in rupees, like 250 or 249.50.`);
    }
    const gstRaw = v('gst') || '5';
    const taxRateBp = parseGst(gstRaw);
    if (taxRateBp === null) return fail(`GST "${gstRaw}" must be 0, 5, 12, 18 or 28.`);
    const code = v('code').toUpperCase();
    if (code && !/^[A-Z0-9]{1,8}$/.test(code)) return fail(`Code "${v('code')}" must be letters and digits, up to 8.`);
    if (code && codes.has(code)) return fail(`Code ${code} appears twice in the file.`);
    if (code) codes.add(code);
    const vegRaw = v('veg').toLowerCase();
    const veg = vegRaw === '' || VEG.has(vegRaw) ? true : NON_VEG.has(vegRaw) ? false : null;
    if (veg === null) return fail(`Veg "${v('veg')}" is not understood. Use veg or non-veg.`);
    const hsn = v('hsn');
    if (hsn && !/^\d{4,8}$/.test(hsn)) return fail(`HSN/SAC "${hsn}" must be 4 to 8 digits.`);
    items.push({ row, name, category, pricePaise, taxRateBp, shortCode: code || null, veg, hsnSac: hsn || null });
  });
  return { items, errors };
}
