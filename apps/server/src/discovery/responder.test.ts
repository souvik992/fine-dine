import { createSocket } from 'node:dgram';
import { DISCOVERY_PROBE, parseDiscoveryReply, type DiscoveryReply } from '@dinepos/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { startDiscoveryResponder, type DiscoveryResponder } from './responder.js';

let responder: DiscoveryResponder | null = null;
afterEach(async () => {
  await responder?.close();
  responder = null;
});

/** Sends `msg` to the responder and collects what comes back within `ms`. */
async function ask(port: number, msg: string, ms = 300): Promise<Array<{ reply: DiscoveryReply | null; from: string }>> {
  const s = createSocket('udp4');
  const got: Array<{ reply: DiscoveryReply | null; from: string }> = [];
  s.on('message', (m, r) => got.push({ reply: parseDiscoveryReply(m.toString('utf8')), from: r.address }));
  await new Promise<void>((res) => s.bind(0, '127.0.0.1', () => res()));
  s.send(msg, port, '127.0.0.1');
  await new Promise((res) => setTimeout(res, ms));
  s.close();
  return got;
}

describe('discovery responder', () => {
  it('answers a probe with the server id, outlet name, computer name and TCP port', async () => {
    let name = 'Saffron';
    responder = await startDiscoveryResponder({ serverId: '01JC0000000000000000000000', name: () => name, host: 'pos-master', port: 7420 }, { port: 0, host: '127.0.0.1' });
    expect(responder).not.toBeNull();
    const got = await ask(responder!.port, DISCOVERY_PROBE);
    expect(got).toEqual([{ from: '127.0.0.1', reply: { service: 'dinepos-server', v: 1, serverId: '01JC0000000000000000000000', name: 'Saffron', host: 'pos-master', port: 7420 } }]);
    name = 'Saffron Bistro';
    expect((await ask(responder!.port, DISCOVERY_PROBE))[0]?.reply?.name).toBe('Saffron Bistro');
  });

  it('ignores anything else', async () => {
    responder = await startDiscoveryResponder({ serverId: '01JC0000000000000000000000', name: () => 'X', host: 'h', port: 7420 }, { port: 0, host: '127.0.0.1' });
    expect(await ask(responder!.port, 'hello')).toEqual([]);
  });

  it('starts without discovery when the port is taken', async () => {
    responder = await startDiscoveryResponder({ serverId: '01JC0000000000000000000000', name: () => 'X', host: 'h', port: 7420 }, { port: 0, host: '127.0.0.1' });
    const warnings: string[] = [];
    const second = await startDiscoveryResponder({ serverId: '01JC0000000000000000000000', name: () => 'X', host: 'h', port: 7420 }, { port: responder!.port, host: '127.0.0.1', log: (_l, m) => warnings.push(m) });
    expect(second).toBeNull();
    expect(warnings[0]).toMatch(/in use/);
  });
});
