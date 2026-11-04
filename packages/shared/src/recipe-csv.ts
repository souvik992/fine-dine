// Recipe bulk upload: a CSV of "what one dish (or size, or add-on) uses", checked row by row against the menu and the
// materials, shown as a preview, and sent as one ImportRecipes command (all recipes or none). Every dish, size or
// add-on named in the file gets exactly the recipe the file gives it; recipes not named stay as they are.
import { z } from 'zod';
import { parseCsv } from './menu-csv.js';
import { ulidSchema } from './schemas/envelope.js';
import { RECIPE_OWNERS } from './schemas/commands/stock.js';
import { formatQty, MAX_QTY_MILLI, parseQty, type StockUnit } from './stock.js';
import type { RecipeLineView } from './types.js';

export const RECIPE_CSV_HEADER = 'dish,size,addon,material,quantity';
export const RECIPE_CSV_MAX_ROWS = 5000;
const MAX_LINES_PER_RECIPE = 50;

export const importRecipesSchema = z
  .object({
    /** Client-made id of the upload, so a retried one is applied once. */
    importId: ulidSchema,
    recipes: z
      .array(
        z
          .object({
            ownerKind: z.enum(RECIPE_OWNERS),
            ownerId: ulidSchema,
            lines: z
              .array(z.object({ stockItemId: ulidSchema, qtyMilli: z.number().int().min(1).max(MAX_QTY_MILLI) }).strict())
              .min(1)
              .max(MAX_LINES_PER_RECIPE)
              .refine((ls) => new Set(ls.map((l) => l.stockItemId)).size === ls.length, { message: 'an ingredient appears twice' }),
          })
          .strict(),
      )
      .min(1)
      .max(2000)
      .refine((rs) => new Set(rs.map((r) => `${r.ownerKind}:${r.ownerId}`)).size === rs.length, { message: 'a recipe appears twice' }),
  })
  .strict();
export type ImportRecipesPayload = z.infer<typeof importRecipesSchema>;

/** What a CSV is checked against (the menu as GET /v1/menu gives it, and the active materials). */
export interface RecipeCsvContext {
  items: ReadonlyArray<{ id: string; name: string; variants: ReadonlyArray<{ id: string; name: string }> }>;
  addonGroups: ReadonlyArray<{ name: string; addons: ReadonlyArray<{ id: string; name: string }> }>;
  materials: ReadonlyArray<{ id: string; name: string; unit: StockUnit }>;
}

export interface ParsedRecipe {
  ownerKind: (typeof RECIPE_OWNERS)[number];
  ownerId: string;
  /** "Paneer Tikka", "Paneer Tikka (Full)", "Add-on: Extra cheese" */
  label: string;
  lines: Array<{ stockItemId: string; qtyMilli: number; material: string; unit: StockUnit }>;
}

export interface RecipeCsvResult {
  recipes: ParsedRecipe[];
  /** 1-based line in the file (the header is line 1). */
  errors: Array<{ row: number; message: string }>;
  rows: number;
}

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Checks every row; any problem is listed with its line. The recipes are complete only when `errors` is empty. */
export function parseRecipeCsv(text: string, ctx: RecipeCsvContext): RecipeCsvResult {
  const rows = parseCsv(text);
  const errors: RecipeCsvResult['errors'] = [];
  const none = (message: string): RecipeCsvResult => ({ recipes: [], errors: [{ row: 1, message }], rows: 0 });
  if (rows.length < 2) return none('The file has no recipe lines. Use the template: a header line, then one ingredient per line.');
  if (rows.length - 1 > RECIPE_CSV_MAX_ROWS) return none(`At most ${RECIPE_CSV_MAX_ROWS} lines per file. Split it into smaller files.`);
  const header = rows[0]!.map(key);
  const col = (n: string) => header.indexOf(n);
  const missing = ['dish', 'addon', 'material', 'quantity'].filter((n) => col(n) < 0);
  if (missing.length) return none(`The ${missing.map((m) => `"${m}"`).join(', ')} column${missing.length === 1 ? ' is' : 's are'} missing. The header must be: ${RECIPE_CSV_HEADER}`);

  const itemsByName = new Map<string, Array<RecipeCsvContext['items'][number]>>();
  for (const i of ctx.items) itemsByName.set(key(i.name), [...(itemsByName.get(key(i.name)) ?? []), i]);
  const addonsByName = new Map<string, Array<{ id: string; name: string; group: string }>>();
  for (const g of ctx.addonGroups) {
    for (const a of g.addons) {
      for (const k of [key(a.name), key(`${g.name} / ${a.name}`)]) addonsByName.set(k, [...(addonsByName.get(k) ?? []), { id: a.id, name: a.name, group: g.name }]);
    }
  }
  const materialsByName = new Map<string, Array<RecipeCsvContext['materials'][number]>>();
  for (const m of ctx.materials) materialsByName.set(key(m.name), [...(materialsByName.get(key(m.name)) ?? []), m]);

  const recipes = new Map<string, ParsedRecipe>();
  const cell = (r: string[], n: string) => (col(n) >= 0 ? (r[col(n)] ?? '').trim() : '');
  rows.slice(1).forEach((r, i) => {
    const row = i + 2;
    const problem = (message: string) => errors.push({ row, message });
    const dish = cell(r, 'dish');
    const size = cell(r, 'size');
    const addon = cell(r, 'addon');
    const material = cell(r, 'material');
    const quantity = cell(r, 'quantity');

    let owner: Pick<ParsedRecipe, 'ownerKind' | 'ownerId' | 'label'>;
    if (dish && addon) return problem('Fill in either the dish or the add-on, not both.');
    if (!dish && !addon) return problem('Fill in the dish (or the add-on) this ingredient is for.');
    if (dish) {
      const found = itemsByName.get(key(dish)) ?? [];
      if (found.length === 0) return problem(`"${dish}" is not on the menu.`);
      if (found.length > 1) return problem(`There are ${found.length} dishes named "${dish}". Rename one in Settings › Menu first.`);
      const item = found[0]!;
      if (size) {
        const v = item.variants.find((x) => key(x.name) === key(size));
        if (!v) return problem(`"${item.name}" has no size "${size}"${item.variants.length ? ` (sizes: ${item.variants.map((x) => x.name).join(', ')})` : ''}.`);
        owner = { ownerKind: 'variant', ownerId: v.id, label: `${item.name} (${v.name})` };
      } else owner = { ownerKind: 'item', ownerId: item.id, label: item.name };
    } else {
      if (size) return problem('An add-on has no size: leave the size empty.');
      const found = addonsByName.get(key(addon)) ?? [];
      if (found.length === 0) return problem(`The add-on "${addon}" is not on the menu.`);
      if (found.length > 1) return problem(`"${addon}" is in more than one add-on group (${found.map((a) => a.group).join(', ')}). Write it as "Group / Add-on".`);
      owner = { ownerKind: 'addon', ownerId: found[0]!.id, label: `Add-on: ${found[0]!.name}` };
    }

    if (!material) return problem('Fill in the material.');
    const mats = materialsByName.get(key(material)) ?? [];
    if (mats.length === 0) return problem(`"${material}" is not a material. Add it in Stock › Materials first (names must match).`);
    if (mats.length > 1) return problem(`There are ${mats.length} materials named "${material}".`);
    const mat = mats[0]!;
    const qtyMilli = parseQty(quantity);
    if (qtyMilli === null || qtyMilli <= 0) return problem(`The quantity "${quantity}" is not a number above 0 (in ${mat.unit}, up to 3 decimals).`);

    const k = `${owner.ownerKind}:${owner.ownerId}`;
    const recipe = recipes.get(k) ?? { ...owner, lines: [] };
    recipes.set(k, recipe);
    if (recipe.lines.some((l) => l.stockItemId === mat.id)) return problem(`${mat.name} appears twice for ${recipe.label}. Put the total on one line.`);
    if (recipe.lines.length >= MAX_LINES_PER_RECIPE) return problem(`${recipe.label} has more than ${MAX_LINES_PER_RECIPE} ingredients.`);
    recipe.lines.push({ stockItemId: mat.id, qtyMilli, material: mat.name, unit: mat.unit });
  });
  return { recipes: [...recipes.values()], errors, rows: rows.length - 1 };
}

const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/**
 * The recipes as a CSV in the upload format (download, edit, upload again). With no recipes yet: the header and two
 * example lines from this menu, as a template.
 */
export function recipesToCsv(lines: readonly RecipeLineView[], ctx: RecipeCsvContext): string {
  const material = new Map(ctx.materials.map((m) => [m.id, m.name]));
  const item = new Map(ctx.items.map((i) => [i.id, i.name]));
  const variant = new Map(ctx.items.flatMap((i) => i.variants.map((v) => [v.id, { dish: i.name, size: v.name }] as const)));
  const addonCount = new Map<string, number>();
  for (const g of ctx.addonGroups) for (const a of g.addons) addonCount.set(key(a.name), (addonCount.get(key(a.name)) ?? 0) + 1);
  const addon = new Map(ctx.addonGroups.flatMap((g) => g.addons.map((a) => [a.id, (addonCount.get(key(a.name)) ?? 0) > 1 ? `${g.name} / ${a.name}` : a.name] as const)));
  const out: string[][] = [];
  for (const l of lines) {
    const m = material.get(l.stockItemId);
    if (!m) continue; // a material no longer active
    const qty = formatQty(l.qtyMilli);
    if (l.ownerKind === 'item' && item.has(l.ownerId)) out.push([item.get(l.ownerId)!, '', '', m, qty]);
    else if (l.ownerKind === 'variant' && variant.has(l.ownerId)) out.push([variant.get(l.ownerId)!.dish, variant.get(l.ownerId)!.size, '', m, qty]);
    else if (l.ownerKind === 'addon' && addon.has(l.ownerId)) out.push(['', '', addon.get(l.ownerId)!, m, qty]);
  }
  out.sort((a, b) => (a[0] || a[2]!).localeCompare(b[0] || b[2]!) || a[1]!.localeCompare(b[1]!) || a[3]!.localeCompare(b[3]!));
  if (out.length === 0) {
    const dish = ctx.items[0]?.name ?? 'Paneer Tikka';
    const [m1, m2] = [ctx.materials[0]?.name ?? 'Paneer', ctx.materials[1]?.name ?? 'Onion'];
    out.push([dish, '', '', m1, '0.15'], [dish, '', '', m2, '0.05']);
  }
  return [RECIPE_CSV_HEADER, ...out.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n';
}
