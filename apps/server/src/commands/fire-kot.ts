import { fireKotSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { consumeForKot, stockChanged } from './stock-support.js';
import { issueKot, kotHeader } from './kot-support.js';
import { emitTableState, orderItemContext, reopenIfBilled, requireEditable, resolveStation } from './order-support.js';

interface HeldRow {
  id: string;
  item_id: string;
  name_snapshot: string;
  qty: number;
  note: string | null;
  course: number;
}

export const fireKot = defineCommand({
  type: 'FireKOT',
  schema: fireKotSchema,
  right: 'kot.fire',
  needsOrder: true,
  apply(ctx, p, order) {
    const o = order!;
    requireEditable(o);
    const { db } = ctx;

    const held = db.prepare(`SELECT id, item_id, name_snapshot, qty, note, course FROM order_item WHERE order_id = ? AND status = 'held' ORDER BY added_at, rowid`).all(o.id) as HeldRow[];
    let toFire: HeldRow[];
    if ('itemIds' in p) {
      const byId = new Map(held.map((h) => [h.id, h]));
      toFire = [...new Set(p.itemIds)].map((id) => {
        const row = byId.get(id);
        if (!row) throw new PosError('INVALID_STATE', 'That item is not waiting to be sent.', { orderItemId: id });
        return row;
      });
    } else if ('course' in p) {
      toFire = held.filter((h) => h.course === p.course);
    } else {
      toFire = held;
    }
    if (toFire.length === 0) throw new PosError('INVALID_STATE', 'Nothing to send to the kitchen.');

    // Route every item to its station (docs/06), then one KOT per station in a stable order.
    const { areaId } = orderItemContext(db, o);
    const byStation = new Map<string, HeldRow[]>();
    for (const item of toFire) {
      const stationId = resolveStation(db, areaId, item.item_id);
      if (!stationId) {
        throw new PosError('INVALID_STATE', `No kitchen station is set for ${item.name_snapshot}. Set one in Settings, Menu.`, { orderItemId: item.id });
      }
      byStation.set(stationId, [...(byStation.get(stationId) ?? []), item]);
    }
    const stations = db.prepare(`SELECT id, name FROM station WHERE id IN (${[...byStation.keys()].map(() => '?').join(',')}) ORDER BY name COLLATE NOCASE, id`).all(...byStation.keys()) as Array<{ id: string; name: string }>;

    const header = kotHeader(ctx, o);
    const addonsOf = db.prepare('SELECT name_snapshot AS name, qty FROM order_item_addon WHERE order_item_id = ? ORDER BY name_snapshot');
    const markFired = db.prepare(`UPDATE order_item SET status = 'fired', kot_id = ?, station_id = ? WHERE id = ?`);

    const stockTouched: string[] = [];
    const kots = stations.map((station) => {
      const items = byStation.get(station.id)!;
      const lines = items.map((i) => ({ qty: i.qty, name: i.name_snapshot, course: i.course, note: i.note, addons: addonsOf.all(i.id) as Array<{ name: string; qty: number }> }));
      const kot = issueKot(ctx, o, station, 'new', lines, header);
      for (const i of items) markFired.run(kot.id, station.id, i.id);
      // Recipe ingredients are used when the kitchen gets the ticket (docs/02 "Stock"); stock never blocks a KOT.
      stockTouched.push(...consumeForKot(ctx, kot.id, items.map((i) => i.id)));
      ctx.audit({ entity: 'kot', entityId: kot.id, action: 'kot.fire', after: { kotNo: kot.kotNo, stationId: station.id, orderItemIds: items.map((i) => i.id) } });
      return { id: kot.id, kotNo: kot.kotNo, stationId: station.id, orderItemIds: items.map((i) => i.id) };
    });

    if (stockTouched.length) stockChanged(ctx, stockTouched);
    db.prepare('UPDATE "order" SET last_kot_at = ? WHERE id = ?').run(ctx.nowIso, o.id);
    reopenIfBilled(ctx, o);
    emitTableState(ctx, o.table_id);
    return { result: { kots } };
  },
});
