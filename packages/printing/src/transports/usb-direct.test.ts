// Ported from quickPOS (printer_devices / usb tests), run with vitest.
/* eslint-disable @typescript-eslint/require-await -- fake PowerShell runners answer at once */
import assert from "node:assert/strict";
import { test } from "vitest";
import { UsbDirectTransport, idFromInterfacePath, listUsbPrinters, parseUsbAddress, probeUsbPrinter } from "./usb-direct.js";
import type { PrintRequest, PrinterTarget } from "./types.js";
import type { PsRequest, PsResult } from "./powershell.js";

const wrap = (t: { send(r: PrintRequest): Promise<void> }) => ({ send: (printer: PrinterTarget, bytes: Uint8Array) => t.send({ printer, jobId: "j", bytes }) });
const Usb = (o?: ConstructorParameters<typeof UsbDirectTransport>[0]) => wrap(new UsbDirectTransport(o));
const usbPrinter = (device: string | null = "0416:5011"): PrinterTarget => ({ id: "u1", name: "USB", transport: "usbdirect", device, profile: "generic" });
const IFACE = '{28d78fad-5a12-11d1-ae5b-0000f8031c4f}';
const WINUSB_IFACE = '{7faf946b-0043-49d8-838c-749602f33ac5}';

test('USB addresses are vendor:product with an optional serial; device paths are read the same way', () => {
  assert.deepEqual(parseUsbAddress('0416:5011'), { vid: '0416', pid: '5011', serial: null });
  assert.deepEqual(parseUsbAddress(' 04B8:0E15:Abc123 '), { vid: '04b8', pid: '0e15', serial: 'abc123' });
  for (const bad of ['', '416:5011', '0416-5011', '0416:5011:', '0416:5011:a b', 'zzzz:5011', '0416:5011;calc', '\\\\?\\usb#vid_0416']) assert.equal(parseUsbAddress(bad), null, bad);
  assert.deepEqual(idFromInterfacePath(`\\\\?\\usb#vid_0416&pid_5011#5&2c1d2e5&0&1#${IFACE}`), { vid: '0416', pid: '5011', serial: null });
  assert.deepEqual(idFromInterfacePath(`\\\\?\\USB#VID_04B8&PID_0E15#J2WF012345#${IFACE}`), { vid: '04b8', pid: '0e15', serial: 'j2wf012345' });
  assert.equal(idFromInterfacePath('\\\\?\\hid#vid_046d&pid_c52b#7&1#{x}'), null);
  // a printer on the WinUSB driver (for example after the Zadig tool) has its own interface GUID
  assert.deepEqual(idFromInterfacePath(`\\\\?\\usb#vid_0d3a&pid_0338#ppusb0#${WINUSB_IFACE}`), { vid: '0d3a', pid: '0338', serial: 'ppusb0' });
});

test('listing USB printers (driverless) parses the device scan and skips anything that is not a USB printer', async () => {
  const run = async (): Promise<PsResult> => ({ code: 0, stdout: JSON.stringify([
    { Path: `\\\\?\\usb#vid_0416&pid_5011#5&2c1d2e5&0&1#${IFACE}`, Name: 'USB Printing Support' },
    { Path: `\\\\?\\usb#vid_04b8&pid_0e15#j2wf012345#${IFACE}`, Name: 'EPSON TM-T82' },
    { Path: `\\\\?\\usb#vid_0d3a&pid_0338#ppusb0#${WINUSB_IFACE}`, Name: 'PP8800 Thermal Printer', Kind: 'winusb' },
    { Path: 'garbage', Name: 'x' },
  ]), stderr: '' });
  assert.deepEqual(await listUsbPrinters({ platform: 'win32', run }), [
    { id: '0416:5011', vid: '0416', pid: '5011', serial: null, name: 'USB Printing Support', vendor: 'Winbond (common in 58/80 mm POS printers)', driver: 'usbprint' },
    { id: '04b8:0e15:j2wf012345', vid: '04b8', pid: '0e15', serial: 'j2wf012345', name: 'EPSON TM-T82', vendor: 'Epson', driver: 'usbprint' },
    { id: '0d3a:0338:ppusb0', vid: '0d3a', pid: '0338', serial: 'ppusb0', name: 'PP8800 Thermal Printer', vendor: 'Posiflex', driver: 'winusb' },
  ]);
  assert.deepEqual(await listUsbPrinters({ platform: 'linux', run }), []);
});

test('USB transport: sends the bytes to the matching device; plain-language errors; nothing goes into the script', async () => {
  const calls: PsRequest[] = [];
  const ok = async (r: PsRequest): Promise<PsResult> => { calls.push(r); return { code: 0, stdout: `OK ${Buffer.from(r.stdin!, 'base64').length}`, stderr: '' }; };
  const payload = Uint8Array.from({ length: 2500 }, (_, i) => i % 256);
  await Usb({ platform: 'win32', run: ok }).send(usbPrinter('04B8:0E15:Abc'), payload);
  assert.deepEqual(Buffer.from(calls[0]!.stdin!, 'base64'), Buffer.from(payload));
  assert.deepEqual([calls[0]!.env!.POS_USB_VID, calls[0]!.env!.POS_USB_PID, calls[0]!.env!.POS_USB_SERIAL, calls[0]!.env!.POS_USB_MODE], ['04b8', '0e15', 'abc', 'send']);
  assert.ok(!calls[0]!.script.includes('04b8'));

  const cases: Array<[PsResult, RegExp]> = [
    [{ code: 1, stdout: 'ERR notfound', stderr: '' }, /not connected.*USB cable/],
    [{ code: 1, stdout: 'ERR open 5', stderr: '' }, /in use/],
    [{ code: 1, stdout: 'ERR open 2', stderr: '' }, /not connected/],
    [{ code: 1, stdout: 'ERR write 1167', stderr: '' }, /unplugged while printing/],
    [{ code: 1, stdout: 'ERR write 31', stderr: '' }, /stopped while printing.*31/],
    [{ code: 1, stdout: 'ERR write 121', stderr: '' }, /did not take the receipt.*paper/], // WinUSB pipe timeout
    [{ code: 1, stdout: 'ERR init 31', stderr: '' }, /could not be opened.*31/],
    [{ code: null, stdout: '', stderr: '', timedOut: true }, /did not take the receipt.*paper/],
    [{ code: 0, stdout: 'OK 1', stderr: '' }, /accepted 1 of 3 bytes/],
    [{ code: 1, stdout: '', stderr: 'compile error\r\nat line 4' }, /could not start the Windows print helper/],
  ];
  for (const [answer, re] of cases) {
    await assert.rejects(Usb({ platform: 'win32', run: async () => answer }).send(usbPrinter(), new Uint8Array(3)), (e: Error) => { assert.match(e.message, re); assert.ok(!/\r|\n/.test(e.message)); return true; });
  }
  await assert.rejects(Usb({ platform: 'win32', run: ok }).send(usbPrinter('nope'), new Uint8Array(1)), /USB printer id/);
  await assert.rejects(Usb({ platform: 'linux', run: ok }).send(usbPrinter(), new Uint8Array(1)), /only available on Windows/);
});

test('real Windows: the USB printer scan runs, and printing to a printer that is not plugged in says so', { skip: process.platform !== 'win32', timeout: 90_000 }, async () => {
  const list = await listUsbPrinters();
  assert.ok(Array.isArray(list));
  for (const p of list) assert.match(p.id, /^[0-9a-f]{4}:[0-9a-f]{4}(:[0-9a-z._-]+)?$/);
  // any plugged-in printer can be opened (the probe sends nothing, so nothing prints)
  for (const p of list) assert.deepEqual(await probeUsbPrinter(p.id).then((r) => r.ok), true, `${p.name} (${p.driver}) could not be opened`);
  await assert.rejects(Usb().send(usbPrinter('ffff:fffe'), new Uint8Array([0x1b, 0x40])), /not connected/);
});
