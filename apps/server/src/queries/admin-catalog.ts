// Everything the Settings screens edit, as stored (inactive items included). Needs the `admin` right.
import type { Db } from '../db/connection.js';

export interface AdminCatalog {
  areas: Array<{ id: string; name: string; sort: number; priceListId: string | null; taxProfileId: string | null }>;
  tables: Array<{ id: string; areaId: string; label: string; seats: number | null; layoutX: number | null; layoutY: number | null; status: 'active' | 'reserved' | 'blocked'; occupied: boolean }>;
  printers: Array<{
    id: string;
    name: string;
    transport: 'tcp' | 'usb' | 'fake';
    host: string | null;
    port: number;
    windowsName: string | null;
    widthMm: 58 | 80;
    bitmapText: boolean;
    copies: number;
    cutter: boolean;
    backupPrinterId: string | null;
    role: 'kot' | 'bill' | 'both';
  }>;
  stations: Array<{ id: string; name: string; hasKds: boolean; printerIds: string[] }>;
  categories: Array<{ id: string; name: string; parentId: string | null; stationId: string | null; sort: number }>;
  addonGroups: Array<{ id: string; name: string; minSelect: number; maxSelect: number; addons: Array<{ id: string; name: string; pricePaise: number }> }>;
  items: Array<{
    id: string;
    categoryId: string;
    name: string;
    shortCode: string | null;
    veg: boolean;
    basePricePaise: number;
    taxRateBp: number;
    hsnSac: string | null;
    stationId: string | null;
    available: boolean;
    active: boolean;
    sort: number;
    variants: Array<{ id: string; name: string; pricePaise: number; sort: number }>;
    addonGroupIds: string[];
  }>;
}

const group = <T, K extends string>(rows: T[], key: (r: T) => K) => {
  const m = new Map<K, T[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return m;
};

export function getAdminCatalog(db: Db): AdminCatalog {
  const links = group(db.prepare('SELECT station_id, printer_id FROM station_printer ORDER BY printer_id').all() as Array<{ station_id: string; printer_id: string }>, (r) => r.station_id);
  const addons = group(
    db.prepare('SELECT id, group_id, name, price_paise FROM addon ORDER BY rowid').all() as Array<{ id: string; group_id: string; name: string; price_paise: number }>,
    (r) => r.group_id,
  );
  const variants = group(
    db.prepare('SELECT id, item_id, name, price_paise, sort FROM variant ORDER BY sort, rowid').all() as Array<{ id: string; item_id: string; name: string; price_paise: number; sort: number | null }>,
    (r) => r.item_id,
  );
  const itemGroups = group(db.prepare('SELECT item_id, group_id FROM item_addon_group ORDER BY rowid').all() as Array<{ item_id: string; group_id: string }>, (r) => r.item_id);

  return {
    areas: (db.prepare('SELECT * FROM area ORDER BY sort, name COLLATE NOCASE').all() as Array<{ id: string; name: string; sort: number | null; price_list_id: string | null; tax_profile_id: string | null }>).map(
      (a) => ({ id: a.id, name: a.name, sort: a.sort ?? 0, priceListId: a.price_list_id, taxProfileId: a.tax_profile_id }),
    ),
    tables: (
      db.prepare('SELECT * FROM dining_table ORDER BY label COLLATE NOCASE').all() as Array<{
        id: string;
        area_id: string;
        label: string;
        seats: number | null;
        layout_x: number | null;
        layout_y: number | null;
        status: 'active' | 'reserved' | 'blocked';
        open_order_id: string | null;
      }>
    ).map((t) => ({ id: t.id, areaId: t.area_id, label: t.label, seats: t.seats, layoutX: t.layout_x, layoutY: t.layout_y, status: t.status, occupied: t.open_order_id !== null })),
    printers: (
      db.prepare('SELECT * FROM printer ORDER BY name COLLATE NOCASE').all() as Array<{
        id: string;
        name: string;
        transport: 'tcp' | 'usb' | 'fake';
        host: string | null;
        port: number | null;
        windows_name: string | null;
        width_mm: number;
        bitmap_text: number;
        copies: number;
        cutter: number;
        backup_printer_id: string | null;
        role: 'kot' | 'bill' | 'both';
      }>
    ).map((p) => ({
      id: p.id,
      name: p.name,
      transport: p.transport,
      host: p.host,
      port: p.port ?? 9100,
      windowsName: p.windows_name,
      widthMm: p.width_mm === 58 ? 58 : 80,
      bitmapText: p.bitmap_text === 1,
      copies: p.copies,
      cutter: p.cutter === 1,
      backupPrinterId: p.backup_printer_id,
      role: p.role,
    })),
    stations: (db.prepare('SELECT id, name, has_kds FROM station ORDER BY name COLLATE NOCASE').all() as Array<{ id: string; name: string; has_kds: number }>).map((s) => ({
      id: s.id,
      name: s.name,
      hasKds: s.has_kds === 1,
      printerIds: (links.get(s.id) ?? []).map((l) => l.printer_id),
    })),
    categories: (db.prepare('SELECT * FROM category ORDER BY sort, name COLLATE NOCASE').all() as Array<{ id: string; name: string; parent_id: string | null; station_id: string | null; sort: number | null }>).map(
      (c) => ({ id: c.id, name: c.name, parentId: c.parent_id, stationId: c.station_id, sort: c.sort ?? 0 }),
    ),
    addonGroups: (db.prepare('SELECT * FROM addon_group ORDER BY name COLLATE NOCASE').all() as Array<{ id: string; name: string; min_select: number | null; max_select: number | null }>).map(
      (g) => ({
        id: g.id,
        name: g.name,
        minSelect: g.min_select ?? 0,
        maxSelect: g.max_select ?? 1,
        addons: (addons.get(g.id) ?? []).map((a) => ({ id: a.id, name: a.name, pricePaise: a.price_paise })),
      }),
    ),
    items: (
      db.prepare('SELECT * FROM menu_item ORDER BY sort, name COLLATE NOCASE').all() as Array<{
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
        active: number;
        sort: number | null;
      }>
    ).map((i) => ({
      id: i.id,
      categoryId: i.category_id,
      name: i.name,
      shortCode: i.short_code,
      veg: i.veg === 1,
      basePricePaise: i.base_price_paise,
      taxRateBp: i.tax_rate_bp,
      hsnSac: i.hsn_sac,
      stationId: i.station_id,
      available: i.available === 1,
      active: i.active === 1,
      sort: i.sort ?? 0,
      variants: (variants.get(i.id) ?? []).map((v) => ({ id: v.id, name: v.name, pricePaise: v.price_paise, sort: v.sort ?? 0 })),
      addonGroupIds: (itemGroups.get(i.id) ?? []).map((l) => l.group_id),
    })),
  };
}
