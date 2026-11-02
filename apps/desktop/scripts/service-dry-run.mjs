// Runs the packaged server through WinSW `testwait` — the same executable, arguments, environment expansion and
// stop method the Windows service uses — without installing a service (no administrator rights needed).
// DATA_DIR, logs and port are redirected to a temporary folder so nothing touches %ProgramData%.
// Usage (after `npm run dist`): node scripts/service-dry-run.mjs
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = fileURLToPath(new URL('../release/win-unpacked/resources/server/', import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), 'dinepos-svc-'));
const app = path.join(work, 'server');
const data = path.join(work, 'data');
const PORT = 7443;
cpSync(serverDir, app, { recursive: true });

const xmlPath = path.join(app, 'DinePOS-Server.xml');
const xml = readFileSync(xmlPath, 'utf8')
  .replace('<env name="DATA_DIR" value="%ProgramData%\\DinePOS"/>', `<env name="DATA_DIR" value="${data}"/>`)
  .replace('<logpath>%ProgramData%\\DinePOS\\logs</logpath>', `<logpath>${path.join(data, 'logs')}</logpath>`)
  .replace('<env name="DINEPOS_PORT" value="7420"/>', `<env name="DINEPOS_PORT" value="${PORT}"/>`);
if (!xml.includes(data) || !xml.includes(String(PORT))) throw new Error('could not redirect DATA_DIR/port in the service XML');
writeFileSync(xmlPath, xml);

const svc = spawn(path.join(app, 'DinePOS-Server.exe'), ['testwait'], { cwd: app, stdio: ['pipe', 'pipe', 'pipe'] });
let out = '';
svc.stdout.on('data', (d) => (out += d));
svc.stderr.on('data', (d) => (out += d));
const exited = new Promise((r) => svc.on('exit', (code) => r(code)));

let health = null;
for (let i = 0; i < 60 && !health; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/v1/health`);
    if (res.ok) health = await res.json();
  } catch {
    // starting
  }
}
console.warn('health:', JSON.stringify(health));
svc.stdin.write('\n'); // "press a key": WinSW stops the process the way the service manager would
const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r('timeout'), 20_000))]);

const logs = existsSync(path.join(data, 'logs')) ? readdirSync(path.join(data, 'logs')) : [];
const serverLog = logs.filter((f) => f.endsWith('.out.log')).map((f) => readFileSync(path.join(data, 'logs', f), 'utf8')).join('');
const checks = {
  started: health?.ok === true,
  production: existsSync(path.join(data, 'dinepos.db')),
  stoppedCleanly: code !== 'timeout',
  gracefulShutdown: /shutting down/.test(serverLog),
  lockReleased: !existsSync(path.join(data, 'dinepos.lock')),
  logsWritten: logs.length > 0,
};
console.warn('winsw exit:', code, '| logs:', logs.join(', '));
console.warn(JSON.stringify(checks, null, 2));
rmSync(work, { recursive: true, force: true });
if (Object.values(checks).some((v) => !v)) {
  console.error(out.slice(-2000));
  process.exit(1);
}
console.warn('service dry run OK');
