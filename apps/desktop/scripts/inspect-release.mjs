// Checks a built release folder: the app archive holds only bundled code, and resources/server has everything the
// Windows service needs. Exits non-zero with the problems listed. Run after `npm run dist`.
import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const release = fileURLToPath(new URL('../release/win-unpacked/', import.meta.url));
const { listPackage } = createRequire(import.meta.url)('@electron/asar');

const problems = [];
const entries = listPackage(`${release}resources/app.asar`).map((p) => p.replace(/\\/g, '/'));
if (entries.some((p) => p.startsWith('/node_modules'))) problems.push('app.asar contains node_modules');
for (const need of ['/package.json', '/dist-electron/main.js', '/dist-renderer/index.html']) {
  if (!entries.includes(need)) problems.push(`app.asar is missing ${need}`);
}

const server = `${release}resources/server/`;
for (const need of [
  'node.exe',
  'server.mjs',
  'package.json',
  'DinePOS-Server.exe',
  'DinePOS-Server.xml',
  'migrations/0001_init.sql',
  'node_modules/better-sqlite3/package.json',
  'node_modules/better-sqlite3/lib/index.js',
  'node_modules/better-sqlite3/prebuilds/win32-x64.node',
]) {
  if (!existsSync(`${server}${need}`)) problems.push(`resources/server is missing ${need}`);
}

const mb = (f) => (statSync(f).size / 1_048_576).toFixed(1);
console.warn(`app.asar: ${entries.length} entries, ${mb(`${release}resources/app.asar`)} MB`);
if (problems.length) {
  console.error(problems.map((p) => `PROBLEM: ${p}`).join('\n'));
  process.exit(1);
}
console.warn('release contents OK');
