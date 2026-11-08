import { describe, expect, it } from 'vitest';
import { demoSeed } from './demo-seed.js';
import { DEV_SEED_COUNTS } from './dev-seed.js';

describe('browser demo seed (P7-04)', () => {
  it('is the development outlet as plain JSON: setup first, then the commands; staff and PINs listed', () => {
    const s = JSON.parse(JSON.stringify(demoSeed())) as ReturnType<typeof demoSeed>;
    expect(s.setup.type).toBe('SetupOutlet');
    expect(s.setup.payload).toMatchObject({ outletName: 'Spice Garden (demo)', ownerId: s.owner.id, pin: s.owner.pin });
    expect(s.commands.filter((c) => c.type === 'UpsertMenuItem')).toHaveLength(DEV_SEED_COUNTS.items);
    expect(s.commands.filter((c) => c.type === 'UpsertTable')).toHaveLength(DEV_SEED_COUNTS.tables);
    expect(s.staff.map((u) => u.pin)).toEqual(['2345', '1111', '3333']);
    for (const u of s.staff) expect(s.commands.some((c) => c.type === 'UpsertUser' && c.payload.id === u.id)).toBe(true);
  });
});
