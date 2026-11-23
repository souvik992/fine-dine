// DinePOS for Android: printers through the app's bridge (a fake bridge here speaks the app's protocol).
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { AndroidTransport, bridgeAddress, fromBridgeAddress, listAndroidPrinters } from './android.js';

const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789';
const servers: net.Server[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

/** A bridge that answers like PrinterBridge.java and records what it received. */
async function fakeBridge(answer: (req: Record<string, unknown>) => Record<string, unknown>) {
  const got: Array<{ req: Record<string, unknown>; bytes: Buffer }> = [];
  const server = net.createServer((s) => {
    let buf = Buffer.alloc(0);
    s.on('data', (c: Buffer) => {
      buf = Buffer.concat([buf, c]);
      const nl = buf.indexOf(10);
      if (nl < 0) return;
      const req = JSON.parse(buf.subarray(0, nl).toString('utf8')) as Record<string, unknown>;
      const body = buf.subarray(nl + 1);
      if (body.length < Number(req.length ?? 0)) return;
      got.push({ req, bytes: body });
      s.end(JSON.stringify(req.token === TOKEN ? answer(req) : { ok: false, error: 'Not allowed.' }) + '\n');
    });
  });
  servers.push(server);
  const port = await new Promise<number>((r) => server.listen(0, '127.0.0.1', () => r((server.address() as net.AddressInfo).port)));
  return { env: { DINEPOS_ANDROID_BRIDGE: `${port}:${TOKEN}` }, got };
}

describe('Android printers (DinePOS for Android)', () => {
  it("maps DinePOS's printer addresses to the app's and back", () => {
    expect(bridgeAddress('usbdirect', '04B8:0E15')).toBe('usb:04b8:0e15');
    expect(bridgeAddress('usbdirect', '0416:5011:ab12')).toBe('usb:0416:5011:ab12');
    expect(bridgeAddress('serial', '00:11:22:aa:bb:cc')).toBe('bt:00:11:22:AA:BB:CC');
    expect(bridgeAddress('serial', 'COM5')).toBeNull(); // a Windows COM port is not an Android printer
    expect(bridgeAddress('tcp', '1.2.3.4')).toBeNull();
    expect(fromBridgeAddress('usb:04b8:0e15')).toEqual({ transport: 'usbdirect', device: '04B8:0E15' });
    expect(fromBridgeAddress('bt:00:11:22:AA:BB:CC')).toEqual({ transport: 'serial', device: '00:11:22:AA:BB:CC' });
    expect(fromBridgeAddress('ble:1234')).toBeNull();
  });

  it('lists the USB and Bluetooth printers the app sees (the built-in one marked); nothing outside the app', async () => {
    const b = await fakeBridge(() => ({
      ok: true,
      printers: [
        { address: 'bt:00:11:22:AA:BB:CC', name: 'Built-in printer', detail: 'Bluetooth', builtin: true },
        { address: 'usb:0416:5011', name: 'POS-80', detail: 'USB', allowed: true },
        { address: 'usb:28e9:0289', name: 'Type-C printer', detail: 'USB', allowed: false },
        { address: 'nonsense', name: 'x' },
      ],
    }));
    expect(await listAndroidPrinters(b.env)).toEqual([
      { transport: 'serial', device: '00:11:22:AA:BB:CC', name: 'Built-in printer', detail: 'Bluetooth', builtin: true, allowed: true },
      { transport: 'usbdirect', device: '0416:5011', name: 'POS-80', detail: 'USB', builtin: false, allowed: true },
      { transport: 'usbdirect', device: '28E9:0289', name: 'Type-C printer', detail: 'USB', builtin: false, allowed: false }, // not allowed yet: tap OK
    ]);
    expect(await listAndroidPrinters({})).toEqual([]);
  });

  it('prints the exact bytes through the app with its token; the app\'s refusal is the error', async () => {
    const b = await fakeBridge((req) => (req.address === 'bt:00:11:22:AA:BB:CC' ? { ok: true } : { ok: false, error: 'Printer is off.' }));
    const t = new AndroidTransport(b.env);
    const bytes = Uint8Array.from([0x1b, 0x40, 0x41, 0x0a]);
    await t.send({ jobId: 'j', bytes, printer: { id: 'p', name: 'Counter', transport: 'serial', device: '00:11:22:aa:bb:cc', profile: 'slow_buffer' } });
    expect(b.got[0]!.req).toMatchObject({ op: 'print', address: 'bt:00:11:22:AA:BB:CC', slow: true, length: 4 });
    expect([...b.got[0]!.bytes]).toEqual([...bytes]);
    await expect(t.send({ jobId: 'k', bytes, printer: { id: 'q', name: 'Kitchen', transport: 'usbdirect', device: '0416:5011' } })).rejects.toThrow('Printer is off.');
    await expect(new AndroidTransport({}).send({ jobId: 'l', bytes, printer: { id: 'q', name: 'Kitchen', transport: 'usbdirect', device: '0416:5011' } })).rejects.toThrow(/only from the DinePOS app/);
  });
});
