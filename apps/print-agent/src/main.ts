// DinePOS Print Agent: command line (P6-03).
//   node agent.mjs                         run (as the Windows scheduled task does)
//   node agent.mjs --setup <server> <key>  check the address and key, then save them (the installer calls this)
//   node agent.mjs --status                print the saved address and whether the server accepts the key
// Settings and log: %ProgramData%\DinePOS Print Agent\ (DINEPOS_AGENT_DIR overrides).
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FakeTransport, TcpTransport, WindowsSpoolerTransport } from '@dinepos/printing';
import { normalizeServer, PrintAgent, RefusedError } from './agent.js';

declare const __AGENT_VERSION__: string | undefined;
const VERSION = typeof __AGENT_VERSION__ === 'string' ? __AGENT_VERSION__ : 'dev';
const dir = process.env.DINEPOS_AGENT_DIR ?? path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'DinePOS Print Agent');
const configFile = path.join(dir, 'agent.json');

interface Config {
  serverUrl: string;
  key: string;
}

function log(level: string, msg: string): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${msg}\n`;
  process.stdout.write(line);
  try {
    mkdirSync(path.join(dir, 'logs'), { recursive: true });
    appendFileSync(path.join(dir, 'logs', `agent-${new Date().toISOString().slice(0, 10)}.log`), line);
  } catch {
    // logging must never stop printing
  }
}

function transports() {
  return { tcp: new TcpTransport(), usb: new WindowsSpoolerTransport(), fake: new FakeTransport(path.join(dir, 'prints')) };
}

async function setup(server: string | undefined, key: string | undefined): Promise<number> {
  const serverUrl = normalizeServer(server ?? '');
  if (!serverUrl) {
    console.error('The server address is not valid. Use the main PC’s address (e.g. 192.168.1.20) or the outlet’s DinePOS Cloud address.');
    return 1;
  }
  if (!key || key.trim().length < 20) {
    console.error('Paste the print agent key shown in DinePOS (Settings › Kitchen & printers › Add print agent).');
    return 1;
  }
  try {
    const res = await new PrintAgent({ serverUrl, key: key.trim(), version: VERSION, transports: {} }).ask(0);
    mkdirSync(dir, { recursive: true });
    writeFileSync(configFile, JSON.stringify({ serverUrl, key: key.trim() } satisfies Config, null, 2));
    process.stdout.write(`Connected to ${serverUrl} as "${res.agent.name}". Printers: ${res.printers.map((p) => p.name).join(', ') || 'none assigned yet (assign them in DinePOS)'}.\n`);
    return 0;
  } catch (e) {
    console.error(e instanceof RefusedError ? e.message : `Could not reach DinePOS at ${serverUrl}: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

function readConfig(): Config | null {
  try {
    const c = JSON.parse(readFileSync(configFile, 'utf8')) as Partial<Config>;
    return typeof c.serverUrl === 'string' && typeof c.key === 'string' ? { serverUrl: c.serverUrl, key: c.key } : null;
  } catch {
    return null;
  }
}

async function main(): Promise<number> {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === '--setup') return setup(a, b);
  const config = readConfig();
  if (!config) {
    console.error(`Not set up yet: run the installer again, or: agent --setup <server address> <agent key> (settings: ${configFile})`);
    return 2;
  }
  if (cmd === '--status') return setup(config.serverUrl, config.key);
  const agent = new PrintAgent({ serverUrl: config.serverUrl, key: config.key, version: VERSION, transports: transports(), log });
  const stop = new AbortController();
  process.on('SIGINT', () => stop.abort());
  process.on('SIGTERM', () => stop.abort());
  log('info', `DinePOS Print Agent ${VERSION} starting (server ${config.serverUrl})`);
  await agent.run(stop.signal);
  return 0;
}

void main().then((code) => {
  if (code !== 0 || process.argv[2]) process.exit(code);
});
