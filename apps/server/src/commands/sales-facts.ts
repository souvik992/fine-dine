// What a printed bill says about the sale, sent up with `bill.printed` for the portal's Analytics page (PosiNext Cloud
// hub/src/analytics.ts reads exactly these fields; all are optional there, so they can grow without breaking sync).
import type { BillBreakup } from '@dinepos/shared';
import type { OrderRow } from '../core/command-handler.js';
import type { Db } from '../db/connection.js';
import type { BillableItem } from './billing-support.js';

export interface SalesFacts {
  orderType: 'dine_in' | 'takeaway' | 'delivery';
  /** Where the order came from: this outlet's POS, or an online channel. */
  channel: 'pos' | 'website' | 'app' | 'swiggy' | 'zomato';
  /** The device that printed the bill ("Counter 1"), or null (an add-on or the server itself). */
  terminal: string | null;
  covers: number | null;
  taxPaise: number;
  discountPaise: number;
  lines: Array<{ name: string; category: string | null; qty: number; amountPaise: number }>;
}

export function salesFacts(db: Db, o: OrderRow, items: BillableItem[], breakup: Pick<BillBreakup, 'cgst' | 'sgst' | 'igst' | 'discount'>, deviceId: string | null): SalesFacts {
  let orderType: SalesFacts['orderType'] = o.type === 'online' ? 'delivery' : o.type;
  let channel: SalesFacts['channel'] = 'pos';
  if (o.type === 'online') {
    const json = db.prepare('SELECT order_json FROM online_order WHERE local_order_id = ?').pluck().get(o.id) as string | undefined;
    const online = json ? (JSON.parse(json) as { channel?: string; fulfilment?: string }) : null;
    if (online?.fulfilment && online.fulfilment !== 'DELIVERY') orderType = 'takeaway';
    if (online?.channel === 'website' || online?.channel === 'app' || online?.channel === 'swiggy' || online?.channel === 'zomato') channel = online.channel;
    else channel = 'website';
  }
  const categoryOf = new Map(
    (
      db
        .prepare('SELECT oi.id, c.name FROM order_item oi LEFT JOIN menu_item m ON m.id = oi.item_id LEFT JOIN category c ON c.id = m.category_id WHERE oi.order_id = ?')
        .all(o.id) as Array<{ id: string; name: string | null }>
    ).map((r) => [r.id, r.name]),
  );
  return {
    orderType,
    channel,
    terminal: deviceId ? ((db.prepare('SELECT name FROM device WHERE id = ?').pluck().get(deviceId) as string | undefined) ?? null) : null,
    covers: o.covers ?? null,
    taxPaise: breakup.cgst + breakup.sgst + breakup.igst,
    discountPaise: breakup.discount,
    lines: items.map((i) => ({
      name: i.name,
      category: categoryOf.get(i.id) ?? null,
      qty: i.qty,
      amountPaise: i.unitPricePaise * i.qty + i.addons.reduce((s, a) => s + a.pricePaise * a.qty, 0),
    })),
  };
}
