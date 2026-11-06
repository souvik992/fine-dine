import { describe, expect, it } from 'vitest';
import { DISCOVERY_PROBE, encodeDiscoveryReply, isDiscoveryProbe, localNameUrl, parseDiscoveryReply } from './discovery.js';

describe('server discovery format', () => {
  it('answers only the probe', () => {
    expect(isDiscoveryProbe(DISCOVERY_PROBE)).toBe(true);
    expect(isDiscoveryProbe(`${DISCOVERY_PROBE}\n`)).toBe(true);
    expect(isDiscoveryProbe('DINEPOS-DISCOVER 2')).toBe(false);
    expect(isDiscoveryProbe(DISCOVERY_PROBE.padEnd(100, ' '))).toBe(false);
  });

  it('round-trips a reply', () => {
    const r = parseDiscoveryReply(encodeDiscoveryReply({ serverId: '01JC0000000000000000000000', name: 'Saffron', host: 'pos-master', port: 7420 }));
    expect(r).toEqual({ service: 'dinepos-server', v: 1, serverId: '01JC0000000000000000000000', name: 'Saffron', host: 'pos-master', port: 7420 });
  });

  it('refuses what is not a DinePOS reply', () => {
    for (const bad of ['', 'nope', '{}', '[]', '{"service":"dinepos-server","v":2,"serverId":"01JC0000000000000000000000","port":7420}', '{"service":"dinepos-server","v":1,"serverId":"x","port":7420}', '{"service":"dinepos-server","v":1,"serverId":"01JC0000000000000000000000","port":0}'])
      expect(parseDiscoveryReply(bad)).toBeNull();
  });

  it('drops a host that is not a computer name', () => {
    expect(parseDiscoveryReply(encodeDiscoveryReply({ serverId: '01JC0000000000000000000000', name: 'X', host: 'evil.example.com', port: 7420 }))?.host).toBe('');
  });

  it('makes a .local address from the computer name', () => {
    expect(localNameUrl('POS-MASTER', 7420)).toBe('http://pos-master.local:7420');
    expect(localNameUrl('my_pc', 7420)).toBeNull();
    expect(localNameUrl('', 7420)).toBeNull();
  });
});
