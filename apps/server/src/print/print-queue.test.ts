import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FakeTransport, TcpTransport, type PrintRequest, type Transport } from '@dinepos/printing';
import { newId } from '@dinepos/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventBus, type PublishedEvent } from '../core/events.js';
import { getPrinters } from '../queries/printers.js';
import { useHarness } from '../testing/command-harness.js';
import { line, orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';
import { PrintQueue, REROUTE_MARK } from './print-queue.js';

/** A port with nothing listening (connections are refused). */
async function closedPort(): Promise<number> {
  const srv = net.createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address() as net.AddressInfo;
  await new Promise<void>((r) => srv.close(() => r()));
  return port;
}

/** A fake ESC/POS printer on TCP that records what it receives. */
async function tcpPrinter(): Promise<{ port: number; received: Buffer[]; close: () => Promise<void> }> {
  const received: Buffer[] = [];
  const srv = net.createServer((sock) => {
    const chunks: Buffer[] = [];
    sock.on('data', (d: Buffer) => chunks.push(d));
    sock.on('end', () => {
      received.push(Buffer.concat(chunks));
      sock.end();
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return { port: (srv.address() as net.AddressInfo).port, received, close: () => new Promise<void>((r) => srv.close(() => r())) };
}

class FlakyTransport implements Transport {
  calls: string[] = [];
  constructor(private failures: number) {}
  send(req: PrintRequest): Promise<void> {
    this.calls.push(req.jobId);
    if (this.failures-- > 0) return Promise.reject(new Error('paper jam'));
    return Promise.resolve();
  }
}

describe('PrintQueue', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  let dir: string;
  let bus: EventBus;
  let events: PublishedEvent[];
  let queue: PrintQueue | undefined;

  beforeEach(() => {
    seedOutlet(h);
    dir = mkdtempSync(path.join(tmpdir(), 'dinepos-prints-'));
    bus = new EventBus();
    events = [];
    bus.subscribe((e) => events.push(e));
  });
  afterEach(async () => {
    await queue?.stop();
    queue = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  const makeQueue = (transports: Partial<Record<'fake' | 'tcp' | 'usb', Transport>>, backoffMs = [5, 5, 5]) =>
    (queue = new PrintQueue({
      db: h.db,
      bus,
      timeZone: 'Asia/Kolkata',
      backoffMs,
      transports: { fake: new FakeTransport(dir), tcp: new TcpTransport({ timeoutMs: 2_000, settleMs: 50 }), usb: new FlakyTransport(0), ...transports },
    }));

  function fireOrder(): void {
    const orderId = o.open(S.t1, 2).order!.id;
    o.run('AddItems', orderId, { items: [line(S.dalMakhani, { qty: 2, note: 'no cream' })] });
    o.run('FireKOT', orderId, { all: true });
  }

  const jobs = () => h.db.prepare('SELECT id, printer_id, state, attempts, last_error, preview_text FROM print_job ORDER BY rowid').all() as Array<{
    id: string;
    printer_id: string;
    state: string;
    attempts: number;
    last_error: string | null;
    preview_text: string;
  }>;

  // P1-07 acceptance 1
  it('fake printer writes the text preview to data/prints/<printer>/<job>.txt', async () => {
    fireOrder();
    makeQueue({}).start();
    await queue!.idle();
    const [job] = jobs();
    expect(job).toMatchObject({ printer_id: S.kitchenPrinter, state: 'done', attempts: 1, last_error: null });
    const file = readFileSync(path.join(dir, S.kitchenPrinter, `${job!.id}.txt`), 'utf8');
    expect(file).toBe(job!.preview_text);
    expect(file).toMatchInlineSnapshot(`
      "KOT 0001
      Station: Kitchen                         DINE-IN
      Table T1 (Main Hall)                    Covers 2
                                       13:30  02-11-26
      ------------------------------------------------
      2  Dal Makhani
           ! no cream
      ------------------------------------------------
      "
    `);
  });

  // P1-07 acceptance 2
  it('a failed TCP job retries 3 times, then fails and emits print.status', async () => {
    const port = await closedPort();
    h.run('UpsertPrinter', { id: S.kitchenPrinter, name: 'Kitchen printer', transport: 'tcp', host: '127.0.0.1', port });
    fireOrder();
    makeQueue({}).start();
    await queue!.idle();

    const [job] = jobs();
    expect(job).toMatchObject({ state: 'failed', attempts: 4 }); // first try + 3 retries
    expect(job!.last_error).toMatch(/refused the connection/);
    const statuses = events.filter((e) => e.event === 'print.status').map((e) => e.data as { status: string; printerId: string });
    expect(statuses.map((s) => s.status)).toEqual(['retrying', 'offline']);
    expect(statuses[1]!.printerId).toBe(S.kitchenPrinter);
    expect(h.count('event_log', "event = 'print.status'")).toBe(2);
    expect(getPrinters(h.db).find((p) => p.id === S.kitchenPrinter)).toMatchObject({ status: 'offline', queued: 0, failedToday: 1 });
  });

  it('prints to a real TCP socket, sending every byte', async () => {
    const printer = await tcpPrinter();
    try {
      h.run('UpsertPrinter', { id: S.kitchenPrinter, name: 'Kitchen printer', transport: 'tcp', host: '127.0.0.1', port: printer.port, copies: 2 });
      fireOrder();
      makeQueue({}).start();
      await queue!.idle();
      expect(jobs()[0]!.state).toBe('done');
      const bytes = h.db.prepare('SELECT bytes FROM print_job').pluck().get() as Buffer;
      expect(printer.received).toHaveLength(1);
      expect(printer.received[0]!.equals(Buffer.concat([bytes, bytes]))).toBe(true); // 2 copies
    } finally {
      await printer.close();
    }
  });

  it('reroutes a failed job to the backup printer with a header, once', async () => {
    const port = await closedPort();
    h.run('UpsertPrinter', { id: S.tandoorPrinter, name: 'Tandoor printer', transport: 'fake' });
    h.run('UpsertPrinter', { id: S.kitchenPrinter, name: 'Kitchen printer', transport: 'tcp', host: '127.0.0.1', port, backupPrinterId: S.tandoorPrinter });
    fireOrder();
    makeQueue({}).start();
    await queue!.idle();

    const all = jobs();
    expect(all.map((j) => [j.printer_id, j.state])).toEqual([
      [S.kitchenPrinter, 'failed'],
      [S.tandoorPrinter, 'done'],
    ]);
    expect(all[1]!.preview_text.trimStart().startsWith(`${REROUTE_MARK} Kitchen printer **`)).toBe(true);
    expect(readdirSync(path.join(dir, S.tandoorPrinter))).toHaveLength(1);
    expect(h.count('audit_event', "action = 'print.reroute'")).toBe(1);
  });

  it('never reroutes a rerouted ticket again (no ping-pong between two dead printers)', async () => {
    const port = await closedPort();
    h.run('UpsertPrinter', { id: S.tandoorPrinter, name: 'Tandoor printer', transport: 'tcp', host: '127.0.0.1', port });
    h.run('UpsertPrinter', { id: S.kitchenPrinter, name: 'Kitchen printer', transport: 'tcp', host: '127.0.0.1', port, backupPrinterId: S.tandoorPrinter });
    // UpsertPrinter refuses mutual backups; force one to prove the queue still stops.
    h.db.prepare('UPDATE printer SET backup_printer_id = ? WHERE id = ?').run(S.kitchenPrinter, S.tandoorPrinter);
    fireOrder();
    makeQueue({}).start();
    await queue!.idle();
    expect(jobs().map((j) => [j.printer_id, j.state])).toEqual([
      [S.kitchenPrinter, 'failed'],
      [S.tandoorPrinter, 'failed'],
    ]);
  });

  it('keeps strict order per printer: a retrying job holds back the next one', async () => {
    fireOrder();
    const second = o.open(S.t2).order!.id;
    o.run('AddItems', second, { items: [line(S.dalMakhani)] });
    o.run('FireKOT', second, { all: true });
    const flaky = new FlakyTransport(2);
    makeQueue({ fake: flaky }).start();
    await queue!.idle();
    const [first, next] = jobs();
    expect(flaky.calls).toEqual([first!.id, first!.id, first!.id, next!.id]);
    expect(jobs().map((j) => j.state)).toEqual(['done', 'done']);
    expect(events.filter((e) => e.event === 'print.status').map((e) => (e.data as { status: string }).status)).toEqual(['retrying', 'ok']);
  });

  it('resumes queued and retrying jobs on start (after a restart)', async () => {
    fireOrder();
    h.db.prepare(`UPDATE print_job SET state = 'retry', attempts = 2`).run();
    makeQueue({}).start();
    await queue!.idle();
    expect(jobs()[0]).toMatchObject({ state: 'done', attempts: 3 });
  });

  it('wake() picks up jobs written after start', async () => {
    makeQueue({}).start();
    fireOrder();
    queue!.wake([S.kitchenPrinter]);
    await queue!.idle();
    expect(jobs()[0]!.state).toBe('done');
  });

  it('stop() waits for the ticket being sent and starts no more', async () => {
    let release!: () => void;
    const slow: Transport = { send: () => new Promise<void>((r) => (release = r)) };
    fireOrder();
    makeQueue({ fake: slow }).start();
    const stopping = queue!.stop();
    let stopped = false;
    void stopping.then(() => (stopped = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(jobs()[0]!.state).toBe('done');
  });

  it('a removed printer fails its jobs instead of blocking', async () => {
    const id = newId();
    h.db.prepare(`INSERT INTO printer (id, name, transport) VALUES (?, 'Gone', 'fake')`).run(id);
    h.db.prepare(`INSERT INTO print_job (id, printer_id, doc_kind, bytes, state, created_at) VALUES (?, ?, 'test', x'1b40', 'queued', 'x')`).run(newId(), id);
    const q = makeQueue({});
    q.printer = () => undefined;
    q.start();
    await q.idle();
    expect(jobs()[0]).toMatchObject({ state: 'failed', last_error: 'The printer was removed.' });
  });
});
