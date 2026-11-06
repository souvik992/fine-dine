// P2-15: asks the shop network "where is the DinePOS server?" (format: packages/shared/src/discovery.ts).
// One probe to every local network's broadcast address (and this PC itself); each server answers this socket alone,
// which the Windows firewall lets in as the reply to our own question. The address is where the answer came from.
import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { DISCOVERY_PORT, DISCOVERY_PROBE, parseDiscoveryReply } from '@dinepos/shared';

export interface FoundServer {
  /** e.g. "http://192.168.1.7:7420" */
  url: string;
  serverId: string;
  name: string;
  host: string;
}

type Ifaces = ReturnType<typeof networkInterfaces>;

/** "192.168.1.23" with "255.255.255.0" → "192.168.1.255". */
export function broadcastOf(address: string, netmask: string): string | null {
  const a = address.split('.').map(Number);
  const m = netmask.split('.').map(Number);
  if (a.length !== 4 || m.length !== 4 || [...a, ...m].some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return a.map((n, i) => (n | (~m[i]! & 255)) & 255).join('.');
}

/** Where to send the probe: each LAN's broadcast address, the all-networks one, and this PC (server on the same PC). */
export function probeTargets(ifaces: Ifaces = networkInterfaces()): string[] {
  const out = new Set<string>();
  for (const list of Object.values(ifaces)) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal || i.address.startsWith('169.254.')) continue;
      const b = broadcastOf(i.address, i.netmask);
      if (b) out.add(b);
    }
  }
  out.add('255.255.255.255');
  out.add('127.0.0.1');
  return [...out];
}

/** Every DinePOS server that answered within `timeoutMs` (one entry per address). */
export async function discoverServers(opts: { timeoutMs?: number; targets?: string[]; port?: number } = {}): Promise<FoundServer[]> {
  const { timeoutMs = 1500, targets = probeTargets(), port = DISCOVERY_PORT } = opts;
  const socket = createSocket('udp4');
  const found = new Map<string, FoundServer>();
  socket.on('message', (msg, rinfo) => {
    const r = parseDiscoveryReply(msg.toString('utf8'));
    if (!r) return;
    const url = `http://${rinfo.address}:${r.port}`;
    found.set(url, { url, serverId: r.serverId, name: r.name, host: r.host });
  });
  socket.on('error', () => undefined); // a network that refuses broadcast: whatever did answer is kept
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(0, () => {
        socket.off('error', reject);
        resolve();
      });
    });
    socket.setBroadcast(true);
    for (const t of targets) socket.send(DISCOVERY_PROBE, port, t, () => undefined);
    await new Promise((r) => setTimeout(r, timeoutMs));
  } catch {
    // no network at all
  } finally {
    try {
      socket.close();
    } catch {
      // already closed
    }
  }
  return [...found.values()];
}

/**
 * The address of the outlet server with this id: the one we had if it still answers, else one on this PC (the
 * server runs here), else the first that answered. Null when that server did not answer.
 */
export function pickServer(found: FoundServer[], serverId: string, current: string | null): string | null {
  const ours = found.filter((f) => f.serverId === serverId);
  return (
    ours.find((f) => f.url === current)?.url ??
    ours.find((f) => new URL(f.url).hostname === '127.0.0.1')?.url ??
    ours[0]?.url ??
    null
  );
}
