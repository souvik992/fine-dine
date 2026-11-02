import { newId } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { denyAll, useHarness } from '../testing/command-harness.js';
import { line, orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';

describe('FireKOT', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  let orderId: string;
  beforeEach(() => {
    seedOutlet(h);
    orderId = o.open(S.t1, 4).order!.id;
  });

  const kotResult = (res: { result: unknown }) => (res.result as { kots: Array<{ id: string; kotNo: number; stationId: string; orderItemIds: string[] }> }).kots;

  // P1-06 acceptance
  it('firing items for 2 stations creates 2 KOTs with consecutive numbers', () => {
    o.run('AddItems', orderId, { items: [line(S.butterNaan, { qty: 2 }), line(S.dalMakhani), line(S.paneerTikka, { addons: [{ addonId: S.mild }], note: 'less oil' })] });
    const kots = kotResult(o.run('FireKOT', orderId, { all: true }));
    expect(kots.map((k) => k.kotNo)).toEqual([1, 2]);
    expect(kots.map((k) => k.stationId)).toEqual([S.kitchen, S.tandoor]); // by station name: Kitchen, Tandoor
    expect(kots[1]!.orderItemIds).toHaveLength(2);
    expect(h.db.prepare('SELECT kot_no FROM kot ORDER BY kot_no').pluck().all()).toEqual([1, 2]);
  });

  it('table state goes FREE → SEATED → KOT_RUNNING', () => {
    expect(o.tableState(S.t2)).toBe('FREE');
    const id = o.open(S.t2).order!.id;
    expect(o.tableState(S.t2)).toBe('SEATED');
    o.run('AddItems', id, { items: [line(S.dalMakhani)] });
    expect(o.tableState(S.t2)).toBe('SEATED');
    o.run('FireKOT', id, { all: true });
    expect(o.tableState(S.t2)).toBe('KOT_RUNNING');
    const states = h.db.prepare("SELECT payload_json FROM event_log WHERE event = 'table.state' ORDER BY seq").pluck().all() as string[];
    expect(states.map((s) => (JSON.parse(s) as { tableId: string; state: string })).filter((s) => s.tableId === S.t2).map((s) => s.state)).toEqual(['SEATED', 'SEATED', 'KOT_RUNNING']);
  });

  it('cannot fire on a settled order (INVALID_STATE)', () => {
    o.run('AddItems', orderId, { items: [line(S.dalMakhani)] });
    h.db.prepare(`UPDATE "order" SET state = 'settled' WHERE id = ?`).run(orderId);
    h.fail('FireKOT', { all: true }, 'INVALID_STATE', { orderId, expectedVersion: 2 });
  });

  it('marks items fired with their KOT and station, and copies snapshots unchanged', () => {
    o.run('AddItems', orderId, { items: [line(S.dalMakhani)] });
    const snap = o.snapshot(o.run('FireKOT', orderId, { all: true }));
    expect(snap.items[0]).toMatchObject({ status: 'fired', kotNo: 1, stationId: S.kitchen, name: 'Dal Makhani', unitPricePaise: 28_000 });
    expect(snap.kots).toEqual([expect.objectContaining({ kotNo: 1, stationId: S.kitchen, kind: 'new' })]);
    expect(snap.lastKotAt).toBe('2026-11-02T08:00:00.000Z');
  });

  it('queues one print job per station printer with the ticket preview', () => {
    o.run('AddItems', orderId, { items: [line(S.paneerTikka, { addons: [{ addonId: S.mild }], note: 'less oil', qty: 2 })] });
    o.run('FireKOT', orderId, { all: true });
    const job = h.db.prepare('SELECT printer_id, doc_kind, state, preview_text FROM print_job').get() as Record<string, string>;
    expect(job).toMatchObject({ printer_id: S.tandoorPrinter, doc_kind: 'kot', state: 'queued' });
    expect(job.preview_text).toContain('KOT 0001');
    expect(job.preview_text).toContain('Table T1 (Main Hall)');
    expect(job.preview_text).toContain('Covers 4');
    expect(job.preview_text).toContain('13:30  02-11-26');
    expect(job.preview_text).toContain('2  Paneer Tikka');
    expect(job.preview_text).toContain('+ Mild');
    expect(job.preview_text).toContain('! less oil');
    expect(job.preview_text).not.toMatch(/\d{3,}\.\d\d|Rs/); // no prices on a KOT
  });

  it('emits kot.created to the station and kds topics', () => {
    o.run('AddItems', orderId, { items: [line(S.dalMakhani)] });
    o.run('FireKOT', orderId, { all: true });
    expect(h.db.prepare("SELECT topic FROM event_log WHERE event = 'kot.created' ORDER BY topic").pluck().all()).toEqual(['kds', `station:${S.kitchen}`]);
  });

  it('fires by item ids or by course, leaving the rest held', () => {
    const naan = line(S.butterNaan);
    const dessert = line(S.dalMakhani, { course: 2 });
    o.run('AddItems', orderId, { items: [naan, dessert] });
    o.run('FireKOT', orderId, { itemIds: [naan.id] });
    expect(h.db.prepare("SELECT id FROM order_item WHERE status = 'held'").pluck().all()).toEqual([dessert.id]);
    o.run('FireKOT', orderId, { course: 2 });
    expect(h.count('order_item', "status = 'held'")).toBe(0);
  });

  it('KOT numbers continue across orders on the same business date', () => {
    o.run('AddItems', orderId, { items: [line(S.dalMakhani)] });
    o.run('FireKOT', orderId, { all: true });
    const other = o.open(S.t2).order!.id;
    o.run('AddItems', other, { items: [line(S.virginMojito)] });
    expect(kotResult(o.run('FireKOT', other, { all: true })).map((k) => k.kotNo)).toEqual([2]);
  });

  it('honours an area override (e.g. mocktails to the kitchen in the main hall)', () => {
    h.db.prepare('INSERT INTO area_station_override (area_id, category_id, station_id) VALUES (?, ?, ?)').run(S.mainArea, S.mocktails, S.kitchen);
    o.run('AddItems', orderId, { items: [line(S.virginMojito)] });
    expect(kotResult(o.run('FireKOT', orderId, { all: true }))[0]!.stationId).toBe(S.kitchen);
  });

  it('INVALID_STATE when nothing is held, an id is not held, or no station can be found', () => {
    h.fail('FireKOT', { all: true }, 'INVALID_STATE', { orderId, expectedVersion: 1 });
    h.fail('FireKOT', { itemIds: [newId()] }, 'INVALID_STATE', { orderId, expectedVersion: 1 });
    o.run('AddItems', orderId, { items: [line(S.dalMakhani)] });
    h.db.prepare('UPDATE category SET station_id = NULL').run();
    h.fail('FireKOT', { all: true }, 'INVALID_STATE', { orderId, expectedVersion: 2 });
  });

  it('VERSION_CONFLICT leaves items held and no KOT', () => {
    o.run('AddItems', orderId, { items: [line(S.dalMakhani)] });
    h.fail('FireKOT', { all: true }, 'VERSION_CONFLICT', { orderId, expectedVersion: 1 });
    expect(h.count('kot')).toBe(0);
    expect(h.count('print_job')).toBe(0);
  });

  it('FORBIDDEN without kot.fire', () => {
    o.run('AddItems', orderId, { items: [line(S.dalMakhani)] });
    expect(h.fail('FireKOT', { all: true }, 'FORBIDDEN', { orderId, expectedVersion: 2, rights: denyAll }).details).toEqual({ right: 'kot.fire' });
  });

  it('DUPLICATE replay does not print or number a second KOT', () => {
    o.run('AddItems', orderId, { items: [line(S.dalMakhani)] });
    const commandId = newId();
    const first = o.run('FireKOT', orderId, { all: true }, { commandId, expectedVersion: 2 });
    const again = o.run('FireKOT', orderId, { all: true }, { commandId, expectedVersion: 2 });
    expect(again).toEqual({ ...first, duplicate: true });
    expect(h.count('kot')).toBe(1);
    expect(h.count('print_job')).toBe(1);
  });

  it('VALIDATION for an empty or mixed selector', () => {
    h.fail('FireKOT', {}, 'VALIDATION', { orderId, expectedVersion: 1 });
    h.fail('FireKOT', { all: true, course: 1 }, 'VALIDATION', { orderId, expectedVersion: 1 });
  });
});
