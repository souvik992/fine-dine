import { newId, type CommandSuccess, type OrderSnapshot } from '@dinepos/shared';
import { getFloor } from '../queries/floor.js';
import { devSeedCommands, seedId } from '../seed/dev-seed.js';
import { TEST_NOW, type Harness } from './command-harness.js';

/** Seed ids used by the order tests (see src/seed/dev-seed.ts). */
export const S = {
  t1: seedId('table:main:1'),
  t2: seedId('table:main:2'),
  r1: seedId('table:terrace:1'),
  mainArea: seedId('area:main'),
  paneerTikka: seedId('item:PT'), // starters → Tandoor; spice level required
  butterNaan: seedId('item:BN'), // breads → Tandoor; extras optional
  dalMakhani: seedId('item:DM'), // mains → Kitchen
  virginMojito: seedId('item:VM'), // mocktails → Bar
  tandooriChicken: seedId('item:TC'), // variants Half / Full
  tcHalf: seedId('variant:TC:Half'),
  mild: seedId('addon:spice:mild'),
  hot: seedId('addon:spice:hot'),
  cheese: seedId('addon:extras:cheese'),
  butter: seedId('addon:extras:butter'),
  kitchen: seedId('station:kitchen'),
  tandoor: seedId('station:tandoor'),
  bar: seedId('station:bar'),
  kitchenPrinter: seedId('printer:kitchen'),
  tandoorPrinter: seedId('printer:tandoor'),
  mocktails: seedId('category:mocktails'),
};

export function seedOutlet(h: Harness): void {
  for (const c of devSeedCommands()) h.run(c.type, c.payload);
}

export interface OrderHelpers {
  open(tableId?: string, covers?: number): CommandSuccess;
  run(type: string, orderId: string, payload: unknown, opts?: { commandId?: string; expectedVersion?: number }): CommandSuccess;
  snapshot(res: CommandSuccess): OrderSnapshot;
  tableState(tableId: string): string;
}

/** Runs order commands at the order's current version unless told otherwise. */
export function orderHelpers(h: Harness): OrderHelpers {
  const version = (orderId: string) => h.db.prepare('SELECT version FROM "order" WHERE id = ?').pluck().get(orderId) as number;
  return {
    open: (tableId = S.t1, covers = 2) => h.run('OpenTable', { tableId, covers }),
    run: (type, orderId, payload, opts = {}) =>
      h.run(type, payload, { orderId, expectedVersion: opts.expectedVersion ?? version(orderId), commandId: opts.commandId ?? newId() }),
    snapshot: (res) => {
      if (!res.order) throw new Error('response has no order');
      return res.order;
    },
    tableState: (tableId) => getFloor(h.db, TEST_NOW(), 'Asia/Kolkata').tables.find((t) => t.id === tableId)!.state,
  };
}

export const line = (itemId: string, extra: Record<string, unknown> = {}) => ({ id: newId(), itemId, qty: 1, ...extra });
