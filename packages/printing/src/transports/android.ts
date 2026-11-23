// Printers in DinePOS for Android, through the app (apps/android/.../PrinterBridge.java, from quickPOS): USB printers
// (Android's USB host API) and Bluetooth printers, including the built-in printer of Sunmi-type POS machines (a paired
// Bluetooth device named "InnerPrinter"). The app listens on a loopback port with a token it passes in
// DINEPOS_ANDROID_BRIDGE ("port:token"). One JSON line per request ({ token, op, ... }), then for "print" the ESC/POS
// bytes; one JSON line back.
//
// Addresses are DinePOS's own: a USB printer is transport `usbdirect` with device "VID:PID[:serial]" (as on Windows),
// a Bluetooth printer is transport `serial` with device "AA:BB:CC:DD:EE:FF" (its MAC; a COM port on Windows).
import net from 'node:net';
import type { PrintRequest, Transport } from './types.js';

export interface AndroidPrinterInfo {
  /** DinePOS transport and device for this printer. */
  transport: 'usbdirect' | 'serial';
  device: string;
  name: string;
  detail: string;
  /** The built-in printer of a POS machine. */
  builtin: boolean;
  /** USB: Android lets DinePOS use it (the user tapped OK). Bluetooth: always true. */
  allowed: boolean;
}

const BRIDGE_USB = /^usb:([0-9a-f]{4}):([0-9a-f]{4})(?::([A-Za-z0-9._-]{1,64}))?$/;
const BRIDGE_BT = /^bt:((?:[0-9A-F]{2}:){5}[0-9A-F]{2})$/;
/** A string from the app's answer, else the fallback. */
const text = (v: unknown, fallback: string) => (typeof v === 'string' && v ? v : fallback);

export const BLUETOOTH_MAC = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;

export function bridgeConfig(env: NodeJS.ProcessEnv = process.env): { port: number; token: string } | null {
  const m = /^(\d{1,5}):([A-Za-z0-9_-]{20,})$/.exec(env.DINEPOS_ANDROID_BRIDGE ?? '');
  return m ? { port: Number(m[1]), token: m[2]! } : null;
}

/** DinePOS printer → the bridge's address (usb:vid:pid[:serial] / bt:MAC), or null. */
export function bridgeAddress(transport: string, device: string | null | undefined): string | null {
  const d = (device ?? '').trim();
  if (transport === 'usbdirect') {
    const m = /^([0-9a-f]{4}):([0-9a-f]{4})(?::([0-9A-Za-z._-]{1,64}))?$/i.exec(d);
    return m ? `usb:${m[1]!.toLowerCase()}:${m[2]!.toLowerCase()}${m[3] ? `:${m[3]}` : ''}` : null;
  }
  if (transport === 'serial' && BLUETOOTH_MAC.test(d)) return `bt:${d.toUpperCase()}`;
  return null;
}

/** The bridge's address → DinePOS transport and device. */
export function fromBridgeAddress(address: string): { transport: 'usbdirect' | 'serial'; device: string } | null {
  const u = BRIDGE_USB.exec(address);
  if (u) return { transport: 'usbdirect', device: `${u[1]!.toUpperCase()}:${u[2]!.toUpperCase()}${u[3] ? `:${u[3]}` : ''}` };
  const b = BRIDGE_BT.exec(address);
  return b ? { transport: 'serial', device: b[1]! } : null;
}

function call(cfg: { port: number; token: string }, req: Record<string, unknown>, payload: Uint8Array | null, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: cfg.port });
    let buf = '';
    let settled = false;
    const done = (e: Error | null, v?: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (e) reject(e);
      else resolve(v!);
    };
    socket.setTimeout(timeoutMs, () => done(new Error('The printer did not answer in time.')));
    socket.on('error', () => done(new Error('The printer service of the app is not available. Close DinePOS and open it again.')));
    socket.on('connect', () => {
      socket.write(JSON.stringify({ ...req, token: cfg.token, length: payload?.length ?? 0 }) + '\n');
      if (payload) socket.write(payload);
    });
    socket.setEncoding('utf8');
    socket.on('data', (c: string) => {
      buf += c;
      const i = buf.indexOf('\n');
      if (i < 0) return;
      try {
        done(null, JSON.parse(buf.slice(0, i)) as Record<string, unknown>);
      } catch {
        done(new Error('The printer service of the app answered something unexpected.'));
      }
    });
    socket.on('end', () => done(new Error('The printer service of the app closed the connection.')));
  });
}

/** USB and Bluetooth printers Android can see now. Empty when not running inside the Android app. */
export async function listAndroidPrinters(env: NodeJS.ProcessEnv = process.env): Promise<AndroidPrinterInfo[]> {
  const cfg = bridgeConfig(env);
  if (!cfg) return [];
  const r = await call(cfg, { op: 'list' }, null, 8000);
  if (r.ok !== true) throw new Error(text(r.error, 'Printers could not be listed.'));
  const out: AndroidPrinterInfo[] = [];
  for (const raw of Array.isArray(r.printers) ? r.printers : []) {
    const p = raw as Record<string, unknown>;
    const at = typeof p.address === 'string' ? fromBridgeAddress(p.address) : null;
    if (!at) continue;
    out.push({ ...at, name: text(p.name, 'Printer').slice(0, 60), detail: text(p.detail, '').slice(0, 120), builtin: p.builtin === true, allowed: p.allowed !== false });
  }
  return out;
}

/** Sends the bytes to a USB or Bluetooth printer through the Android app (it chunks and paces them). */
export class AndroidTransport implements Transport {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}
  async send({ printer: target, bytes }: PrintRequest): Promise<void> {
    const cfg = bridgeConfig(this.env);
    if (!cfg) throw new Error('This printer prints only from the DinePOS app on the phone or tablet it was set up on.');
    const address = bridgeAddress(target.transport, target.device);
    if (!address) throw new Error('This printer address is not one Android knows (USB VID:PID, or a Bluetooth address).');
    const r = await call(cfg, { op: 'print', address, slow: target.profile === 'slow_buffer' }, bytes, 30_000);
    if (r.ok !== true) throw new Error(text(r.error, 'The printer did not print.'));
  }
}
