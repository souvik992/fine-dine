// Demo outlet for development (P1-05): 2 areas, 12 tables, 3 stations, 4 fake printers, 30 items with
// variants and addons. DEVELOPMENT ONLY. Ids are derived from stable keys, so re-running upserts the same
// rows instead of adding new ones.
import { createHash } from 'node:crypto';
import { CAPTAIN_ROLE_ID, CASHIER_ROLE_ID, MANAGER_ROLE_ID } from '@dinepos/shared';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Deterministic ULID-shaped id for a seed key (always starts with "01", so it sorts like a real ULID). */
export function seedId(key: string): string {
  const hash = createHash('sha256').update(`dinepos-dev-seed:${key}`).digest();
  let out = '01';
  for (let i = 0; out.length < 26; i++) out += CROCKFORD[hash[i]! % 32];
  return out;
}

export interface SeedCommand {
  type: string;
  payload: Record<string, unknown>;
}

const rupees = (r: number) => r * 100;
const GST_5 = 500;

const printers = [
  { key: 'kitchen', name: 'Kitchen printer', role: 'kot' },
  { key: 'tandoor', name: 'Tandoor printer', role: 'kot' },
  { key: 'bar', name: 'Bar printer', role: 'kot' },
  { key: 'bill', name: 'Bill printer', role: 'bill' },
] as const;

const stations = [
  { key: 'kitchen', name: 'Kitchen' },
  { key: 'tandoor', name: 'Tandoor' },
  { key: 'bar', name: 'Bar' },
] as const;
type StationKey = (typeof stations)[number]['key'];

const areas = [
  { key: 'main', name: 'Main Hall', prefix: 'T', count: 8, seats: 4 },
  { key: 'terrace', name: 'Terrace', prefix: 'R', count: 4, seats: 6 },
] as const;

const addonGroups = [
  {
    key: 'extras',
    name: 'Extras',
    minSelect: 0,
    maxSelect: 3,
    addons: [
      ['cheese', 'Extra cheese', 40],
      ['butter', 'Extra butter', 30],
      ['paneer', 'Extra paneer', 60],
    ],
  },
  {
    key: 'spice',
    name: 'Spice level',
    minSelect: 1,
    maxSelect: 1,
    addons: [
      ['mild', 'Mild', 0],
      ['medium', 'Medium', 0],
      ['hot', 'Hot', 0],
    ],
  },
  {
    key: 'mixers',
    name: 'Mixers',
    minSelect: 0,
    maxSelect: 1,
    addons: [
      ['soda', 'Soda', 30],
      ['tonic', 'Tonic water', 60],
    ],
  },
] as const;
type GroupKey = (typeof addonGroups)[number]['key'];

const categories = [
  { key: 'starters', name: 'Starters', station: 'tandoor' },
  { key: 'breads', name: 'Tandoor Breads', station: 'tandoor' },
  { key: 'mains', name: 'Main Course', station: 'kitchen' },
  { key: 'rice', name: 'Rice & Biryani', station: 'kitchen' },
  { key: 'desserts', name: 'Desserts', station: 'kitchen' },
  { key: 'beverages', name: 'Beverages', station: 'bar' },
  { key: 'mocktails', name: 'Mocktails', station: 'bar' },
] as const satisfies ReadonlyArray<{ key: string; name: string; station: StationKey }>;
type CategoryKey = (typeof categories)[number]['key'];

interface SeedItem {
  code: string;
  name: string;
  category: CategoryKey;
  price: number;
  veg: boolean;
  variants?: ReadonlyArray<readonly [string, number]>;
  groups?: readonly GroupKey[];
}

const items: SeedItem[] = [
  { code: 'PT', name: 'Paneer Tikka', category: 'starters', price: 320, veg: true, groups: ['spice'] },
  { code: 'HBK', name: 'Hara Bhara Kebab', category: 'starters', price: 260, veg: true },
  { code: 'CT', name: 'Chicken Tikka', category: 'starters', price: 360, veg: false, groups: ['spice'] },
  { code: 'TC', name: 'Tandoori Chicken', category: 'starters', price: 320, veg: false, variants: [['Half', 320], ['Full', 580]] },
  { code: 'FA', name: 'Fish Amritsari', category: 'starters', price: 420, veg: false },
  { code: 'VSR', name: 'Veg Spring Roll', category: 'starters', price: 240, veg: true },
  { code: 'CP', name: 'Chilli Paneer', category: 'starters', price: 300, veg: true, groups: ['spice'] },
  { code: 'BN', name: 'Butter Naan', category: 'breads', price: 60, veg: true, groups: ['extras'] },
  { code: 'GN', name: 'Garlic Naan', category: 'breads', price: 70, veg: true },
  { code: 'TR', name: 'Tandoori Roti', category: 'breads', price: 35, veg: true },
  { code: 'LP', name: 'Laccha Paratha', category: 'breads', price: 65, veg: true },
  { code: 'CN', name: 'Cheese Naan', category: 'breads', price: 90, veg: true },
  { code: 'DM', name: 'Dal Makhani', category: 'mains', price: 280, veg: true, groups: ['extras'] },
  { code: 'PBM', name: 'Paneer Butter Masala', category: 'mains', price: 320, veg: true, groups: ['extras'] },
  { code: 'BC', name: 'Butter Chicken', category: 'mains', price: 300, veg: false, variants: [['Half', 300], ['Full', 520]] },
  { code: 'KP', name: 'Kadai Paneer', category: 'mains', price: 310, veg: true, groups: ['spice'] },
  { code: 'RJ', name: 'Rogan Josh', category: 'mains', price: 460, veg: false, groups: ['spice'] },
  { code: 'CM', name: 'Chana Masala', category: 'mains', price: 240, veg: true },
  { code: 'VK', name: 'Veg Kolhapuri', category: 'mains', price: 260, veg: true, groups: ['spice'] },
  { code: 'JR', name: 'Jeera Rice', category: 'rice', price: 180, veg: true },
  { code: 'VB', name: 'Veg Biryani', category: 'rice', price: 280, veg: true, groups: ['spice'] },
  { code: 'CB', name: 'Chicken Biryani', category: 'rice', price: 340, veg: false, groups: ['spice'] },
  { code: 'MB', name: 'Mutton Biryani', category: 'rice', price: 420, veg: false, groups: ['spice'] },
  { code: 'GJ', name: 'Gulab Jamun', category: 'desserts', price: 120, veg: true },
  { code: 'RM', name: 'Rasmalai', category: 'desserts', price: 140, veg: true },
  { code: 'KF', name: 'Kulfi', category: 'desserts', price: 150, veg: true },
  { code: 'MC', name: 'Masala Chai', category: 'beverages', price: 60, veg: true },
  { code: 'LS', name: 'Lassi', category: 'beverages', price: 120, veg: true, variants: [['Sweet', 120], ['Salted', 120]] },
  { code: 'VM', name: 'Virgin Mojito', category: 'mocktails', price: 220, veg: true, groups: ['mixers'] },
  { code: 'FLS', name: 'Fresh Lime Soda', category: 'mocktails', price: 120, veg: true, variants: [['Sweet', 120], ['Salted', 120]] },
];

/** Demo owner created by first-run setup (DEVELOPMENT ONLY PINs). */
export const DEV_OWNER = { id: seedId('user:owner'), name: 'Asha (Owner)', pin: '1234' };
export const DEV_STAFF = [
  { key: 'manager', name: 'Vikram (Manager)', roleId: MANAGER_ROLE_ID, pin: '2345' },
  { key: 'cashier', name: 'Meena (Cashier)', roleId: CASHIER_ROLE_ID, pin: '1111' },
  { key: 'captain', name: 'Ravi (Captain)', roleId: CAPTAIN_ROLE_ID, pin: '3333' },
] as const;

/** First-run setup for the demo outlet (run once, before signing in). */
export function devSetupCommand(): SeedCommand {
  return { type: 'SetupOutlet', payload: { outletName: 'Spice Garden (DEMO)', ownerId: DEV_OWNER.id, ownerName: DEV_OWNER.name, pin: DEV_OWNER.pin } };
}

/** The seed as an ordered list of admin commands (referenced records first). */
export function devSeedCommands(): SeedCommand[] {
  const cmds: SeedCommand[] = [];
  for (const u of DEV_STAFF) {
    // No PIN on re-runs would be refused for a new person, so the PIN is always sent; it is the same value.
    cmds.push({ type: 'UpsertUser', payload: { id: seedId(`user:${u.key}`), name: u.name, roleId: u.roleId, pin: u.pin } });
  }
  cmds.push({
    type: 'SetConfig',
    payload: {
      values: {
        'outlet.name': 'Spice Garden (DEMO)',
        'outlet.addressLines': ['12 Park Street', 'Kolkata 700016'],
        'outlet.phone': '033 4000 1234',
        'bill.prefix': 'B',
        'bill.serviceChargeBp': 1000,
        'bill.upiVpa': 'spicegarden.demo@okbank',
      },
    },
  });
  for (const p of printers) {
    cmds.push({ type: 'UpsertPrinter', payload: { id: seedId(`printer:${p.key}`), name: p.name, transport: 'fake', role: p.role, widthMm: 80 } });
  }
  for (const s of stations) {
    cmds.push({ type: 'UpsertStation', payload: { id: seedId(`station:${s.key}`), name: s.name, printerIds: [seedId(`printer:${s.key}`)] } });
  }
  areas.forEach((a, sort) => {
    const areaId = seedId(`area:${a.key}`);
    cmds.push({ type: 'UpsertArea', payload: { id: areaId, name: a.name, sort } });
    for (let n = 1; n <= a.count; n++) {
      cmds.push({
        type: 'UpsertTable',
        payload: {
          id: seedId(`table:${a.key}:${n}`),
          areaId,
          label: `${a.prefix}${n}`,
          seats: a.seats,
          layoutX: ((n - 1) % 4) * 120,
          layoutY: Math.floor((n - 1) / 4) * 120,
        },
      });
    }
  });
  for (const g of addonGroups) {
    cmds.push({
      type: 'UpsertAddonGroup',
      payload: {
        id: seedId(`group:${g.key}`),
        name: g.name,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        addons: g.addons.map(([key, name, price]) => ({ id: seedId(`addon:${g.key}:${key}`), name, pricePaise: rupees(price) })),
      },
    });
  }
  categories.forEach((c, sort) => {
    cmds.push({ type: 'UpsertCategory', payload: { id: seedId(`category:${c.key}`), name: c.name, stationId: seedId(`station:${c.station}`), sort } });
  });
  items.forEach((i, sort) => {
    cmds.push({
      type: 'UpsertMenuItem',
      payload: {
        id: seedId(`item:${i.code}`),
        categoryId: seedId(`category:${i.category}`),
        name: i.name,
        shortCode: i.code,
        veg: i.veg,
        basePricePaise: rupees(i.price),
        taxRateBp: GST_5,
        hsnSac: '996331',
        sort,
        variants: (i.variants ?? []).map(([name, price], vSort) => ({
          id: seedId(`variant:${i.code}:${name}`),
          name,
          pricePaise: rupees(price),
          sort: vSort,
        })),
        addonGroupIds: (i.groups ?? []).map((g) => seedId(`group:${g}`)),
      },
    });
  });
  return cmds;
}

export const DEV_SEED_COUNTS = { areas: areas.length, tables: 12, stations: stations.length, items: items.length } as const;
