import { describe, expect, it } from 'vitest';
import { formatHardwareId, hostedHardwareId, parseMacPlatformUuid } from './hardware.js';

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

describe('Mac hardware id', () => {
  it('reads the IOPlatformUUID from ioreg (not the hostname, which changes with the network)', () => {
    const ioreg = '+-o J314sAP  <class IOPlatformExpertDevice>\n    {\n      "IOPlatformSerialNumber" = "C02XYZ"\n      "IOPlatformUUID" = "1a2b3c4d-0000-1111-2222-333344445555"\n    }\n';
    expect(parseMacPlatformUuid(ioreg)).toBe('1A2B3C4D-0000-1111-2222-333344445555');
    expect(parseMacPlatformUuid('')).toBeNull();
  });
});
