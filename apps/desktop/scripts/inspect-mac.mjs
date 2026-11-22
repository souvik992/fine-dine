// Checks a built Mac app (on a Mac, after `npm run dist:mac`): the outlet server, its Node runtime for this processor
// and the SQLite library are inside DinePOS.app, and that server really starts from there and answers /v1/health
// with a fresh database (production settings, a temporary data folder). Exits non-zero on any problem.
//   node scripts/inspect-mac.mjs [path/to/DinePOS.app]
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('..', import.meta.url));
const arch = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
const appDir = process.argv[2] ?? path.join(here, 'release', arch, 'DinePOS.app');
const problems = [];
const need = (rel) => {
  const p = path.join(appDir, rel);
  if (!existsSync(p)) problems.push(`missing ${rel}`);
  return p;
};

const server = path.join(appDir, 'Contents', 'Resources', 'server');
const node = need('Contents/Resources/server/node');
need('Contents/Resources/server/server.mjs');
need(`Contents/Resources/server/node_modules/better-sqlite3/prebuilds/darwin-${process.arch}.node`);
need('Contents/MacOS/DinePOS');
if (existsSync(node) && (statSync(node).mode & 0o111) === 0) problems.push('server/node is not executable');
if (existsSync(path.join(server, 'node.exe'))) problems.push('the Windows node.exe is in the Mac app');
if (problems.length) {
  console.error(`✖ ${appDir}\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

// start the packed server as the DinePOS Server window would (production, its own data folder)
const dataDir = mkdtempSync(path.join(tmpdir(), 'dinepos-mac-'));
const port = 7499;
const child = spawn(node, [path.join(server, 'server.mjs')], {
  cwd: server,
  env: { ...process.env, NODE_ENV: 'production', DATA_DIR: dataDir, DINEPOS_PORT: String(port), DINEPOS_HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));
let ok = false;
for (let i = 0; i < 60 && !ok; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const r = await fetch(`http://127.0.0.1:${port}/v1/health`);
    ok = r.ok;
  } catch {
    // not up yet
  }
}
child.kill();
const db = readdirSync(dataDir).some((f) => f.endsWith('.db'));
rmSync(dataDir, { recursive: true, force: true });
if (!ok || !db) {
  console.error(`✖ the server in ${appDir} did not start (health ${ok ? 'ok' : 'no answer'}, database ${db ? 'made' : 'missing'})\n${log.slice(-3000)}`);
  process.exit(1);
}
console.warn(`✔ ${path.basename(appDir)} (${process.arch}): server, Node ${process.versions.node === undefined ? '' : ''}runtime and SQLite inside; the server starts and answers /v1/health`);
