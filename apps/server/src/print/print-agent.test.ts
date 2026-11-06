import { createHash, randomBytes } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FakeTransport, TcpTransport, type Transport } from '@dinepos/printing';
import { newId } from '@dinepos/shared';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type DinePosApp } from '../app.js';
import { commandRegistry } from '../commands/registry.js';
import { EventBus } from '../core/events.js';
import { executeCommand } from '../core/execute-command.js';
import { allowAllRights } from '../core/rights.js';
import { getPrinters } from '../queries/printers.js';
import { TEST_NOW, useHarness } from '../testing/command-harness.js';
import { line, orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';
import { AgentBroker } from './agent-broker.js';
import { PrintQueue } from './print-queue.js';

// P6-03 end to end: a KOT fired at the outlet is printed by the print agent (the real agent program, over HTTP) on a
// network printer only the agent can reach; failures, an agent gone offline and a removed key behave as for any printer.
const here = path.dirname(fileURLToPath(import.meta.url));
interface Agent {
  state: { connection: string; agentName: string | null; printed: number; failed: number; lastError: string | null };
  run(signal: AbortSignal): Promise<void>;
  ask(waitMs: number): Promise<unknown>;
}
type AgentCtor = new (o: { serverUrl: string; key: string; version: string; transports: Record<string, Transport>; waitMs?: number; retryMs?: number[] }) => Agent;

async function tcpPrinter() {
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

describe('print agent (P6-03)', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  let dir: string;
  let app: DinePosApp;
  let queue: PrintQueue;
  let broker: AgentBroker;
  let bus: EventBus;
  let PrintAgent: AgentCtor;
  let base = '';
  const key = `pa_${randomBytes(24).toString('base64url')}`;
  const stops: AbortController[] = [];

  beforeEach(async () => {
    PrintAgent = ((await import(pathToFileURL(path.resolve(here, '..', '..', '..', 'print-agent', 'src', 'agent.ts')).href)) as { PrintAgent: AgentCtor }).PrintAgent;
    seedOutlet(h);
    dir = mkdtempSync(path.join(tmpdir(), 'dinepos-agent-'));
    bus = new EventBus();
    broker = new AgentBroker({ offlineAfterMs: 1500, jobTimeoutMs: 5000 });
    // the server's own transports must never be used for an agent's printer
    const never: Transport = { send: () => Promise.reject(new Error('the server tried to print an agent printer itself')) };
    queue = new PrintQueue({ db: h.db, bus, timeZone: 'Asia/Kolkata', transports: { fake: new FakeTransport(dir), tcp: never, usb: never }, agents: broker, backoffMs: [50, 50] });
    app = buildApp({ db: h.db, timeZone: 'Asia/Kolkata', now: TEST_NOW, bus, printWaker: queue, printQueue: queue, agents: broker, devices: 'off' });
    await app.listen({ host: '127.0.0.1', port: 0 });
    base = `http://127.0.0.1:${(app.server.address() as net.AddressInfo).port}`;
    const agentId = newId();
    h.run('CreatePrintAgent', { id: agentId, name: 'Back office PC', keyHash: createHash('sha256').update(`agent:${key}`).digest('hex') });
    h.run('SetPrinterAgent', { printerId: S.kitchenPrinter, agentId });
  });
  afterEach(async () => {
    for (const s of stops.splice(0)) s.abort();
    await queue.stop();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const startAgent = () => {
    const agent = new PrintAgent({ serverUrl: base, key, version: 'test', transports: { tcp: new TcpTransport({ timeoutMs: 1500, settleMs: 50 }) }, waitMs: 500, retryMs: [100] });
    const stop = new AbortController();
    stops.push(stop);
    void agent.run(stop.signal);
    return { agent, stop };
  };
  const fire = () => {
    const orderId = o.open(S.t1, 2).order!.id;
    o.run('AddItems', orderId, { items: [line(S.dalMakhani)] });
    // through the app's own pipeline, so the queue is woken after the commit
    const v = h.db.prepare('SELECT version FROM "order" WHERE id = ?').pluck().get(orderId) as number;
    executeCommand({ db: h.db, registry: commandRegistry, rights: allowAllRights, bus, printWaker: queue, timeZone: 'Asia/Kolkata', now: TEST_NOW }, { commandId: newId(), type: 'FireKOT', orderId, expectedVersion: v, payload: { all: true }, createdAt: TEST_NOW().toISOString() }, { deviceId: null, userId: null });
  };
  const kitchenJob = () => h.db.prepare("SELECT state, last_error FROM print_job WHERE printer_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(S.kitchenPrinter) as { state: string; last_error: string | null };

  it('a KOT for the agent’s printer is printed by the agent on its own network printer; the job is done', async () => {
    const printer = await tcpPrinter();
    h.run('UpsertPrinter', { id: S.kitchenPrinter, name: 'Kitchen printer', transport: 'tcp', host: '127.0.0.1', port: printer.port });
    const { agent } = startAgent();
    await expect.poll(() => agent.state.connection).toBe('connected');
    expect(agent.state.agentName).toBe('Back office PC');
    fire();
    await expect.poll(() => kitchenJob().state, { timeout: 8000 }).toBe('done');
    expect(printer.received).toHaveLength(1);
    expect(printer.received[0]!.toString('latin1')).toContain('Dal Makhani');
    expect(agent.state.printed).toBe(1);
    // the Tandoor printer (no agent) is still printed by the server itself
    await expect.poll(() => h.db.prepare("SELECT state FROM print_job WHERE printer_id = ? ORDER BY rowid DESC LIMIT 1").pluck().get(S.tandoorPrinter) ?? 'none').not.toBe('queued');
    await printer.close();
  });

  it('the agent’s printer refuses: the agent says why, the queue retries and then marks it offline with that reason', async () => {
    const port = await new Promise<number>((r) => {
      const s = net.createServer();
      s.listen(0, '127.0.0.1', () => {
        const p = (s.address() as net.AddressInfo).port;
        s.close(() => r(p));
      });
    });
    h.run('UpsertPrinter', { id: S.kitchenPrinter, name: 'Kitchen printer', transport: 'tcp', host: '127.0.0.1', port });
    const { agent } = startAgent();
    await expect.poll(() => agent.state.connection).toBe('connected');
    fire();
    await expect.poll(() => kitchenJob().state, { timeout: 8000 }).toBe('failed');
    expect(kitchenJob().last_error).toMatch(/refused the connection/);
    expect(queue.status(S.kitchenPrinter)).toBe('offline');
  });

  it('an agent gone quiet makes its printers show offline before a ticket fails; a removed key is refused', async () => {
    const { agent, stop } = startAgent();
    await expect.poll(() => agent.state.connection).toBe('connected');
    stop.abort();
    await new Promise((r) => setTimeout(r, 2300)); // its last long poll (500 ms) ends, then the 1.5 s offline time
    await queue.checkPrinters();
    const p = getPrinters(h.db, (id) => queue.status(id), TEST_NOW(), (id) => queue.error(id)).find((x) => x.id === S.kitchenPrinter)!;
    expect(p).toMatchObject({ status: 'offline', agent: { name: 'Back office PC' } });
    expect(p.lastError).toMatch(/print agent "Back office PC" is offline/);
    const agentId = h.db.prepare('SELECT id FROM print_agent').pluck().get() as string;
    h.run('RevokePrintAgent', { agentId });
    await expect(new PrintAgent({ serverUrl: base, key, version: 'test', transports: {} }).ask(0)).rejects.toThrow(/not valid/);
    const list = await app.inject({ method: 'GET', url: '/v1/print-agents' });
    expect(list.json<{ agents: unknown[] }>().agents).toEqual([]);
  });
});
