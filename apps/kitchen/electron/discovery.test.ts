import { createSocket, type Socket } from 'node:dgram';
import { encodeDiscoveryReply, isDiscoveryProbe } from '@dinepos/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { broadcastOf, discoverServers, pickServer, probeTargets, type FoundServer } from './discovery.js';

let fake: Socket | null = null;
afterEach(() => {
  fake?.close();
  fake = null;
});

describe('kitchen: finding the server', () => {
  it('works out each network’s broadcast address', () => {
    expect(broadcastOf('192.168.1.23', '255.255.255.0')).toBe('192.168.1.255');
    expect(broadcastOf('10.0.5.9', '255.255.0.0')).toBe('10.0.255.255');
    expect(broadcastOf('nope', '255.255.255.0')).toBeNull();
    const targets = probeTargets({
      wifi: [{ address: '192.168.1.23', netmask: '255.255.255.0', family: 'IPv4', mac: '', internal: false, cidr: null }],
      lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '', internal: true, cidr: null }],
      apipa: [{ address: '169.254.3.4', netmask: '255.255.0.0', family: 'IPv4', mac: '', internal: false, cidr: null }],
    });
    expect(targets).toEqual(['192.168.1.255', '255.255.255.255', '127.0.0.1']);
  });

  it('collects the servers that answer, at the address they answered from', async () => {
    fake = createSocket('udp4');
    const s = fake;
    s.on('message', (m, r) => {
      if (isDiscoveryProbe(m.toString('utf8'))) s.send(encodeDiscoveryReply({ serverId: '01JCSERVER0000000000000000', name: 'Saffron', host: 'pos-master', port: 7420 }), r.port, r.address);
    });
    await new Promise<void>((res) => s.bind(0, '127.0.0.1', () => res()));
    const found = await discoverServers({ targets: ['127.0.0.1'], port: s.address().port, timeoutMs: 300 });
    expect(found).toEqual([{ url: 'http://127.0.0.1:7420', serverId: '01JCSERVER0000000000000000', name: 'Saffron', host: 'pos-master' }]);
  });

  it('finds nothing when nobody answers', async () => {
    expect(await discoverServers({ targets: ['127.0.0.1'], port: 9, timeoutMs: 150 })).toEqual([]);
  });

  it('follows its own server only', () => {
    const f = (url: string, serverId: string): FoundServer => ({ url, serverId, name: '', host: '' });
    const found = [f('http://192.168.1.9:7420', 'OTHER-OUTLET-1'), f('http://192.168.1.7:7420', 'OURS-00000001'), f('http://127.0.0.1:7420', 'OURS-00000001')];
    expect(pickServer(found, 'OURS-00000001', 'http://192.168.1.7:7420')).toBe('http://192.168.1.7:7420');
    expect(pickServer(found, 'OURS-00000001', 'http://192.168.1.4:7420')).toBe('http://127.0.0.1:7420');
    expect(pickServer([found[1]!], 'OURS-00000001', null)).toBe('http://192.168.1.7:7420');
    expect(pickServer(found, 'GONE-00000001', null)).toBeNull();
  });
});
