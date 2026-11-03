import type { CommandSuccess, OrderSnapshot } from '@dinepos/shared';
import { describe, expect, it } from 'vitest';
import { ApiError, type CommandOptions } from '../api/client.js';
import { OrderSession } from './order-session.js';

const snap = (version: number): OrderSnapshot => ({
  id: 'o1',
  version,
  state: 'open',
  type: 'dine_in',
  businessDate: '2026-11-02',
  covers: 2,
  openedAt: 'x',
  items: [],
  kots: [],
  bills: [],
  totals: { subtotalPaise: 0, taxPaise: 0, totalPaise: 0 },
});

/** A fake server holding the order version; `bumpElsewhere` simulates another terminal. */
class FakeApi {
  version = 1;
  lastChange: { by: string; what: string } | null = null;
  calls: Array<{ type: string; expectedVersion?: number; commandId?: string }> = [];
  get<T>(): Promise<T> {
    return Promise.resolve(snap(this.version) as T);
  }
  async command<R>(type: string, _payload: unknown, opts: CommandOptions = {}): Promise<CommandSuccess<R>> {
    this.calls.push({ type, expectedVersion: opts.expectedVersion, commandId: opts.commandId });
    await new Promise((r) => setTimeout(r, 1));
    if (opts.expectedVersion !== this.version) throw new ApiError('VERSION_CONFLICT', 'changed', { currentVersion: this.version, lastChange: this.lastChange }, snap(this.version));
    this.version++;
    return { ok: true, commandId: opts.commandId!, order: snap(this.version), version: this.version, result: null as R };
  }
}

describe('OrderSession', () => {
  it('runs commands one after another, each on the version the previous produced', async () => {
    const api = new FakeApi();
    const s = new OrderSession(api, 'o1');
    await Promise.all([s.run('AddItems', {}), s.run('AddItems', {}), s.run('FireKOT', { all: true })]);
    expect(api.calls.map((c) => c.expectedVersion)).toEqual([1, 2, 3]);
    expect(s.current?.version).toBe(4);
  });

  it('rebases a safe command once, with the same commandId, and flags the outside change', async () => {
    const api = new FakeApi();
    const s = new OrderSession(api, 'o1');
    const seen: boolean[] = [];
    s.subscribe((_snap, info) => seen.push(info.external));
    await s.refresh();
    api.version = 5; // another terminal moved the order on
    await s.run('AddItems', {});
    expect(api.calls.map((c) => c.expectedVersion)).toEqual([1, 5]);
    expect(new Set(api.calls.map((c) => c.commandId)).size).toBe(1);
    expect(seen).toEqual([false, true, false]); // own load, outside change, our result
  });

  it('does not rebase an unsafe command; the conflict reaches the screen with the newer snapshot', async () => {
    const api = new FakeApi();
    const s = new OrderSession(api, 'o1');
    await s.refresh();
    api.version = 3;
    await expect(s.run('PrintBill', {})).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(api.calls).toHaveLength(1);
    expect(s.current?.version).toBe(3);
  });

  it('a failed command does not block the queue', async () => {
    const api = new FakeApi();
    const s = new OrderSession(api, 'o1');
    await s.refresh();
    api.version = 9;
    const failed = s.run('PrintBill', {});
    const next = s.run('AddItems', {});
    await expect(failed).rejects.toBeInstanceOf(ApiError);
    await expect(next).resolves.toMatchObject({ ok: true });
  });

  it('ignores stale snapshots from slow refetches', () => {
    const s = new OrderSession(new FakeApi(), 'o1');
    s.receive(snap(4));
    s.receive(snap(2));
    expect(s.current?.version).toBe(4);
  });
});

describe('conflict banner (P2-07)', () => {
  it('a refused PrintBill reports who changed the table; a rebased AddItems reports nothing', async () => {
    const api = new FakeApi();
    const s = new OrderSession(api, 'o1');
    const seen: Array<{ type: string; by: string | null }> = [];
    s.onConflict((c) => seen.push({ type: c.type, by: c.by }));
    await s.refresh();
    api.version = 5;
    await s.run('AddItems', {}); // silent rebase
    expect(seen).toEqual([]);
    api.version = 9;
    api.lastChange = { by: 'Ravi', what: 'moved the table' };
    await expect(s.run('PrintBill', {})).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(seen).toEqual([{ type: 'PrintBill', by: 'Ravi' }]);
  });
});

describe('decisions in a dialog (P2-07)', () => {
  it('a print decided on what was shown is refused if the order changed meanwhile, even after the screen updated; trying again works', async () => {
    const api = new FakeApi();
    const s = new OrderSession(api, 'o1');
    const seen: string[] = [];
    s.onConflict((c) => seen.push(c.type));
    await s.refresh(); // version 1 on screen
    s.holdDecision(1); // the Print bill dialog opens
    api.version = 2;
    await s.refresh(); // the move arrives over the stream and the screen updates…
    await expect(s.run('PrintBill', {})).rejects.toMatchObject({ code: 'VERSION_CONFLICT' }); // …but the print is refused
    expect(seen).toEqual(['PrintBill']);
    expect((await s.run('PrintBill', {})).ok).toBe(true); // the person has been told; now it goes through
    await s.run('AddItems', {}); // adding is never held back
    s.holdDecision(null);
  });
});
