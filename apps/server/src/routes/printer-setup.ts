// Settings › Printers (quickPOS printer setup): finding printers on the outlet server PC, so nobody has to type a
// Windows printer name, COM port or IP address. Read only: these look at the PC and the network and change nothing
// (setting a printer up is the UpsertPrinter command). Owner/manager only, as setting printers up is.
import { discoverNetworkPrinters, listSerialPorts, listUsbPrinters, listWindowsPrinters, type UsbPrinterInfo, type WindowsPrinter } from '@dinepos/printing';
import type { FastifyInstance } from 'fastify';
import { requireRight } from '../auth/require-right.js';
import type { Db } from '../db/connection.js';

export interface PrinterSetupDeps {
  db: Db;
  now: () => Date;
  /** Tests: what the PC would answer. */
  scan?: { usb: () => Promise<UsbPrinterInfo[]>; windows: () => Promise<WindowsPrinter[]> };
}

/** A USB printer plugged into the server PC, and the printer it is set up as (if any). */
export interface UsbDevice {
  key: string;
  /** usbdirect: no Windows driver needed (device = vendor:product[:serial]); usb: a Windows printer (windowsName). */
  transport: 'usbdirect' | 'usb';
  device: string | null;
  windowsName: string | null;
  name: string;
  detail: string;
  widthMm: 58 | 80;
  printerId: string | null;
  printerName: string | null;
}

const guessWidth = (s: string): 58 | 80 => (/(^|\D)58(\D|$)|58\s?mm/i.test(s) ? 58 : 80);

/** Every USB printer plugged in now, matched to the printers already set up (quickPOS plug and play). */
export function usbDevices(db: Db, usb: UsbPrinterInfo[], windows: WindowsPrinter[]): UsbDevice[] {
  const set = db.prepare("SELECT id, name, transport, device, windows_name FROM printer WHERE transport IN ('usb', 'usbdirect')").all() as Array<{
    id: string;
    name: string;
    transport: string;
    device: string | null;
    windows_name: string | null;
  }>;
  const find = (transport: string, address: string) =>
    set.find((p) => p.transport === transport && (transport === 'usb' ? p.windows_name : p.device)?.toLowerCase() === address.toLowerCase());
  const out: UsbDevice[] = [];
  for (const u of usb) {
    const generic = /^usb (printing support|printer)$/i.test(u.name);
    const name = generic ? (u.vendor ? `${u.vendor.split(' (')[0]} USB printer` : 'USB receipt printer') : u.name;
    const p = find('usbdirect', u.id);
    out.push({
      key: `usbdirect:${u.id}`,
      transport: 'usbdirect',
      device: u.id,
      windowsName: null,
      name: name.slice(0, 80),
      detail: u.driver === 'winusb' ? `USB, WinUSB driver (${u.vid}:${u.pid})` : `USB, no driver needed (${u.vid}:${u.pid})`,
      widthMm: guessWidth(u.name),
      printerId: p?.id ?? null,
      printerName: p?.name ?? null,
    });
  }
  for (const w of windows) {
    if (w.connection !== 'usb') continue;
    const p = find('usb', w.name);
    out.push({
      key: `usb:${w.name}`,
      transport: 'usb',
      device: null,
      windowsName: w.name,
      name: w.name.slice(0, 80),
      detail: `USB, Windows driver ${w.driver} on ${w.port}${w.offline ? ' (offline)' : ''}`,
      widthMm: guessWidth(`${w.name} ${w.driver}`),
      printerId: p?.id ?? null,
      printerName: p?.name ?? null,
    });
  }
  return out;
}

export function printerSetupRoutes(app: FastifyInstance, deps: PrinterSetupDeps): void {
  const { db, now } = deps;
  const scan = deps.scan ?? { usb: () => listUsbPrinters().catch(() => []), windows: () => listWindowsPrinters().catch(() => []) };
  // the Printers screen asks every few seconds; the PC is looked at no more than every 15 s unless asked to refresh
  let last: { at: number; usb: UsbPrinterInfo[]; windows: WindowsPrinter[] } | null = null;
  let running: Promise<{ at: number; usb: UsbPrinterInfo[]; windows: WindowsPrinter[] }> | null = null;
  const scanned = async (refresh: boolean) => {
    if (!refresh && last && Date.now() - last.at < 15_000) return last;
    running ??= Promise.all([scan.usb(), scan.windows()])
      .then(([usb, windows]) => (last = { at: Date.now(), usb, windows }))
      .finally(() => (running = null));
    return running;
  };

  app.get<{ Querystring: { refresh?: string } }>('/v1/printers/usb-devices', async (req, reply) => {
    requireRight(db, req, 'admin', now());
    const s = await scanned(req.query.refresh === '1');
    void reply.header('cache-control', 'no-store');
    return { scannedAt: new Date(s.at).toISOString(), devices: usbDevices(db, s.usb, s.windows) };
  });
  app.get('/v1/printers/windows', async (req) => {
    requireRight(db, req, 'admin', now());
    return { printers: await listWindowsPrinters() };
  });
  app.get('/v1/printers/serial-ports', async (req) => {
    requireRight(db, req, 'admin', now());
    return { ports: await listSerialPorts() };
  });
  // connects to port 9100 of each address of the server's own network (sends nothing); a few seconds
  app.get<{ Querystring: { port?: string } }>('/v1/printers/network-scan', async (req) => {
    requireRight(db, req, 'admin', now());
    const port = Number(req.query.port ?? 9100);
    return discoverNetworkPrinters({ port: Number.isInteger(port) && port > 0 && port < 65_536 ? port : 9100 });
  });
}
