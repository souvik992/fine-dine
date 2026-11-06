import { describe, expect, it } from 'vitest';
import { formatHardwareId, hostedHardwareId } from './hardware.js';

// P6-04: hosted outlets on one cloud machine each need their own licence key.
describe('hosted outlet hardware id', () => {
  it('differs per outlet and from the machine, and stays the same for the same outlet', () => {
    const machine = ['machine-id-abc'];
    const a = hostedHardwareId('store-a', machine);
    expect(a).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){4}$/);
    expect(hostedHardwareId('store-a', machine)).toBe(a);
    expect(hostedHardwareId('store-b', machine)).not.toBe(a);
    expect(formatHardwareId(machine)).not.toBe(a);
    expect(hostedHardwareId('store-a', ['another-machine'])).not.toBe(a);
  });
});
