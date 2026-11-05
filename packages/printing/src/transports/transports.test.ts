import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { TcpTransport } from './tcp.js';
import { parseProbe } from './usb-windows.js';
import type { PrinterTarget } from './types.js';
import { powershellPath, WindowsSpoolerTransport, type SpoolRunner } from './usb-windows.js';

const tcp = (port: number): PrinterTarget => ({ id: 'p1', name: 'Kitchen', transport: 'tcp', host: '127.0.0.1', port });
const usb: PrinterTarget = { id: 'p2', name: 'Bill', transport: 'usb', windowsName: 'POS-80' };
const bytes = new Uint8Array([0x1b, 0x40, 0x41, 0x0a]);

describe('TcpTransport', () => {
  it('resolves when a printer that keeps the socket open has received the bytes', async () => {
    let got = Buffer.alloc(0);
    const srv = net.createServer((s) => s.on('data', (d: Buffer) => (got = Buffer.concat([got, d])))); // never closes
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    try {
      await new TcpTransport({ settleMs: 30 }).send({ printer: tcp((srv.address() as net.AddressInfo).port), jobId: 'j', bytes });
      expect([...got]).toEqual([...bytes]);
    } finally {
      srv.close();
    }
  });

  it('rejects when the printer resets the connection after the data', async () => {
    const srv = net.createServer((s) => s.on('data', () => s.resetAndDestroy()));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    try {
      await expect(new TcpTransport({ settleMs: 500 }).send({ printer: tcp((srv.address() as net.AddressInfo).port), jobId: 'j', bytes })).rejects.toThrow(
        /dropped the connection/,
      );
    } finally {
      srv.close();
    }
  });

  it('rejects with a plain message when there is no host, or the connect times out', async () => {
    await expect(new TcpTransport().send({ printer: { ...tcp(9100), host: null }, jobId: 'j', bytes })).rejects.toThrow(/no network address/);
    // 192.0.2.0/24 (TEST-NET-1) is never routed.
    await expect(new TcpTransport({ timeoutMs: 100 }).send({ printer: { ...tcp(9100), host: '192.0.2.1' }, jobId: 'j', bytes })).rejects.toThrow(
      /did not answer in time|cannot be reached/,
    );
  });
});

describe('WindowsSpoolerTransport', () => {
  const ok: SpoolRunner = (r) => Promise.resolve({ code: 0, stdout: `OK ${r.bytes.length}`, stderr: '' });

  it('refuses off Windows', async () => {
    await expect(new WindowsSpoolerTransport({ platform: 'linux', run: ok }).send({ printer: usb, jobId: 'j', bytes })).rejects.toThrow(/only supported on Windows/);
  });

  it('passes the printer name and bytes to the runner, never on a command line', async () => {
    const seen: Array<{ printerName: string; bytes: number[] }> = [];
    const run: SpoolRunner = (r) => {
      seen.push({ printerName: r.printerName, bytes: [...r.bytes] });
      return ok(r);
    };
    await new WindowsSpoolerTransport({ platform: 'win32', run }).send({ printer: usb, jobId: 'j', bytes });
    expect(seen).toEqual([{ printerName: 'POS-80', bytes: [...bytes] }]);
  });

  it('turns Windows errors into plain messages', async () => {
    const fail = (stdout: string): SpoolRunner => () => Promise.resolve({ code: 0, stdout, stderr: '' });
    const send = (run: SpoolRunner) => new WindowsSpoolerTransport({ platform: 'win32', run }).send({ printer: usb, jobId: 'j', bytes });
    await expect(send(fail('ERR open 1801'))).rejects.toThrow(/was not found in Windows/);
    await expect(send(fail('OK 2'))).rejects.toThrow(/only part of the ticket/);
    await expect(send(fail('garbage'))).rejects.toThrow(/antivirus/);
    await expect(send(() => Promise.resolve({ code: null, stdout: '', stderr: '', timedOut: true }))).rejects.toThrow(/timed out/);
  });

  it('uses the System32 PowerShell, not one on PATH', () => {
    expect(powershellPath({ SystemRoot: 'C:\\Windows' })).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  });
});

describe('printer status check (no printing)', () => {
  it('TCP: answers when something listens, without sending a byte; a closed port is down', async () => {
    let got = 0;
    const srv = net.createServer((s) => s.on('data', (d: Buffer) => (got += d.length)));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as net.AddressInfo).port;
    await new TcpTransport().probe(tcp(port));
    await new Promise((r) => setTimeout(r, 50));
    expect(got).toBe(0);
    await new Promise<void>((r) => srv.close(() => r()));
    await expect(new TcpTransport().probe(tcp(port))).rejects.toThrow(/refused the connection/);
    await expect(new TcpTransport().probe({ ...tcp(port), host: '' })).rejects.toThrow(/no network address/);
  });

  it('USB: what Windows says about the queue, in plain words', () => {
    expect(parseProbe('STATE 0 3 2 0 1', 'POS-80')).toBeNull();
    expect(parseProbe('STATE 0 3 2 2 1', 'POS-80')).toBeNull(); // "no error"
    expect(parseProbe('STATE 0 3 2 0 0', 'POS-80')).toMatch(/not connected. Check its USB cable/);
    expect(parseProbe('STATE 1 3 2 0 1', 'POS-80')).toMatch(/is offline/);
    expect(parseProbe('STATE 0 7 2 0 1', 'POS-80')).toMatch(/is offline/);
    expect(parseProbe('STATE 0 3 2 4 1', 'POS-80')).toMatch(/out of paper/);
    expect(parseProbe('STATE 0 3 2 7 1', 'POS-80')).toMatch(/cover open/);
    expect(parseProbe('MISSING', 'POS-80')).toMatch(/not found in Windows/);
    expect(parseProbe('something odd', 'POS-80')).toBeNull(); // no false alarm
  });

  it('USB: the check runs only on Windows and reports through the transport', async () => {
    const answer = (stdout: string): SpoolRunner => () => Promise.resolve({ code: 0, stdout, stderr: '' });
    await new WindowsSpoolerTransport({ platform: 'win32', check: answer('STATE 0 3 2 0 1') }).probe(usb);
    await expect(new WindowsSpoolerTransport({ platform: 'win32', check: answer('STATE 0 3 2 0 0') }).probe(usb)).rejects.toThrow(/not connected/);
    await new WindowsSpoolerTransport({ platform: 'win32', check: () => Promise.resolve({ code: null, stdout: '', stderr: '', timedOut: true }) }).probe(usb); // could not check: quiet
    await new WindowsSpoolerTransport({ platform: 'linux', check: answer('MISSING') }).probe(usb);
  });
});
