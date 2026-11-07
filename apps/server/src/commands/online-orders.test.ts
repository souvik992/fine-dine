import { DEFAULT_ONLINE_SETTINGS, newId, type HubOrder, type OnlineSettings } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { getConfig } from '../core/outlet-config.js';
import { roleRights } from '../core/rights.js';
import { onlineItemId, priceOnlineOrder, publishedMenu } from '../online/menu.js';
import { seedId } from '../seed/dev-seed.js';
import { denyAll, TEST_NOW, useHarness } from '../testing/command-harness.js';
import { S, seedOutlet } from '../testing/order-fixture.js';

// P4-06: online orders through the hub — stored once, accepted into a KOT + GST bill at DinePOS prices, moved on.
const BC = seedId('item:BC');
const BC_FULL = seedId('variant:BC:Full');
let seq = 0;

describe('online orders', () => {
  const h = useHarness();
  const settings: OnlineSettings = { ...DEFAULT_ONLINE_SETTINGS, enabled: true, feeTaxBp: 1800, fulfilment: { pickup: true, delivery: true } };
  beforeEach(() => {
    seq = 0;
    seedOutlet(h);
    h.run('SetConfig', { values: { 'online.settings': settings } });
  });

  /** A hub order for 2 dal (with extra butter) and a full butter chicken, priced as DinePOS prices it unless `total` is given. */
  function hubOrder(over: Partial<HubOrder> = {}): HubOrder {
    const base: HubOrder = {
      id: `ord_${newId()}`,
      number: 'W-1042',
      storeId: 'st_1',
      channel: 'website',
      state: 'SENT_TO_STORE',
      fulfilment: 'PICKUP',
      payment: 'ONLINE',
      paid: true,
      customer: { name: 'Priya', mobile: '9830012345', verified: true },
      address: null,
      lines: [
        { itemId: S.dalMakhani, name: 'Dal Makhani', qtyMilli: 2000, unitPrice: 28_000, modifiers: [{ id: S.butter, name: 'Extra butter', price: 3_000 }], note: 'less spicy', lineTotal: 0 },
        { itemId: onlineItemId(BC, BC_FULL), name: 'Butter Chicken (Full)', qtyMilli: 1000, unitPrice: 52_000, modifiers: [], note: null, lineTotal: 0 },
      ],
      note: null,
      itemsTotal: 0,
      deliveryFee: 0,
      packagingFee: 0,
      total: 0,
      distanceKm: null,
      location: null,
      prepMinutes: null,
      etaAt: null,
      menuVersion: 1,
      placedAt: TEST_NOW().getTime(),
      acceptBy: null,
      rider: null,
      posBillNo: null,
      rejectReason: null,
      reasonText: null,
      ...over,
    };
    if (over.total === undefined) base.total = priceOnlineOrder(h.db, base, getConfig(h.db)['online.settings'], getConfig(h.db)).totalPaise;
    return base;
  }
  const receive = (o: HubOrder) => {
    h.run('ApplyHubEvent', { event: { seq: ++seq, type: 'order.created', at: TEST_NOW().getTime(), order: o } });
    return o;
  };
  const row = (id: string) => h.db.prepare('SELECT * FROM online_order WHERE id = ?').get(id) as { state: string; local_order_id: string | null; bill_id: string | null; alert: string | null; pos_total_paise: number };
  const outbox = (id: string) => h.db.prepare('SELECT action, body_json, idem_key FROM online_outbox WHERE order_id = ? ORDER BY id').all(id) as Array<{ action: string; body_json: string; idem_key: string }>;

  it('an order from the hub is stored once and confirmed (received); a replayed event is ignored', () => {
    const o = receive(hubOrder());
    h.run('ApplyHubEvent', { event: { seq, type: 'order.created', at: 0, order: o } }); // the same event again
    expect(h.count('online_order')).toBe(1);
    expect(outbox(o.id)).toEqual([{ action: 'received', body_json: '{}', idem_key: `rcv-${o.id}` }]);
    expect(h.db.prepare('SELECT last_seq FROM online_link').pluck().get()).toBe(1);
  });

  it('accept (pickup, paid online): KOT with the order number, GST bill at DinePOS prices, settled as Online; the hub is told', () => {
    const o = receive(hubOrder());
    const res = h.run('AcceptOnlineOrder', { onlineOrderId: o.id });
    const r = row(o.id);
    expect(r).toMatchObject({ state: 'ACCEPTED', alert: null, pos_total_paise: o.total });
    const local = h.db.prepare('SELECT type, table_id, state, customer_phone FROM "order" WHERE id = ?').get(r.local_order_id) as Record<string, unknown>;
    expect(local).toEqual({ type: 'online', table_id: null, state: 'settled', customer_phone: '9830012345' });
    const ticket = JSON.parse(h.db.prepare('SELECT ticket_json FROM kot_document LIMIT 1').pluck().get() as string) as { orderRef: string; lines: Array<{ name: string; note: string | null }> };
    expect(ticket.orderRef).toBe('W-1042 · PICKUP · PAID ONLINE');
    const doc = JSON.parse(h.db.prepare('SELECT doc_json FROM bill_document WHERE bill_id = ?').pluck().get(r.bill_id) as string) as { orderRef: string; breakup: { serviceCharge: number; total: number } };
    expect(doc.orderRef).toBe('W-1042 · PICKUP · PAID ONLINE');
    expect(doc.breakup).toMatchObject({ serviceCharge: 0, total: o.total });
    expect(h.db.prepare('SELECT mode, amount_paise, ref FROM payment WHERE bill_id = ?').all(r.bill_id)).toEqual([{ mode: 'online', amount_paise: o.total, ref: 'W-1042' }]);
    const accept = outbox(o.id).find((x) => x.action === 'accept')!;
    expect(JSON.parse(accept.body_json)).toMatchObject({ prepMinutes: 25, posBillNo: (res.result as { billNo: string }).billNo });
    // accepting again (a retry) gives the same answer and bills nothing more
    expect(h.run('AcceptOnlineOrder', { onlineOrderId: o.id }).result).toMatchObject({ billId: r.bill_id });
    expect(h.count('bill')).toBe(1);
  });

  it('a delivery order is billed with the delivery charge and its GST; cash on delivery is settled in cash when delivered', () => {
    // One dal (₹294 with GST): under the ₹500 free-delivery mark of the first band, so the ₹20 charge applies.
    const lines = [{ itemId: S.dalMakhani, name: 'Dal Makhani', qtyMilli: 1000, unitPrice: 28_000, modifiers: [], note: null, lineTotal: 0 }];
    const o = receive(hubOrder({ lines, fulfilment: 'DELIVERY', payment: 'COD', paid: false, distanceKm: 2.4, address: { line1: '12 Park St', line2: null, landmark: null, city: 'Kolkata', pincode: '700016' } }));
    h.run('AcceptOnlineOrder', { onlineOrderId: o.id, prepMinutes: 30 });
    const r = row(o.id);
    const fee = h.db.prepare("SELECT name_snapshot, unit_price_paise, tax_rate_bp, status, kot_id FROM order_item WHERE item_id = 'fee:delivery'").get() as Record<string, unknown>;
    expect(fee).toEqual({ name_snapshot: 'Delivery charge', unit_price_paise: 2_000, tax_rate_bp: 1800, status: 'fired', kot_id: null }); // never on a KOT
    expect(h.db.prepare('SELECT state FROM bill WHERE id = ?').pluck().get(r.bill_id)).toBe('printed'); // COD: paid at the door
    h.fail('AdvanceOnlineOrder', { onlineOrderId: o.id, to: 'OUT_FOR_DELIVERY', rider: { name: 'Raju' } }, 'INVALID_STATE'); // not ready yet
    h.run('AdvanceOnlineOrder', { onlineOrderId: o.id, to: 'READY' });
    expect(h.fail('AdvanceOnlineOrder', { onlineOrderId: o.id, to: 'OUT_FOR_DELIVERY' }, 'VALIDATION').message).toMatch(/rider/);
    h.fail('AdvanceOnlineOrder', { onlineOrderId: o.id, to: 'PICKED_UP' }, 'INVALID_STATE'); // a delivery order
    h.run('AdvanceOnlineOrder', { onlineOrderId: o.id, to: 'OUT_FOR_DELIVERY', rider: { name: 'Raju', phone: '9000000001' } });
    h.run('AdvanceOnlineOrder', { onlineOrderId: o.id, to: 'DELIVERED' });
    expect(h.db.prepare('SELECT mode, amount_paise FROM payment WHERE bill_id = ?').all(r.bill_id)).toEqual([{ mode: 'cash', amount_paise: o.total }]);
    expect(outbox(o.id).map((x) => x.action)).toEqual(['received', 'accept', 'state', 'state', 'state']);
  });

  it('cash on delivery: the payment is taken when delivered or collected (UPI, card, split, cash with change); due or free is refused', () => {
    const lines = [{ itemId: S.dalMakhani, name: 'Dal Makhani', qtyMilli: 1000, unitPrice: 28_000, modifiers: [], note: null, lineTotal: 0 }];
    const payments = (billId: string) => h.db.prepare('SELECT mode, amount_paise AS amount, ref FROM payment WHERE bill_id = ? ORDER BY mode').all(billId);

    // pickup, paid by UPI at the counter
    const a = receive(hubOrder({ lines, fulfilment: 'PICKUP', payment: 'COD', paid: false }));
    h.run('AcceptOnlineOrder', { onlineOrderId: a.id, prepMinutes: 10 });
    h.run('AdvanceOnlineOrder', { onlineOrderId: a.id, to: 'READY' });
    const totalA = h.db.prepare('SELECT total_paise FROM bill WHERE id = ?').pluck().get(row(a.id).bill_id) as number;
    expect(h.fail('AdvanceOnlineOrder', { onlineOrderId: a.id, to: 'PICKED_UP', tenders: [{ mode: 'due', amountPaise: totalA }] }, 'VALIDATION').message).toMatch(/cancel the order/);
    expect(h.fail('AdvanceOnlineOrder', { onlineOrderId: a.id, to: 'PICKED_UP', tenders: [{ mode: 'upi', amountPaise: totalA - 100 }] }, 'INVALID_STATE').message).toMatch(/still to be paid/);
    expect(h.fail('AdvanceOnlineOrder', { onlineOrderId: a.id, to: 'PICKED_UP', tenders: [{ mode: 'card', amountPaise: totalA + 100 }] }, 'VALIDATION').message).toMatch(/Only cash can give change/);
    expect(row(a.id).state).toBe('READY'); // nothing happened
    h.run('AdvanceOnlineOrder', { onlineOrderId: a.id, to: 'PICKED_UP', tenders: [{ mode: 'upi', amountPaise: totalA, ref: 'UPI 4411' }] });
    expect(payments(row(a.id).bill_id!)).toEqual([{ mode: 'upi', amount: totalA, ref: 'UPI 4411' }]);
    expect(row(a.id).state).toBe('PICKED_UP');

    // delivery, part card part cash, the cash with change
    const b = receive(hubOrder({ lines, fulfilment: 'DELIVERY', payment: 'COD', paid: false, distanceKm: 2.4, address: { line1: '1 Lake Rd', line2: null, landmark: null, city: 'Kolkata', pincode: '700029' } }));
    h.run('AcceptOnlineOrder', { onlineOrderId: b.id, prepMinutes: 20 });
    h.run('AdvanceOnlineOrder', { onlineOrderId: b.id, to: 'READY' });
    h.fail('AdvanceOnlineOrder', { onlineOrderId: b.id, to: 'OUT_FOR_DELIVERY', rider: { name: 'Raju' }, tenders: [{ mode: 'cash', amountPaise: 100 }] }, 'VALIDATION'); // only when finishing
    h.run('AdvanceOnlineOrder', { onlineOrderId: b.id, to: 'OUT_FOR_DELIVERY', rider: { name: 'Raju' } });
    const totalB = h.db.prepare('SELECT total_paise FROM bill WHERE id = ?').pluck().get(row(b.id).bill_id) as number;
    const res = h.run('AdvanceOnlineOrder', { onlineOrderId: b.id, to: 'DELIVERED', tenders: [{ mode: 'card', amountPaise: 10_000 }, { mode: 'cash', amountPaise: totalB - 10_000 + 5_000 }] });
    expect(res.result).toEqual({ state: 'DELIVERED', changePaise: 5_000 });
    expect(payments(row(b.id).bill_id!)).toEqual([{ mode: 'card', amount: 10_000, ref: null }, { mode: 'cash', amount: totalB - 10_000, ref: null }]);
  });

  it('an order paid online takes no payment when delivered', () => {
    const o = receive(hubOrder({ fulfilment: 'PICKUP' }));
    h.run('AcceptOnlineOrder', { onlineOrderId: o.id, prepMinutes: 10 });
    h.run('AdvanceOnlineOrder', { onlineOrderId: o.id, to: 'READY' });
    h.fail('AdvanceOnlineOrder', { onlineOrderId: o.id, to: 'PICKED_UP', tenders: [{ mode: 'cash', amountPaise: 100 }] }, 'VALIDATION');
  });

  it('a total the customer was not shown is refused unless staff accept the DinePOS price (then flagged)', () => {
    const o = receive(hubOrder({ total: 100_000 }));
    const err = h.fail('AcceptOnlineOrder', { onlineOrderId: o.id }, 'INVALID_STATE');
    expect(err.details).toMatchObject({ reason: 'price', customerTotalPaise: 100_000 });
    expect(h.count('bill')).toBe(0);
    h.run('AcceptOnlineOrder', { onlineOrderId: o.id, acceptPriceChange: true });
    expect(row(o.id).alert).toMatch(/Billed at the DinePOS price ₹[\d,.]+ \(the customer was shown ₹1,000.00\)/);
    expect(h.db.prepare('SELECT ref FROM payment').pluck().get()).toMatch(/W-1042 \(customer paid ₹1,000.00\)/);
  });

  it('reject with a reason; an accepted order is cancelled instead, which voids its bill (bill.void)', () => {
    const a = receive(hubOrder());
    h.run('RejectOnlineOrder', { onlineOrderId: a.id, reason: 'TOO_BUSY' });
    expect(row(a.id).state).toBe('REJECTED');
    expect(JSON.parse(outbox(a.id).at(-1)!.body_json)).toEqual({ reason: 'TOO_BUSY', reasonText: null });

    const b = receive(hubOrder({ number: 'W-1043' }));
    h.run('AcceptOnlineOrder', { onlineOrderId: b.id });
    h.fail('RejectOnlineOrder', { onlineOrderId: b.id, reason: 'OTHER' }, 'INVALID_STATE');
    expect(h.fail('CancelOnlineOrder', { onlineOrderId: b.id, reason: 'Kitchen fire' }, 'FORBIDDEN', { rights: denyAll }).details).toEqual({ right: 'bill.void' });
    h.run('CancelOnlineOrder', { onlineOrderId: b.id, reason: 'Kitchen fire' });
    expect(h.db.prepare('SELECT state FROM bill WHERE id = ?').pluck().get(row(b.id).bill_id)).toBe('void');
    expect(JSON.parse(outbox(b.id).at(-1)!.body_json)).toEqual({ to: 'CANCELLED', reasonText: 'Kitchen fire' });
  });

  it('the customer cancelled after billing: flagged; Cancel order voids the bill without telling the hub again', () => {
    const o = receive(hubOrder());
    h.run('AcceptOnlineOrder', { onlineOrderId: o.id });
    h.run('ApplyHubEvent', { event: { seq: ++seq, type: 'order.cancelled', at: 0, orderId: o.id, by: 'customer', reasonText: 'Changed my mind' } });
    expect(row(o.id)).toMatchObject({ state: 'CANCELLED', alert: 'The customer cancelled. Its bill was already printed: void it (Cancel order).' });
    const before = outbox(o.id).length;
    h.run('CancelOnlineOrder', { onlineOrderId: o.id, reason: 'Customer cancelled' });
    expect(outbox(o.id)).toHaveLength(before);
  });

  it('the hub refused the accept (the customer cancelled first): cancelled here, with a note to void the bill', () => {
    const o = receive(hubOrder());
    h.run('AcceptOnlineOrder', { onlineOrderId: o.id });
    const id = h.db.prepare("SELECT id FROM online_outbox WHERE action = 'accept'").pluck().get() as number;
    h.run('RecordHubAction', { outboxId: id, outcome: 'refused', message: 'The order is already cancelled.', state: 'CANCELLED' });
    expect(row(o.id).state).toBe('CANCELLED');
    expect(row(o.id).alert).toMatch(/refused the accept .* Void its bill/);
  });

  it('automatic accepting: the server itself (system) may accept; staff need online.orders; internal commands are not for clients', async () => {
    const o = receive(hubOrder());
    h.fail('AcceptOnlineOrder', { onlineOrderId: o.id }, 'FORBIDDEN', { rights: denyAll });
    h.run('AcceptOnlineOrder', { onlineOrderId: o.id }, { rights: roleRights, actor: { deviceId: null, userId: null, deviceKind: 'system' } });
    expect(row(o.id).state).toBe('ACCEPTED');
    const app = buildApp({ db: h.db, timeZone: 'Asia/Kolkata', now: TEST_NOW });
    const res = await app.inject({ method: 'POST', url: '/v1/commands', payload: { commandId: newId(), type: 'ApplyHubEvent', payload: { event: {} }, createdAt: TEST_NOW().toISOString() } });
    expect(res.json<{ error: { code: string; message: string } }>().error).toMatchObject({ code: 'VALIDATION', message: 'Unknown command type "ApplyHubEvent".' });
    await app.close();
  });

  it('free delivery above the band’s amount: no delivery charge on a large order', () => {
    const o = receive(hubOrder({ fulfilment: 'DELIVERY', payment: 'COD', paid: false, distanceKm: 2.4 }));
    h.run('AcceptOnlineOrder', { onlineOrderId: o.id });
    expect(h.count('order_item', "item_id = 'fee:delivery'")).toBe(0);
  });

  it('the published menu: one dish per size, add-on groups as options, GST on fees, round-off and the outlet’s settings', () => {
    const { body, hash } = publishedMenu(h.db, getConfig(h.db)['online.settings'], getConfig(h.db));
    const bc = body.items.filter((i) => i.id.startsWith(BC));
    expect(bc.map((i) => [i.name, i.price])).toEqual([
      ['Butter Chicken (Half)', 30_000],
      ['Butter Chicken (Full)', 52_000],
    ]);
    expect(body.items.find((i) => i.id === S.dalMakhani)).toMatchObject({ rateBp: 500, priceIncludesTax: false, channels: ['app', 'website'] });
    expect(body.modifierGroups.find((g) => g.name === 'Spice level')).toMatchObject({ minSelect: 1, maxSelect: 1 });
    expect(body).toMatchObject({ roundToRupee: true, feeTax: { rateBp: 1800, cessBp: 0, priceIncludesTax: false }, options: { fulfilment: { pickup: true, delivery: true }, channels: { swiggy: false, zomato: false } } });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  // ---------------------------------------------------------------- P6-06: Swiggy / Zomato orders
  const zomato = (over: Partial<HubOrder> = {}, ext: Partial<NonNullable<HubOrder['external']>> = {}) =>
    hubOrder({
      number: 'Z-1004', channel: 'zomato', fulfilment: 'DELIVERY', payment: 'ONLINE', paid: true, distanceKm: null, location: { lat: 21.785, lng: 87.75 },
      address: { line1: 'Flat 4', line2: null, landmark: null, city: 'Contai', pincode: '721401' }, packagingFee: 1_500,
      external: { platform: 'zomato', orderId: 'ZO-10020', deliveredBy: 'platform', otp: null, platformTotal: 21_500, charges: [{ title: 'Packaging Charge', amount: 1_500 }], discounts: [], notes: [], ...ext },
      ...over,
    });
  const payments = (billId: string | null) => h.db.prepare('SELECT mode, amount_paise AS amount, ref FROM payment WHERE bill_id = ?').all(billId);

  it('Swiggy / Zomato: a delivery order has no distance and is accepted anyway, with the platform’s own charges', () => {
    const o = receive(zomato());
    h.run('AcceptOnlineOrder', { onlineOrderId: o.id });
    const r = row(o.id);
    expect(r).toMatchObject({ state: 'ACCEPTED', alert: null, pos_total_paise: o.total });
    expect(h.db.prepare("SELECT item_id, unit_price_paise, tax_rate_bp FROM order_item WHERE item_id LIKE 'fee:%'").all()).toEqual([{ item_id: 'fee:packaging', unit_price_paise: 1_500, tax_rate_bp: 1800 }]);
    // a website delivery order without a distance is still refused: the outlet's bands decide there
    const w = receive(hubOrder({ id: 'ord_w', fulfilment: 'DELIVERY', payment: 'COD', paid: false, distanceKm: null, total: 1 }));
    expect(h.fail('AcceptOnlineOrder', { onlineOrderId: w.id }, 'INVALID_STATE').message).toMatch(/outside the delivery area/);
  });

  it('Swiggy / Zomato: the platform pays later, so the bill is settled as Other with the platform’s order number', () => {
    const o = receive(zomato());
    h.run('AcceptOnlineOrder', { onlineOrderId: o.id });
    const r = row(o.id);
    expect(payments(r.bill_id)).toEqual([{ mode: 'other', amount: o.total, ref: 'Zomato ZO-10020' }]);
    expect(h.db.prepare('SELECT state FROM bill WHERE id = ?').pluck().get(r.bill_id)).toBe('settled');
    // cash the platform's rider collects is the platform's: settled as Other too, and nothing more is taken at the door
    const cash = receive(zomato({ id: 'ord_cash', payment: 'COD', paid: false }, { orderId: 'ZO-10021' }));
    h.run('AcceptOnlineOrder', { onlineOrderId: cash.id });
    expect(payments(row(cash.id).bill_id)).toEqual([{ mode: 'other', amount: cash.total, ref: 'Zomato ZO-10021' }]);
    h.run('AdvanceOnlineOrder', { onlineOrderId: cash.id, to: 'READY' });
    h.run('AdvanceOnlineOrder', { onlineOrderId: cash.id, to: 'OUT_FOR_DELIVERY', rider: { name: 'Zomato rider' } });
    expect(h.fail('AdvanceOnlineOrder', { onlineOrderId: cash.id, to: 'DELIVERED', tenders: [{ mode: 'cash', amountPaise: cash.total, ref: null }] }, 'VALIDATION').message).toMatch(/payment is taken only/);
    h.run('AdvanceOnlineOrder', { onlineOrderId: cash.id, to: 'DELIVERED' });
    expect(payments(row(cash.id).bill_id)).toHaveLength(1);
  });

  it('Swiggy / Zomato: cash the outlet’s own rider collects is settled in cash when delivered, like any cash order', () => {
    const o = receive(zomato({ channel: 'swiggy', number: 'S-1001', payment: 'COD', paid: false }, { platform: 'swiggy', orderId: 'SW-77', deliveredBy: 'store' }));
    h.run('AcceptOnlineOrder', { onlineOrderId: o.id });
    const r = row(o.id);
    expect(payments(r.bill_id)).toEqual([]);
    h.run('AdvanceOnlineOrder', { onlineOrderId: o.id, to: 'READY' });
    h.run('AdvanceOnlineOrder', { onlineOrderId: o.id, to: 'OUT_FOR_DELIVERY', rider: { name: 'Raju' } });
    h.run('AdvanceOnlineOrder', { onlineOrderId: o.id, to: 'DELIVERED' });
    expect(payments(r.bill_id)).toEqual([{ mode: 'cash', amount: o.total, ref: null }]);
  });

  it('Swiggy / Zomato switched on: every dish is listed for them, with DinePOS’s own item ids; settings saved before still load', () => {
    h.run('SetConfig', { values: { 'online.settings': { ...settings, channels: { app: true, website: true, swiggy: true, zomato: true } } } });
    const { body } = publishedMenu(h.db, getConfig(h.db)['online.settings'], getConfig(h.db));
    expect(body.items.find((i) => i.id === S.dalMakhani)!.channels).toEqual(['app', 'website', 'swiggy', 'zomato']);
    expect(body.items.some((i) => i.id === onlineItemId(BC, BC_FULL))).toBe(true);
    expect(body.options.channels).toEqual({ app: true, website: true, swiggy: true, zomato: true });
    // saved by a DinePOS without Swiggy / Zomato: read with both off, nothing else lost
    const old = { ...settings, channels: { app: false, website: true } };
    h.db.prepare("UPDATE config SET value = ? WHERE key = 'online.settings'").run(JSON.stringify(old));
    expect(getConfig(h.db)['online.settings']).toMatchObject({ enabled: true, feeTaxBp: 1800, channels: { app: false, website: true, swiggy: false, zomato: false } });
  });

  it('payment table rebuilt for "online": rows kept, still append-only', () => {
    const o = receive(hubOrder());
    h.run('AcceptOnlineOrder', { onlineOrderId: o.id });
    expect(() => h.db.prepare("UPDATE payment SET amount_paise = 1 WHERE mode = 'online'").run()).toThrow(/append-only/);
    expect(() => h.db.prepare('DELETE FROM payment').run()).toThrow(/append-only/);
    expect(() => h.db.prepare("INSERT INTO payment (id, bill_id, mode, amount_paise, received_at) VALUES ('x', ?, 'cheque', 1, 'now')").run(row(o.id).bill_id)).toThrow(/CHECK/);
  });
});
