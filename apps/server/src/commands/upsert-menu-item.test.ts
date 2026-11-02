import { newId } from '@dinepos/shared';
import { describe, expect, it } from 'vitest';
import { adminBasics, useHarness } from '../testing/command-harness.js';

describe('UpsertMenuItem', () => {
  const h = useHarness();
  const categoryId = newId();
  const groupId = newId();
  const half = { id: newId(), name: 'Half', pricePaise: 30_000 };
  const item = { id: newId(), categoryId, name: 'Butter Chicken', shortCode: 'bc', veg: false, basePricePaise: 30_000, taxRateBp: 500 };
  const setup = () => {
    h.run('UpsertCategory', { id: categoryId, name: 'Mains' });
    h.run('UpsertAddonGroup', { id: groupId, name: 'Extras' });
  };
  adminBasics(h, 'UpsertMenuItem', 'menu_item', () => ({ ...item }), setup);

  it('stores the short code upper-case and money as integer paise', () => {
    setup();
    h.run('UpsertMenuItem', item);
    expect(h.db.prepare('SELECT short_code, base_price_paise, tax_rate_bp FROM menu_item WHERE id = ?').get(item.id)).toEqual({
      short_code: 'BC',
      base_price_paise: 30_000,
      tax_rate_bp: 500,
    });
  });

  it('upserts variants (keeps omitted ones) and replaces addon-group links', () => {
    setup();
    h.run('UpsertMenuItem', { ...item, variants: [half], addonGroupIds: [groupId] });
    const full = { id: newId(), name: 'Full', pricePaise: 52_000 };
    h.run('UpsertMenuItem', { ...item, variants: [full], addonGroupIds: [] });
    expect(h.count('variant', `item_id = '${item.id}'`)).toBe(2);
    expect(h.count('item_addon_group', `item_id = '${item.id}'`)).toBe(0);
  });

  it('INVALID_STATE for a short code used by another item, or a variant of another item', () => {
    setup();
    h.run('UpsertMenuItem', { ...item, variants: [half] });
    h.fail('UpsertMenuItem', { ...item, id: newId(), name: 'Other', shortCode: 'BC' }, 'INVALID_STATE');
    h.fail('UpsertMenuItem', { ...item, id: newId(), name: 'Other', shortCode: 'OT', variants: [half] }, 'INVALID_STATE');
  });

  it('NOT_FOUND for an unknown category, station or addon group', () => {
    setup();
    h.fail('UpsertMenuItem', { ...item, categoryId: newId() }, 'NOT_FOUND');
    h.fail('UpsertMenuItem', { ...item, stationId: newId() }, 'NOT_FOUND');
    h.fail('UpsertMenuItem', { ...item, addonGroupIds: [newId()] }, 'NOT_FOUND');
  });

  it('VALIDATION for float prices, GST above 28% and bad HSN/SAC', () => {
    setup();
    h.fail('UpsertMenuItem', { ...item, basePricePaise: 299.5 }, 'VALIDATION');
    h.fail('UpsertMenuItem', { ...item, taxRateBp: 2900 }, 'VALIDATION');
    h.fail('UpsertMenuItem', { ...item, hsnSac: '12' }, 'VALIDATION');
  });

  it('announces menu.changed with the item id and a rising version', () => {
    setup();
    h.run('UpsertMenuItem', item);
    const last = h.db.prepare("SELECT payload_json FROM event_log WHERE event = 'menu.changed' ORDER BY seq DESC LIMIT 1").pluck().get() as string;
    expect(JSON.parse(last)).toEqual({ menuVersion: 3, itemIds: [item.id] });
  });
});
