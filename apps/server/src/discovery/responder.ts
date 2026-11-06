// P2-15: answers "where is the DinePOS server?" on the shop network (format: packages/shared/src/discovery.ts).
// A UDP socket on the server's port number; a probe gets one reply, sent to the asker only (never broadcast), so the
// asker's firewall lets it in as the answer to its own question. Failing to bind (port taken) is logged, not fatal:
// typed addresses keep working.
import { createSocket, type Socket } from 'node:dgram';
import { encodeDiscoveryReply, isDiscoveryProbe } from '@dinepos/shared';

export interface DiscoveryInfo {
  serverId: string;
  /** Read per probe, so a renamed outlet shows at once. */
  name: () => string;
  host: string;
  /** The TCP port the server listens on. */
  port: number;
}

export interface DiscoveryResponder {
  /** The UDP port actually bound (0 = a free one, for tests). */
  port: number;
  close(): Promise<void>;
}

export async function startDiscoveryResponder(
  info: DiscoveryInfo,
  opts: { port: number; host?: string; log?: (level: 'info' | 'warn', msg: string, data?: object) => void },
): Promise<DiscoveryResponder | null> {
  const socket: Socket = createSocket({ type: 'udp4', reuseAddr: false });
  socket.on('message', (msg, rinfo) => {
    if (msg.length > 256 || !isDiscoveryProbe(msg.toString('utf8'))) return;
    let reply: string;
    try {
      reply = encodeDiscoveryReply({ serverId: info.serverId, name: info.name(), host: info.host, port: info.port });
    } catch {
      return;
    }
    socket.send(reply, rinfo.port, rinfo.address, () => undefined);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(opts.port, opts.host ?? '0.0.0.0', () => {
        socket.off('error', reject);
        resolve();
      });
    });
  } catch (err) {
    opts.log?.('warn', 'server discovery is off: the UDP port is in use', { port: opts.port, error: String(err) });
    socket.close();
    return null;
  }
  socket.on('error', (err) => opts.log?.('warn', 'server discovery socket error', { error: String(err) }));
  const port = socket.address().port;
  opts.log?.('info', 'server discovery on', { udpPort: port });
  let closed: Promise<void> | undefined;
  return {
    port,
    close: () => (closed ??= new Promise<void>((resolve) => socket.close(() => resolve()))),
  };
}
