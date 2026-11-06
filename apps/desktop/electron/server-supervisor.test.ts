import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { lanAddresses, parseLogLine, ServerSupervisor } from './server-supervisor.js';

// The DinePOS Server window's supervisor: starts the server, reads its state, restarts it when it stops by itself,
// stops it on request, and does not start a second one when a server already answers on the port.
const freePort = () =>
  new Promise<number>((r) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => r(p));
    });
  });

/** A stand-in outlet server: answers the API the window reads; `/crash` makes it exit. */
const FAKE = `
const http = require('http');
const port = Number(process.env.DINEPOS_PORT);
http.createServer((req, res) => {
  if (req.url === '/crash') { console.error('boom: something failed'); process.exit(3); }
  const body = { '/v1/health': { ok: true, version: '9.9.9', businessDate: '2026-11-07', uptimeSec: 5 }, '/v1/devices': { devices: [{ id: 'd1', name: 'Captain 1', kind: 'captain', lastSeenAt: new Date().toISOString() }], pending: [1] }, '/v1/printers': { printers: [{ id: 'p1', name: 'Kitchen', status: 'ok' }] }, '/v1/cloud': { enabled: false, paired: false, connection: 'off', deviceUrl: null } }[req.url];
  res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body ?? {}));
}).listen(port, '127.0.0.1', () => console.log(JSON.stringify({ level: 30, time: Date.now(), msg: 'DinePOS server ready' })));
`;

let sup: ServerSupervisor | null = null;
afterEach(async () => {
  await sup?.stop();
  sup = null;
});

const make = (port: number) =>
  (sup = new ServerSupervisor({ command: { node: process.execPath, args: ['-e', FAKE], cwd: process.cwd(), env: { ...process.env, DINEPOS_PORT: String(port) }, port, dataDir: 'C:\\ProgramData\\DinePOS' }, restartMs: [200] }));
const until = async (fn: () => boolean, ms = 25_000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
};

describe('DinePOS Server supervisor', () => {
  it('starts the server, reads its state, keeps its log', async () => {
    const port = await freePort();
    const s = make(port);
    await s.start();
    await until(() => s.log().some((l) => l.text === 'DinePOS server ready'));
    for (let i = 0; i < 40 && s.snapshot().phase !== 'running'; i++) {
      await s.poll();
      await new Promise((r) => setTimeout(r, 100));
    }
    const snap = s.snapshot();
    expect(snap).toMatchObject({ phase: 'running', port, pendingPairings: 1, devices: [{ name: 'Captain 1' }], printers: [{ name: 'Kitchen', status: 'ok' }] });
    expect(snap.health).toMatchObject({ businessDate: '2026-11-07', version: '9.9.9' });
    expect(snap.pid).toBeGreaterThan(0);
  });

  it('a server that stops by itself is started again; Stop stops it for good', { timeout: 30_000 }, async () => {
    const port = await freePort();
    const s = make(port);
    await s.start();
    await until(() => s.log().some((l) => l.text === 'DinePOS server ready'));
    await fetch(`http://127.0.0.1:${port}/crash`).catch(() => undefined);
    await until(() => s.snapshot().restarts === 1);
    expect(s.log().some((l) => l.level === 'error' && /stopped \(exit code 3\)/.test(l.text))).toBe(true);
    expect(s.log().some((l) => l.level === 'error' && /boom/.test(l.text))).toBe(true);
    await until(() => s.log().filter((l) => l.text === 'DinePOS server ready').length === 2);
    for (let i = 0; i < 40 && s.snapshot().phase !== 'running'; i++) {
      await s.poll();
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(s.snapshot().phase).toBe('running');
    await s.stop();
    expect(s.snapshot().phase).toBe('stopped');
    await new Promise((r) => setTimeout(r, 400));
    expect(s.snapshot().pid).toBeNull(); // not restarted
  });

  it('a server already running on the port (started elsewhere) is shown, not started twice', async () => {
    const port = await freePort();
    const other = http.createServer((_q, r) => r.end('{}')).listen(port, '127.0.0.1');
    try {
      const s = make(port);
      await s.start();
      expect(s.snapshot()).toMatchObject({ phase: 'external', pid: null });
      expect(s.log()[0]!.text).toMatch(/already running/);
    } finally {
      other.close();
    }
  });

  it('log lines: the server’s JSON log by level; plain text kept', () => {
    expect(parseLogLine(JSON.stringify({ level: 50, time: 0, msg: 'print job failed', err: { message: 'refused' } }))).toMatchObject({ level: 'error', text: 'print job failed: refused' });
    expect(parseLogLine(JSON.stringify({ level: 40, msg: 'printer not responding' }))?.level).toBe('warn');
    expect(parseLogLine('  DinePOS server 0.1.0 on http://0.0.0.0:7420')).toMatchObject({ level: 'info' });
    expect(parseLogLine('   ')).toBeNull();
    expect(parseLogLine(JSON.stringify({ level: 30, msg: 'incoming request' }))).toBeNull();
    expect(parseLogLine(JSON.stringify({ level: 30, msg: 'request completed', res: { statusCode: 200 } }))).toBeNull();
    expect(parseLogLine(JSON.stringify({ level: 30, msg: 'request completed', res: { statusCode: 500 } }))).not.toBeNull();
    expect(parseLogLine('  Close it (or press Ctrl+C) to stop the server safely.')).toBeNull();
    expect(lanAddresses({ eth: [{ address: '192.168.1.20', family: 'IPv4', internal: false } as never, { address: '127.0.0.1', family: 'IPv4', internal: true } as never, { address: '169.254.1.1', family: 'IPv4', internal: false } as never] })).toEqual(['192.168.1.20']);
  });
});
