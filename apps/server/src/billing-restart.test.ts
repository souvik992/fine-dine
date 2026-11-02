import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newId } from '@dinepos/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServerConfig } from './config.js';
import { devSeedCommands, seedId } from './seed/dev-seed.js';
import { startServer, type RunningServer } from './server.js';

// P1-10 acceptance: bill numbers are gap-free across a server restart (real file database).
describe('bill numbering across restart', () => {
  let dir: string;
  let srv: RunningServer | undefined;
  afterEach(async () => {
    await srv?.close();
    srv = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  const config = (): ServerConfig => ({
    env: 'test',
    host: '127.0.0.1',
    port: 0,
    dataDir: dir,
    dbFile: 'test.db',
    timeZone: 'Asia/Kolkata',
    logLevel: 'silent',
    allowedOrigins: [],
    logToFile: false,
  });
  const now = () => new Date('2026-11-02T08:00:00Z');

  async function cmd(type: string, payload: unknown, order?: { orderId: string; expectedVersion: number }) {
    const res = await srv!.app.inject({
      method: 'POST',
      url: '/v1/commands',
      payload: { commandId: newId(), type, payload, createdAt: '2026-11-02T13:30:00+05:30', ...order },
    });
    const body = res.json<{ ok: boolean; version?: number; order?: { id: string }; result: Record<string, unknown> }>();
    if (!body.ok) throw new Error(`${type}: ${res.body}`);
    return body;
  }

  async function billTable(label: number): Promise<string> {
    const opened = await cmd('OpenTable', { tableId: seedId(`table:main:${label}`), covers: 2 });
    const orderId = opened.order!.id;
    const added = await cmd('AddItems', { items: [{ id: newId(), itemId: seedId('item:DM'), qty: 1 }] }, { orderId, expectedVersion: 1 });
    const fired = await cmd('FireKOT', { all: true }, { orderId, expectedVersion: added.version! });
    const printed = await cmd('PrintBill', {}, { orderId, expectedVersion: fired.version! });
    return printed.result.billNo as string;
  }

  it('continues 000001, 000002 → restart → 000003', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'dinepos-billno-'));
    srv = await startServer(config(), { now, logger: false });
    for (const c of devSeedCommands()) await cmd(c.type, c.payload);
    expect(await billTable(1)).toBe('B/26-27/000001');
    expect(await billTable(2)).toBe('B/26-27/000002');
    await srv.close();

    srv = await startServer(config(), { now, logger: false });
    expect(await billTable(3)).toBe('B/26-27/000003');
    const numbers = srv.db.prepare('SELECT bill_no FROM bill ORDER BY bill_no').pluck().all();
    expect(numbers).toEqual([1, 2, 3]);
  });
});
