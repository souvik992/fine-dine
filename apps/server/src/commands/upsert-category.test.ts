import { newId } from '@dinepos/shared';
import { describe, it } from 'vitest';
import { adminBasics, useHarness } from '../testing/command-harness.js';

describe('UpsertCategory', () => {
  const h = useHarness();
  const category = { id: newId(), name: 'Starters' };
  adminBasics(h, 'UpsertCategory', 'category', () => ({ ...category }));

  it('NOT_FOUND for an unknown parent or station', () => {
    h.fail('UpsertCategory', { ...category, parentId: newId() }, 'NOT_FOUND');
    h.fail('UpsertCategory', { ...category, stationId: newId() }, 'NOT_FOUND');
  });

  it('VALIDATION for self-parent and INVALID_STATE for a loop', () => {
    h.fail('UpsertCategory', { ...category, parentId: category.id }, 'VALIDATION');
    const child = newId();
    h.run('UpsertCategory', category);
    h.run('UpsertCategory', { id: child, name: 'Kebabs', parentId: category.id });
    h.fail('UpsertCategory', { ...category, parentId: child }, 'INVALID_STATE');
  });
});
