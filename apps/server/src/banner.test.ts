import { describe, expect, it } from 'vitest';
import { formatBanner, lanAddresses } from './banner.js';

describe('server banner', () => {
  const base = { version: '0.1.0', host: '0.0.0.0', port: 7420, dataDir: 'C:\\ProgramData\\DinePOS', businessDate: '2026-11-02', logFile: null };

  it('shows the local and LAN addresses billing terminals should use', () => {
    const text = formatBanner({ ...base, lan: ['192.168.1.5', '10.0.0.7'] });
    expect(text).toContain('On this PC:       http://127.0.0.1:7420');
    expect(text).toContain('Other devices:    http://192.168.1.5:7420');
    expect(text).toContain('                  http://10.0.0.7:7420');
    expect(text).toContain('Data folder:      C:\\ProgramData\\DinePOS');
    expect(text).toContain('Close it (or press Ctrl+C) to stop the server safely.');
  });

  it('says when other devices cannot connect', () => {
    expect(formatBanner({ ...base, lan: [] })).toContain('no network connection found');
    expect(formatBanner({ ...base, host: '127.0.0.1', lan: ['192.168.1.5'] })).toContain('off (listening on 127.0.0.1 only)');
  });

  it('lists only real IPv4 LAN addresses', () => {
    const ifaces = {
      Ethernet: [
        { address: '192.168.1.5', family: 'IPv4', internal: false },
        { address: 'fe80::1', family: 'IPv6', internal: false },
      ],
      Loopback: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      APIPA: [{ address: '169.254.10.1', family: 'IPv4', internal: false }],
    } as unknown as Parameters<typeof lanAddresses>[0];
    expect(lanAddresses(ifaces)).toEqual(['192.168.1.5']);
  });
});
