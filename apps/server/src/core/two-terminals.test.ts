import { newId, type CommandSuccess } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { getOrderSnapshot } from '../queries/order-snapshot.js';
import { seedId } from '../seed/dev-seed.js';
import { useHarness } from '../testing/command-harness.js';
import { line, orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';
import { PosError } from './errors.js';

// P2-07 acceptance: two terminals editing T7 never lose an item; a Move vs PrintBill race shows who changed the table.
describe('two terminals on one table', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  const t7 = seedId('table:main:7');
  const captain = { deviceId: null, userId: seedId('user:captain') };
  const cashier = { deviceId: null, userId: seedId('user:cashier') };
  let orderId: string;
  beforeEach(() => {
    seedOutlet(h);
    orderId = o.open(t7, 4).order!.id;
  });

  /**
   * A terminal as the desktop's order session works: it sends on the version it last saw and, on a conflict, rebases
   * once on the newer snapshot with the SAME commandId (docs/05: AddItems is safe to rebase).
   */
  function terminal(actor: { deviceId: null; userId: string }) {
    let seen = 1;
    return (type: string, payload: unknown): CommandSuccess => {
      const commandId = newId();
      const send = (v: number) => h.run(type, payload, { orderId, expectedVersion: v, commandId, actor });
      try {
        const r = send(seen);
        seen = r.order!.version;
        return r;
      } catch (e) {
        if (!(e instanceof PosError) || e.code !== 'VERSION_CONFLICT') throw e;
        const r = send(e.order!.version);
        seen = r.order!.version;
        return r;
      }
    };
  }

  it('20 rounds each from two terminals that only see their own changes: every item arrives once (acceptance)', () => {
    const a = terminal(captain);
    const b = terminal(cashier);
    const sent: string[] = [];
    for (let i = 0; i < 20; i++) {
      for (const t of [a, b]) {
        const l = line(S.dalMakhani);
        sent.push(l.id);
        t('AddItems', { items: [l] });
      }
    }
    const items = getOrderSnapshot(h.db, orderId)!.items.map((i) => i.id);
    expect(items.sort()).toEqual([...sent].sort());
    expect(getOrderSnapshot(h.db, orderId)!.version).toBe(1 + 40);
  });

  it('Move vs PrintBill: the print is refused with who moved the table and to where it went; nothing is printed (acceptance)', () => {
    o.run('AddItems', orderId, { items: [line(S.dalMakhani)] });
    o.run('FireKOT', orderId, { all: true });
    const cashierSaw = getOrderSnapshot(h.db, orderId)!.version;
    h.run('MoveTable', { toTableId: seedId('table:main:8') }, { orderId, expectedVersion: cashierSaw, actor: captain }); // the captain is quicker
    let err: PosError | undefined;
    try {
      h.run('PrintBill', {}, { orderId, expectedVersion: cashierSaw, actor: cashier });
    } catch (e) {
      err = e as PosError;
    }
    expect(err?.code).toBe('VERSION_CONFLICT');
    expect(err?.message).toBe('Table T8 was changed by Ravi (Captain) (moved the table) at 13:30. Check the order and try again.');
    expect(err?.details).toMatchObject({ lastChange: { by: 'Ravi (Captain)', what: 'moved the table' } });
    expect(err?.order).toMatchObject({ table: { label: 'T8' }, state: 'open' });
    expect(h.count('bill')).toBe(0);
  });
});
