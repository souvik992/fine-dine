import { generateKeyPairSync, sign } from 'node:crypto';
import { newId } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { currentBusinessDate } from '../core/business-day.js';
import { EventBus } from '../core/events.js';
import { createLicenceGate, unenforcedGate } from '../licence/gate.js';
import type { LicencePayload } from '../licence/licence.js';
import { denyAll, TEST_NOW, useHarness } from '../testing/command-harness.js';
import { line, orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';
import { SyncAgent } from './sync-agent.js';
import { syncStream } from './sync-support.js';

// P4-05: the outbox sent up to the hub in order, acked, resent after a gap; licence renewals fetched down.
const DAY = 86_400_000;
const HW = 'AB12-CD34-EF56-7890-1A2B';
const vendor = generateKeyPairSync('ed25519');
function issue(days: number, over: Partial<LicencePayload> = {}): string {
  const payload: LicencePayload = {
    v: 1,
    licensee: 'Spice Garden, Kolkata',
    hardwareId: HW,
    issuedAt: TEST_NOW().toISOString(),
    expiresAt: new Date(TEST_NOW().getTime() + days * DAY).toISOString(),
    seats: { terminals: 2, captains: 1, kds: 1 },
    features: [],
    ...over,
  };
  const body = Buffer.from(JSON.stringify(payload));
  return `${body.toString('base64url')}.${sign(null, body, vendor.privateKey).toString('base64url')}`;
}
const gate = () => createLicenceGate({ publicKey: vendor.publicKey, hardwareId: HW });

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The hub's sync endpoints (pos-backend hub/src/sync.ts) in memory: per stream, seq → record. */
function fakeHub() {
  const streams = new Map<string, Map<number, string>>();
  const t = {
    mode: 'ok' as 'ok' | 'down' | 'unpaired' | 'error',
    licence: null as string | null,
    batches: [] as Array<{ streamId: string; fromSeq: number; events: Array<{ seq: number; kind: string; payload: Record<string, unknown> }> }>,
    streams,
    fetch: ((input: string | URL | Request, init?: RequestInit) => Promise.resolve().then(() => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (t.mode === 'down') throw new TypeError('fetch failed');
      if (t.mode === 'unpaired') return json(401, { error: { code: 'UNAUTHENTICATED', message: 'Pair again.' } });
      if (t.mode === 'error') return json(503, { error: { code: 'INTERNAL', message: 'busy' } });
      if (url.pathname === '/v1/pos/licence') return json(200, { key: t.licence, updatedAt: t.licence ? 1 : null });
      const b = JSON.parse(init?.body as string) as (typeof t.batches)[number];
      t.batches.push(b);
      const s = streams.get(b.streamId) ?? new Map<number, string>();
      streams.set(b.streamId, s);
      const ack = s.size ? Math.max(...s.keys()) : b.fromSeq - 1;
      if (b.fromSeq > ack + 1) return json(409, { error: { code: 'SYNC_GAP', message: 'gap', details: { ackSeq: ack } } });
      for (const e of b.events) {
        const text = JSON.stringify([e.kind, e.payload]);
        if (s.has(e.seq) && s.get(e.seq) !== text) return json(409, { error: { code: 'SYNC_CONFLICT', message: 'The hub already holds a different record.', details: { seq: e.seq } } });
      }
      for (const e of b.events) s.set(e.seq, JSON.stringify([e.kind, e.payload]));
      return json(200, { ackSeq: Math.max(ack, b.events.at(-1)!.seq), stored: b.events.length });
    })) as typeof fetch,
  };
  return t;
}

describe('cloud sync (P4-05)', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  let hub: ReturnType<typeof fakeHub>;
  let agent: SyncAgent;
  beforeEach(() => {
    seedOutlet(h);
    hub = fakeHub();
    agent = new SyncAgent({ db: h.db, now: TEST_NOW, execute: (type, payload, actor) => h.run(type, payload, actor ? { actor } : {}), bus: new EventBus(), fetch: hub.fetch, batchSize: 2 });
  });
  const pair = () => h.db.prepare("UPDATE online_link SET hub_url = 'https://hub.test', device_key = 'device-key', store_slug = 'spice-garden', store_name = 'Spice Garden' WHERE id = 1").run();
  const addRows = (n: number) => {
    for (let i = 0; i < n; i++) h.db.prepare("INSERT INTO outbox (kind, payload_json, created_at) VALUES ('bill.printed', ?, '2026-11-02T08:00:00.000Z')").run(JSON.stringify({ billId: newId(), totalPaise: 100 * (i + 1) }));
  };
  const unsent = () => h.count('outbox', 'sent_at IS NULL');

  it('a new database has its own stream; bills, settlements and voids go in the outbox with their business date', () => {
    expect(syncStream(h.db).streamId).toMatch(/^[0-9a-f]{32}$/);
    const id = o.open(S.t1).order!.id;
    o.run('AddItems', id, { items: [line(S.dalMakhani)] });
    o.run('FireKOT', id, { all: true });
    const { billId, totalPaise } = o.run('PrintBill', id, {}).result as { billId: string; totalPaise: number };
    o.run('Settle', id, { billId, tenders: [{ mode: 'cash', amountPaise: totalPaise }] });
    const rows = h.db.prepare('SELECT kind, payload_json FROM outbox ORDER BY seq').all() as Array<{ kind: string; payload_json: string }>;
    expect(rows.map((r) => r.kind)).toEqual(['bill.printed', 'bill.settled']);
    for (const r of rows) expect(JSON.parse(r.payload_json)).toMatchObject({ billId, businessDate: currentBusinessDate(h.db) });
  });

  it('sends the outbox in order, in batches, and marks what the hub acks as sent', async () => {
    pair();
    addRows(5);
    await agent.send();
    expect(hub.batches.map((b) => [b.fromSeq, b.events.length])).toEqual([[1, 2], [3, 2], [5, 1]]);
    expect(hub.batches.every((b) => b.streamId === syncStream(h.db).streamId)).toBe(true);
    expect(unsent()).toBe(0);
    const s = agent.status();
    expect([s.state, s.pending, s.paired, s.store?.slug, s.lastSyncAt]).toEqual(['idle', 0, true, 'spice-garden', TEST_NOW().toISOString()]);
    await agent.send(); // nothing new: nothing sent
    expect(hub.batches).toHaveLength(3);
  });

  it('not paired: sends nothing; the hub unreachable: keeps everything and sends it later', async () => {
    addRows(2);
    await agent.send();
    expect(hub.batches).toHaveLength(0);
    expect(agent.status().state).toBe('not-paired');
    pair();
    hub.mode = 'down';
    await agent.send();
    expect([agent.status().state, agent.status().pending]).toEqual(['offline', 2]);
    expect(agent.status().lastError).toMatch(/could not be reached/);
    hub.mode = 'error';
    await agent.send();
    expect(agent.status().state).toBe('offline');
    hub.mode = 'ok';
    await agent.send();
    expect([agent.status().state, unsent(), agent.status().lastError]).toEqual(['idle', 0, null]);
  });

  it('the hub lost records (restored from a backup): it says so and the outlet sends them again', async () => {
    pair();
    addRows(4);
    await agent.send();
    const stream = hub.streams.get(syncStream(h.db).streamId)!;
    stream.delete(4);
    stream.delete(3);
    addRows(1);
    await agent.send();
    expect([...stream.keys()].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(unsent()).toBe(0);
    expect(h.count('audit_event', "action = 'sync.rewind'")).toBe(1);
  });

  it('the hub holds different records (this database was restored): stuck until the admin starts a new stream', async () => {
    pair();
    addRows(2);
    hub.streams.set(syncStream(h.db).streamId, new Map([[1, '"something else"']]));
    await agent.send();
    expect([agent.status().state, agent.status().conflict, unsent()]).toEqual(['stuck', true, 2]);
    await agent.send();
    expect(hub.batches).toHaveLength(1); // not retried while stuck
    const old = syncStream(h.db).streamId;
    h.run('ResetSyncStream', {});
    expect(syncStream(h.db).streamId).not.toBe(old);
    agent = new SyncAgent({ db: h.db, now: TEST_NOW, execute: (type, payload) => h.run(type, payload), bus: new EventBus(), fetch: hub.fetch });
    await agent.send();
    expect([agent.status().state, unsent()]).toEqual(['idle', 0]);
    expect(hub.streams.get(syncStream(h.db).streamId)!.size).toBe(2);
  });

  it('the hub no longer knows this outlet: stuck, saying to pair again', async () => {
    pair();
    addRows(1);
    hub.mode = 'unpaired';
    await agent.send();
    expect(agent.status().state).toBe('stuck');
    expect(agent.status().lastError).toMatch(/Connect it again/);
  });

  it('RecordSyncAck: marks up to the ack; rewind marks later rows unsent; an old stream changes nothing; not for clients', async () => {
    addRows(4);
    const streamId = syncStream(h.db).streamId;
    expect(h.run('RecordSyncAck', { streamId, ackSeq: 3 }).result).toEqual({ marked: 3, unmarked: 0, status: 'ok' });
    expect(h.run('RecordSyncAck', { streamId, ackSeq: 1, rewind: true }).result).toEqual({ marked: 0, unmarked: 2, status: 'ok' });
    expect(unsent()).toBe(3);
    expect(h.run('RecordSyncAck', { streamId: 'f'.repeat(32), ackSeq: 4 }).result).toEqual({ marked: 0, unmarked: 0, status: 'old stream' });
    const commandId = newId();
    const first = h.run('RecordSyncAck', { streamId, ackSeq: 4 }, { commandId });
    expect(h.run('RecordSyncAck', { streamId, ackSeq: 4 }, { commandId })).toEqual({ ...first, duplicate: true });
    const app = buildApp({ db: h.db, timeZone: 'Asia/Kolkata', now: TEST_NOW });
    const res = await app.inject({ method: 'POST', url: '/v1/commands', payload: { commandId: newId(), type: 'RecordSyncAck', payload: { streamId, ackSeq: 9 }, createdAt: TEST_NOW().toISOString() } });
    expect(res.json<{ error: { message: string } }>().error.message).toBe('Unknown command type "RecordSyncAck".');
    await app.close();
  });

  it('ResetSyncStream: needs the admin right, a hub link, and replays without a second reset', () => {
    h.fail('ResetSyncStream', {}, 'INVALID_STATE');
    pair();
    expect(h.fail('ResetSyncStream', {}, 'FORBIDDEN', { rights: denyAll }).details).toEqual({ right: 'admin' });
    const commandId = newId();
    const first = h.run('ResetSyncStream', {}, { commandId });
    expect(h.run('ResetSyncStream', {}, { commandId })).toEqual({ ...first, duplicate: true });
    expect(h.count('audit_event', "action = 'sync.reset'")).toBe(1);
  });

  it('licence renewals: a later key on the hub is installed by itself; the same, a shorter or another PC’s key is not', async () => {
    h.useLicence(gate());
    pair();
    h.run('InstallLicence', { key: issue(30) });
    await agent.checkLicence();
    expect(agent.status().licence.result).toBe('No renewed key on the hub.');
    hub.licence = issue(10);
    await agent.checkLicence();
    expect(agent.status().licence.result).toMatch(/not installed: .*not later than the key installed here/);
    hub.licence = issue(400, { hardwareId: '0000-0000-0000-0000-0000' });
    await agent.checkLicence();
    expect(agent.status().licence.result).toMatch(/not installed: .*another computer/);
    hub.licence = issue(400);
    await agent.checkLicence();
    expect(agent.status().licence.result).toMatch(/^Renewed from the hub: now ends \d{4}-\d{2}-\d{2}\.$/);
    expect(h.count('audit_event', "action = 'licence.renew'")).toBe(1);
    await agent.checkLicence();
    expect(agent.status().licence.result).toBe('The installed key is the one on the hub.');
    expect(agent.status().licence.checkedAt).toBe(TEST_NOW().toISOString());
  });

  it('RenewLicence: opens a business day when none could open; not in development runs', () => {
    h.useLicence(gate());
    h.db.prepare("UPDATE business_day SET closed_at = '2026-11-02T00:00:00Z'").run();
    expect(currentBusinessDate(h.db)).toBeNull();
    const res = h.run('RenewLicence', { key: issue(365) }).result as { status: string; openedBusinessDate: string | null };
    expect(res.status).toBe('renewed');
    expect(res.openedBusinessDate).not.toBeNull();
    h.useLicence(unenforcedGate());
    h.fail('RenewLicence', { key: issue(400) }, 'INVALID_STATE');
  });
});
