import net from 'node:net';
import type { PrintRequest, Transport } from './types.js';

export interface TcpOptions {
  /** Limit for connecting and flushing every byte (docs/06: 5 s). */
  timeoutMs?: number;
  /**
   * After the last byte is flushed, how long to wait for the printer to close or reset the connection.
   * A reset fails the job; silence counts as printed, because many printers keep the socket open and
   * treating that as a failure would reprint every ticket.
   */
  settleMs?: number;
}

/** Raw ESC/POS over TCP (port 9100). */
export class TcpTransport implements Transport {
  private readonly timeoutMs: number;
  private readonly settleMs: number;

  constructor(opts: TcpOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 5_000;
    this.settleMs = opts.settleMs ?? 1_500;
  }

  send({ printer, bytes }: PrintRequest): Promise<void> {
    const host = printer.host?.trim();
    const port = printer.port ?? 9100;
    if (!host) return Promise.reject(new Error(`Printer "${printer.name}" has no network address. Set it in Settings, Printers.`));

    return new Promise((resolve, reject) => {
      let settled = false;
      let flushed = false;
      let timer: NodeJS.Timeout;
      const socket = net.connect({ host, port });
      const done = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (err) reject(err);
        else resolve();
      };
      timer = setTimeout(
        () => done(new Error(`Printer "${printer.name}" (${host}:${port}) did not answer in time. Check that it is on and connected.`)),
        this.timeoutMs,
      );
      socket.once('connect', () => {
        socket.end(Buffer.from(bytes), () => {
          flushed = true;
          clearTimeout(timer);
          timer = setTimeout(() => done(), this.settleMs);
        });
      });
      socket.once('error', (e: NodeJS.ErrnoException) => done(new Error(describe(printer.name, host, port, e))));
      socket.once('close', (hadError) => {
        if (hadError) return; // 'error' already reported it
        if (flushed) done();
        else done(new Error(`Printer "${printer.name}" closed the connection before the ticket was sent.`));
      });
    });
  }
}

function describe(name: string, host: string, port: number, e: NodeJS.ErrnoException): string {
  switch (e.code) {
    case 'ECONNREFUSED':
      return `Printer "${name}" (${host}:${port}) refused the connection. Check the printer's IP address and port.`;
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'ETIMEDOUT':
      return `Printer "${name}" (${host}:${port}) cannot be reached. Check the network cable or Wi-Fi.`;
    case 'ENOTFOUND':
      return `Printer "${name}": the address "${host}" was not found.`;
    case 'ECONNRESET':
    case 'EPIPE':
      return `Printer "${name}" dropped the connection while printing. The ticket will be sent again.`;
    case undefined:
    default:
      return `Printer "${name}" (${host}:${port}) failed: ${e.code ?? e.message}.`;
  }
}
