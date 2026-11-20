// Checks a built release folder: the app archive holds only bundled code, and resources/server has everything the
// DinePOS Server needs. Exits non-zero with the problems listed. Run after `npm run dist` (Windows or Mac).
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const mac = process.platform === 'darwin';
const release = fileURLToPath(new URL('../release/', import.meta.url));
const resources = mac ? `${release}mac-universal/DinePOS.app/Contents/Resources/` : `${release}win-unpacked/resources/`;
const { listPackage } = createRequire(import.meta.url)('@electron/asar');

const problems = [];
const entries = listPackage(`${resources}app.asar`).map((p) => p.replace(/\\/g, '/'));
if (entries.some((p) => p.startsWith('/node_modules'))) problems.push('app.asar contains node_modules');
for (const need of ['/package.json', '/dist-electron/main.js', '/dist-electron/server-preload.cjs', '/dist-renderer/index.html', '/dist-renderer/server.html']) {
  if (!entries.includes(need)) problems.push(`app.asar is missing ${need}`);
}

const server = `${resources}server/`;
const needs = mac
  ? ['node', 'node_modules/better-sqlite3/prebuilds/darwin-arm64.node', 'node_modules/better-sqlite3/prebuilds/darwin-x64.node']
  : ['node.exe', 'stop-server.ps1', 'node_modules/better-sqlite3/prebuilds/win32-x64.node'];
for (const need of [...needs, 'server.mjs', 'package.json', 'migrations/0001_init.sql', 'node_modules/better-sqlite3/package.json', 'node_modules/better-sqlite3/lib/index.js']) {
  if (!existsSync(`${server}${need}`)) problems.push(`resources/server is missing ${need}`);
}
if (mac && existsSync(`${server}node`)) {
  // one app for every Mac: the Node runtime must hold both architectures
  const archs = execFileSync('lipo', ['-archs', `${server}node`], { encoding: 'utf8' }).trim().split(/\s+/);
  for (const a of ['arm64', 'x86_64']) if (!archs.includes(a)) problems.push(`resources/server/node has no ${a} (has: ${archs.join(' ')})`);
  // and it must run as it will in the shop (signed, hardened runtime)
  try {
    execFileSync(`${server}node`, ['-e', "require('./node_modules/better-sqlite3')(':memory:').prepare('select 1').get()"], { cwd: server, stdio: 'inherit' });
  } catch {
    problems.push('the bundled node cannot open SQLite through better-sqlite3');
  }
}

const mb = (f) => (statSync(f).size / 1_048_576).toFixed(1);
console.warn(`app.asar: ${entries.length} entries, ${mb(`${resources}app.asar`)} MB`);
if (problems.length) {
  console.error(problems.map((p) => `PROBLEM: ${p}`).join('\n'));
  process.exit(1);
}
console.warn('release contents OK');
