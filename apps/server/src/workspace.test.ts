import { describe, expect, it } from 'vitest';

// Guards the workspace wiring: the server must resolve sibling packages by their package names.
describe('workspace packages', () => {
  it('resolves @dinepos/shared and @dinepos/printing', async () => {
    const [shared, printing] = await Promise.all([
      import('@dinepos/shared'),
      import('@dinepos/printing'),
    ]);
    expect(shared).toBeTypeOf('object');
    expect(printing).toBeTypeOf('object');
  });
});
