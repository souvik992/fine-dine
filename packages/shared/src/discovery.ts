// Finding the outlet server on the shop network when its address has changed (P2-15, docs/01 "Ports and discovery").
// A client sends PROBE as one UDP datagram (broadcast) to DISCOVERY_PORT; each DinePOS server answers the sender
// alone with a reply. The server's address is where the reply came from, so a reply never names an IP itself.
// Pure: the sockets live in apps/server/src/discovery and apps/kitchen/electron/discovery.ts.

/** UDP, the same number as the server's TCP port. */
export const DISCOVERY_PORT = 7420;
export const DISCOVERY_PROBE = 'DINEPOS-DISCOVER 1';
/** Anything longer is not a probe (and is never answered). */
export const DISCOVERY_MAX_PROBE_BYTES = 64;

export interface DiscoveryReply {
  service: 'dinepos-server';
  v: 1;
  /** Stable for the outlet's database (survives a new IP, a restart and a restore on another PC). */
  serverId: string;
  /** The outlet name from Settings, so a person can tell two outlets apart. */
  name: string;
  /** The master PC's computer name, e.g. "pos-master" (reachable as pos-master.local on most networks). */
  host: string;
  /** The server's TCP port. */
  port: number;
}

/** `text`: the datagram decoded as UTF-8. */
export function isDiscoveryProbe(text: string): boolean {
  return text.length <= DISCOVERY_MAX_PROBE_BYTES && text.trim() === DISCOVERY_PROBE;
}

export function encodeDiscoveryReply(r: Omit<DiscoveryReply, 'service' | 'v'>): string {
  const reply: DiscoveryReply = { service: 'dinepos-server', v: 1, ...r };
  return JSON.stringify(reply);
}

/** Null for anything that is not a DinePOS reply. */
export function parseDiscoveryReply(text: string): DiscoveryReply | null {
  if (text.length > 2048) return null;
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object') return null;
  const o = j as Record<string, unknown>;
  if (o.service !== 'dinepos-server' || o.v !== 1) return null;
  const { serverId, name, host, port } = o;
  if (typeof serverId !== 'string' || !/^[0-9A-Za-z_-]{8,64}$/.test(serverId)) return null;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return {
    service: 'dinepos-server',
    v: 1,
    serverId,
    name: typeof name === 'string' ? name.slice(0, 80) : '',
    host: typeof host === 'string' && isDnsLabel(host) ? host : '',
    port,
  };
}

/** A computer name usable as `<name>.local` (one DNS label). */
export function isDnsLabel(s: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(s);
}

/** "http://pos-master.local:7420", or null when the computer name cannot be one. */
export function localNameUrl(hostname: string, port: number): string | null {
  const label = hostname.trim().toLowerCase();
  return isDnsLabel(label) ? `http://${label}.local:${port}` : null;
}
