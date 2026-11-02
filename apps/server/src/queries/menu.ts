import type { MenuAddonGroup, MenuItem, MenuSnapshot, MenuUnchanged } from '@dinepos/shared';
import { currentMenuVersion } from '../commands/admin-support.js';
import { PosError } from '../core/errors.js';
import type { Db } from '../db/connection.js';

interface ItemRow {
  id: string;
  category_id: string;
  name: string;
  short_code: string | null;
  veg: number;
  base_price_paise: number;
  tax_rate_bp: number;
  hsn_sac: string | null;
  station_id: string | null;
  available: number;
  sort: number | null;
}

const opt = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

export interface MenuQuery {
  areaId?: string;
  since?: number;
}

/**
 * Active menu for the device's area (the area's price list overrides base and variant prices).
 * With `since` equal to the current menu version the answer is `{ unchanged: true }`.
 */
export function getMenu(db: Db, q: MenuQuery = {}): MenuSnapshot | MenuUnchanged {
  const menuVersion = currentMenuVersion(db);
  if (q.since !== undefined && q.since === menuVersion) return { menuVersion, unchanged: true };

  let priceListId: string | null = null;
  if (q.areaId) {
    const area = db.prepare('SELECT price_list_id FROM area WHERE id = ?').get(q.areaId) as { price_list_id: string | null } | undefined;
    if (!area) throw new PosError('NOT_FOUND', 'Area not found.', { areaId: q.areaId });
    priceListId = area.price_list_id;
  }
  const overrides = new Map<string, number>();
  if (priceListId) {
    const rows = db
      .prepare('SELECT item_id, variant_id, price_paise FROM price_list_entry WHERE price_list_id = ?')
      .all(priceListId) as Array<{ item_id: string; variant_id: string | null; price_paise: number }>;
    for (const r of rows) overrides.set(`${r.item_id}:${r.variant_id ?? ''}`, r.price_paise);
  }
  const price = (itemId: string, variantId: string | null, base: number) => overrides.get(`${itemId}:${variantId ?? ''}`) ?? base;

  const stations = (db.prepare('SELECT id, name, has_kds FROM station ORDER BY name COLLATE NOCASE').all() as Array<{ id: string; name: string; has_kds: number }>).map(
    (s) => ({ id: s.id, name: s.name, hasKds: s.has_kds === 1 }),
  );

  const categories = (
    db.prepare('SELECT id, name, parent_id, station_id, sort FROM category ORDER BY sort, name COLLATE NOCASE').all() as Array<{
      id: string;
      name: string;
      parent_id: string | null;
      station_id: string | null;
      sort: number | null;
    }>
  ).map((c) => ({ id: c.id, name: c.name, parentId: opt(c.parent_id), stationId: opt(c.station_id), sort: c.sort ?? 0 }));

  // Addons keep the order the owner entered them in (Mild, Medium, Hot), not alphabetical.
  const addonsByGroup = new Map<string, MenuAddonGroup['addons']>();
  for (const a of db.prepare('SELECT id, group_id, name, price_paise FROM addon ORDER BY rowid').all() as Array<{
    id: string;
    group_id: string;
    name: string;
    price_paise: number;
  }>) {
    addonsByGroup.set(a.group_id, [...(addonsByGroup.get(a.group_id) ?? []), { id: a.id, name: a.name, pricePaise: a.price_paise }]);
  }
  const addonGroups: MenuAddonGroup[] = (
    db.prepare('SELECT id, name, min_select, max_select FROM addon_group ORDER BY name COLLATE NOCASE').all() as Array<{
      id: string;
      name: string;
      min_select: number | null;
      max_select: number | null;
    }>
  ).map((g) => ({ id: g.id, name: g.name, minSelect: g.min_select ?? 0, maxSelect: g.max_select ?? 1, addons: addonsByGroup.get(g.id) ?? [] }));

  const variantsByItem = new Map<string, MenuItem['variants']>();
  for (const v of db.prepare('SELECT id, item_id, name, price_paise, sort FROM variant ORDER BY sort, name COLLATE NOCASE').all() as Array<{
    id: string;
    item_id: string;
    name: string;
    price_paise: number;
    sort: number | null;
  }>) {
    variantsByItem.set(v.item_id, [
      ...(variantsByItem.get(v.item_id) ?? []),
      { id: v.id, name: v.name, pricePaise: price(v.item_id, v.id, v.price_paise), sort: v.sort ?? 0 },
    ]);
  }
  const groupsByItem = new Map<string, string[]>();
  for (const l of db.prepare('SELECT item_id, group_id FROM item_addon_group ORDER BY group_id').all() as Array<{ item_id: string; group_id: string }>) {
    groupsByItem.set(l.item_id, [...(groupsByItem.get(l.item_id) ?? []), l.group_id]);
  }

  const items: MenuItem[] = (
    db.prepare('SELECT * FROM menu_item WHERE active = 1 ORDER BY sort, name COLLATE NOCASE').all() as ItemRow[]
  ).map((i) => ({
    id: i.id,
    categoryId: i.category_id,
    name: i.name,
    shortCode: opt(i.short_code),
    veg: i.veg === 1,
    pricePaise: price(i.id, null, i.base_price_paise),
    taxRateBp: i.tax_rate_bp,
    hsnSac: opt(i.hsn_sac),
    stationId: opt(i.station_id),
    available: i.available === 1,
    sort: i.sort ?? 0,
    variants: variantsByItem.get(i.id) ?? [],
    addonGroupIds: groupsByItem.get(i.id) ?? [],
  }));

  return { menuVersion, ...(q.areaId ? { areaId: q.areaId } : {}), stations, categories, addonGroups, items };
}
