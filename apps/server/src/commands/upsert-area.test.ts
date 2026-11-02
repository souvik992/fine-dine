import { newId } from '@dinepos/shared';
import { describe, expect, it } from 'vitest';
import { adminBasics, useHarness } from '../testing/command-harness.js';

describe('UpsertArea', () => {
  const h = useHarness();
  const area = { id: newId(), name: 'Main Hall' };
  adminBasics(h, 'UpsertArea', 'area', () => ({ ...area }));

  it('announces floor.changed', () => {
    h.run('UpsertArea', area);
    expect(h.count('event_log', "event = 'floor.changed'")).toBe(1);
  });

  it('NOT_FOUND for an unknown price list or tax profile', () => {
    h.fail('UpsertArea', { ...area, priceListId: newId() }, 'NOT_FOUND');
    h.fail('UpsertArea', { ...area, taxProfileId: newId() }, 'NOT_FOUND');
  });

  it('VALIDATION for a blank name', () => {
    h.fail('UpsertArea', { ...area, name: '  ' }, 'VALIDATION');
  });
});
