import { newId } from '@dinepos/shared';
import { describe, expect, it } from 'vitest';
import { adminBasics, useHarness } from '../testing/command-harness.js';

describe('UpsertStation', () => {
  const h = useHarness();
  const p1 = newId();
  const p2 = newId();
  const station = { id: newId(), name: 'Tandoor' };
  const setup = () => {
    h.run('UpsertPrinter', { id: p1, name: 'P1', transport: 'fake' });
    h.run('UpsertPrinter', { id: p2, name: 'P2', transport: 'fake' });
  };
  adminBasics(h, 'UpsertStation', 'station', () => ({ ...station }), setup);

  it('replaces printer links as a set', () => {
    setup();
    h.run('UpsertStation', { ...station, printerIds: [p1, p2] });
    h.run('UpsertStation', { ...station, printerIds: [p2] });
    expect(h.db.prepare('SELECT printer_id FROM station_printer WHERE station_id = ?').pluck().all(station.id)).toEqual([p2]);
  });

  it('NOT_FOUND for an unknown printer, leaving existing links untouched', () => {
    setup();
    h.run('UpsertStation', { ...station, printerIds: [p1] });
    h.fail('UpsertStation', { ...station, printerIds: [newId()] }, 'NOT_FOUND');
    expect(h.count('station_printer')).toBe(1);
  });

  it('bumps the menu version', () => {
    h.run('UpsertStation', station);
    expect(h.db.prepare("SELECT value FROM counter WHERE name = 'menu_version'").pluck().get()).toBe(1);
  });
});
