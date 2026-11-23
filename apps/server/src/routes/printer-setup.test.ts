import { newId } from '@dinepos/shared';
import type { UsbPrinterInfo, WindowsPrinter } from '@dinepos/printing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { Db } from '../db/connection.js';
import { DEV_OWNER, DEV_STAFF, devSeedCommands, devSetupCommand, seedId } from '../seed/dev-seed.js';
import { createTestDb } from '../testing/test-db.js';
import { usbDevices } from './printer-setup.js';

// Settings › Printers (quickPOS printer setup): the USB printers plugged into the server PC, matched to the printers
// already set up; owner/manager only.
const usb: UsbPrinterInfo[] = [
  { id: '0416:5011', vid: '0416', pid: '5011', serial: null, name: 'USB Printing Support', vendor: 'Winbond (common in 58/80 mm POS printers)', driver: 'usbprint' },
  { id: '04b8:0e15:abc', vid: '04b8', pid: '0e15', serial: 'abc', name: 'TM-T82 58mm', vendor: 'Epson', driver: 'winusb' },
];
const windows: WindowsPrinter[] = [
  { name: 'POS-80', port: 'USB001', driver: 'POS-80 Series', offline: false, connection: 'usb' },
  { name: 'Microsoft Print to PDF', port: 'PORTPROMPT:', driver: 'Microsoft Print To PDF', offline: false, connection: 'virtual' },
];

let db: Db;
let app: ReturnType<typeof buildApp>;
let owner = '';
let cashier = '';
let scans = 0;

beforeEach(async () => {
  scans = 0;
  db = createTestDb();
  app = buildApp({
    db,
    timeZone: 'Asia/Kolkata',
    trustLoopback: true,
    printerScan: {
      usb: () => {
        scans++;
        return Promise.resolve(usb);
      },
      windows: () => Promise.resolve(windows),
    },
  });
  const send = async (type: string, payload: unknown, token?: string) =>
    (await app.inject({ method: 'POST', url: '/v1/commands', headers: token ? { 'x-user-session': token } : {}, payload: { commandId: newId(), type, payload, createdAt: new Date().toISOString() } })).json<{ ok: boolean }>();
  await send(devSetupCommand().type, devSetupCommand().payload);
  owner = (await app.inject({ method: 'POST', url: '/v1/sessions', payload: { userId: DEV_OWNER.id, pin: DEV_OWNER.pin } })).json<{ token: string }>().token;
  for (const c of devSeedCommands()) await send(c.type, c.payload, owner);
  await send('UpsertPrinter', { id: newId(), name: 'Counter', transport: 'usb', windowsName: 'pos-80', role: 'bill' }, owner);
  const c = DEV_STAFF.find((s) => s.key === 'cashier')!;
  cashier = (await app.inject({ method: 'POST', url: '/v1/sessions', payload: { userId: seedId('user:cashier'), pin: c.pin } })).json<{ token: string }>().token;
});
afterEach(async () => {
  await app.close();
  db.close();
});

const get = (url: string, token = owner) => app.inject({ method: 'GET', url, headers: { 'x-user-session': token } });

describe('printer setup routes', () => {
  it('lists the plugged-in USB printers (driverless ones too), names the generic ones, and shows which are already set up', async () => {
    const r = await get('/v1/printers/usb-devices');
    expect(r.statusCode).toBe(200);
    const { devices } = r.json<{ devices: Array<Record<string, unknown>> }>();
    expect(devices).toEqual([
      expect.objectContaining({ transport: 'usbdirect', device: '0416:5011', name: 'Winbond USB printer', detail: 'USB, no driver needed (0416:5011)', widthMm: 80, printerId: null }),
      expect.objectContaining({ transport: 'usbdirect', device: '04b8:0e15:abc', name: 'TM-T82 58mm', detail: 'USB, WinUSB driver (04b8:0e15)', widthMm: 58, printerId: null }),
      expect.objectContaining({ transport: 'usb', windowsName: 'POS-80', printerName: 'Counter', detail: 'USB, Windows driver POS-80 Series on USB001' }), // matched without case
    ]);
  });

  it('DinePOS for Android: a printer plugged into the device says so, and whether Android lets DinePOS use it yet', () => {
    const android: UsbPrinterInfo[] = [
      { id: '0416:5011', vid: '0416', pid: '5011', serial: null, name: 'POS-80', vendor: null, driver: 'android', allowed: false },
      { id: '28e9:0289', vid: '28e9', pid: '0289', serial: null, name: 'USB receipt printer', vendor: null, driver: 'android', allowed: true },
    ];
    expect(usbDevices(db, android, [])).toEqual([
      expect.objectContaining({ device: '0416:5011', detail: 'USB, plugged into this device: tap Allow (0416:5011)', allowed: false }),
      expect.objectContaining({ device: '28e9:0289', detail: 'USB, plugged into this device (28e9:0289)', allowed: true }),
    ]);
    expect(usbDevices(db, usb, windows).every((d) => d.allowed)).toBe(true); // a PC never asks
  });

  it('looks at the PC at most every 15 seconds unless asked to refresh', async () => {
    await get('/v1/printers/usb-devices');
    await get('/v1/printers/usb-devices');
    expect(scans).toBe(1);
    await get('/v1/printers/usb-devices?refresh=1');
    expect(scans).toBe(2);
  });

  it('only someone who may set printers up can look', async () => {
    for (const url of ['/v1/printers/usb-devices', '/v1/printers/windows', '/v1/printers/serial-ports', '/v1/printers/network-scan']) {
      expect((await get(url, cashier)).statusCode, url).toBe(403);
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(401);
    }
  });
});
