import { newId } from '@dinepos/shared';
import { describe, expect, it } from 'vitest';
import { adminBasics, useHarness } from '../testing/command-harness.js';

describe('UpsertAddonGroup', () => {
  const h = useHarness();
  const cheese = { id: newId(), name: 'Extra cheese', pricePaise: 4000 };
  const group = { id: newId(), name: 'Extras', minSelect: 0, maxSelect: 2, addons: [cheese] };
  adminBasics(h, 'UpsertAddonGroup', 'addon_group', () => ({ ...group }));

  it('upserts addons and keeps ones left out (never deletes)', () => {
    h.run('UpsertAddonGroup', group);
    const butter = { id: newId(), name: 'Extra butter', pricePaise: 3000 };
    h.run('UpsertAddonGroup', { ...group, addons: [{ ...cheese, pricePaise: 4500 }, butter] });
    h.run('UpsertAddonGroup', { ...group, addons: [butter] });
    expect(h.db.prepare('SELECT name, price_paise FROM addon ORDER BY name').all()).toEqual([
      { name: 'Extra butter', price_paise: 3000 },
      { name: 'Extra cheese', price_paise: 4500 },
    ]);
  });

  it('VALIDATION when minSelect > maxSelect, a price is fractional, or an addon repeats', () => {
    h.fail('UpsertAddonGroup', { ...group, minSelect: 3, maxSelect: 1 }, 'VALIDATION');
    h.fail('UpsertAddonGroup', { ...group, addons: [{ ...cheese, pricePaise: 40.5 }] }, 'VALIDATION');
    h.fail('UpsertAddonGroup', { ...group, addons: [cheese, cheese] }, 'VALIDATION');
  });

  it('INVALID_STATE when an addon id belongs to another group', () => {
    h.run('UpsertAddonGroup', group);
    h.fail('UpsertAddonGroup', { id: newId(), name: 'Other', addons: [cheese] }, 'INVALID_STATE');
  });
});
