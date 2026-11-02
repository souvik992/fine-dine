import { categoryKey, importMenuSchema, newId } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { menuChanged } from './admin-support.js';

/**
 * Menu bulk upload (docs/03): every item or none. Categories are matched by name ignoring capitals and spaces;
 * missing ones are created. Names and short codes already on the menu are refused (edit those items instead).
 */
export const importMenu = defineCommand({
  type: 'ImportMenu',
  schema: importMenuSchema,
  right: 'admin',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    const { db } = ctx;
    const nameTaken = db.prepare('SELECT 1 FROM menu_item WHERE name = ? COLLATE NOCASE AND active = 1');
    const codeTaken = db.prepare('SELECT name FROM menu_item WHERE short_code = ?').pluck();
    const problems: Array<{ item: number; message: string }> = [];
    const names = new Set<string>();
    const codes = new Set<string>();
    p.items.forEach((it, i) => {
      const item = i + 1;
      if (names.has(it.name.toLowerCase())) problems.push({ item, message: `"${it.name}" appears twice.` });
      names.add(it.name.toLowerCase());
      if (nameTaken.get(it.name)) problems.push({ item, message: `"${it.name}" is already on the menu.` });
      if (it.shortCode) {
        const owner = codeTaken.get(it.shortCode) as string | undefined;
        if (owner !== undefined) problems.push({ item, message: `Code ${it.shortCode} is already used by ${owner}.` });
        else if (codes.has(it.shortCode)) problems.push({ item, message: `Code ${it.shortCode} appears twice.` });
        codes.add(it.shortCode);
      }
    });
    if (problems.length) {
      throw new PosError('VALIDATION', `${problems.length} problem(s) found. Nothing was imported.`, { problems: problems.slice(0, 100) });
    }

    const categories = new Map(
      (db.prepare('SELECT id, name FROM category ORDER BY sort, rowid').all() as Array<{ id: string; name: string }>).map((c) => [categoryKey(c.name), c.id]),
    );
    let sort = (db.prepare('SELECT coalesce(max(sort), 0) FROM category').pluck().get() as number) + 10;
    const newCategory = db.prepare('INSERT INTO category (id, name, sort) VALUES (?, ?, ?)');
    const newItem = db.prepare(
      `INSERT INTO menu_item (id, category_id, name, short_code, veg, base_price_paise, tax_rate_bp, hsn_sac) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const createdCategories: string[] = [];
    const itemIds: string[] = [];
    for (const it of p.items) {
      const key = categoryKey(it.category);
      let categoryId = categories.get(key);
      if (!categoryId) {
        categoryId = newId();
        newCategory.run(categoryId, it.category.trim().replace(/\s+/g, ' '), sort);
        sort += 10;
        categories.set(key, categoryId);
        createdCategories.push(it.category);
      }
      const id = newId();
      newItem.run(id, categoryId, it.name, it.shortCode, it.veg ? 1 : 0, it.pricePaise, it.taxRateBp, it.hsnSac);
      itemIds.push(id);
    }
    ctx.audit({ entity: 'menu', entityId: p.importId, action: 'menu.import', after: { items: p.items.length, createdCategories } });
    menuChanged(ctx, itemIds);
    return { result: { imported: itemIds.length, categoriesCreated: createdCategories.length } };
  },
});
