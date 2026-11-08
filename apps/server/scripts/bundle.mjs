// Packages the outlet server for the Windows installer: one ESM file plus the files it needs at runtime.
//
//   dist-bundle/
//     server.mjs                         all server + workspace code (esbuild)
//     migrations/NNNN_*.sql              read at startup next to server.mjs
//     web/captain/                       the captain phone app, served at /captain (P3-01)
//     web/kds/                           the kitchen display, served at /kds (P4-02)
//     web/pos/                           the billing terminal's screens for a browser, served at /pos (P7-04)
//     demo-seed.json                     (cloud only) the browser demo's sample outlet as commands (P7-04)
//     node_modules/better-sqlite3/       native SQLite binding (Node-API prebuild, any Node >= 18)
//     package.json                       { "type": "module" }
//
// The installer adds node.exe (pinned Node runtime) and the service wrapper beside these.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const repo = fileURLToPath(new URL('../../..', import.meta.url));
// P6-04: `npm run bundle:cloud` writes the same server for DinePOS Cloud's hosted outlets (Linux) to cloud/outlet-server.
const cloud = process.argv.includes('--cloud');
const out = cloud ? `${repo}cloud/outlet-server/` : `${root}dist-bundle/`;
const platforms = cloud ? ['linux-x64', 'linux-arm64'] : ['win32-x64'];
const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: ['src/index.ts'],
  outfile: `${out}server.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: cloud ? false : 'linked',
  // Native and optional modules stay outside the bundle.
  external: ['better-sqlite3', 'bufferutil', 'utf-8-validate'],
  define: { __DINEPOS_VERSION__: JSON.stringify(pkg.version) },
  // Some CommonJS dependencies call require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __dineposRequire } from 'node:module'; const require = __dineposRequire(import.meta.url);" },
  alias: {
    '@dinepos/shared': `${repo}packages/shared/src/index.ts`,
    '@dinepos/printing': `${repo}packages/printing/src/index.ts`,
  },
  logLevel: 'warning',
});

cpSync(`${root}src/db/migrations`, `${out}migrations`, { recursive: true, filter: (p) => !p.endsWith('.ts') });

// The captain phone app (static files, served by the server at /captain).
execSync('npm run build -w @dinepos/captain', { cwd: repo, stdio: 'inherit' });
cpSync(`${repo}apps/captain/dist`, `${out}web/captain`, { recursive: true, filter: (p) => !p.endsWith('.map') });
// The kitchen display (P4-02), served at /kds.
execSync('npm run build -w @dinepos/kds', { cwd: repo, stdio: 'inherit' });
cpSync(`${repo}apps/kds/dist`, `${out}web/kds`, { recursive: true, filter: (p) => !p.endsWith('.map') });
// P7-04: the billing terminal's screens (the Electron app's renderer) for a browser, served at /pos.
execSync('npx vite build', { cwd: `${repo}apps/desktop`, stdio: 'inherit' });
cpSync(`${repo}apps/desktop/dist-renderer`, `${out}web/pos`, { recursive: true, filter: (p) => !p.endsWith('.map') && !/[\\/]server\.html$/.test(p) });
if (cloud) {
  // P7-04: DinePOS Cloud sends these to a new browser demo outlet as ordinary commands (single writer: the outlet server)
  const tmp = `${out}.demo-seed.mjs`;
  await build({ absWorkingDir: root, entryPoints: ['src/seed/demo-seed.ts'], outfile: tmp, bundle: true, platform: 'node', format: 'esm', target: 'node22', alias: { '@dinepos/shared': `${repo}packages/shared/src/index.ts` }, logLevel: 'warning' });
  const { demoSeed } = await import(pathToFileURL(tmp).href);
  writeFileSync(`${out}demo-seed.json`, JSON.stringify(demoSeed(), null, 1));
  rmSync(tmp);
}

// better-sqlite3: only what runs (no sources, no build tooling), the prebuilds for where it runs.
const sqlite = `${repo}node_modules/better-sqlite3/`;
const sqliteOut = `${out}node_modules/better-sqlite3/`;
cpSync(`${sqlite}lib`, `${sqliteOut}lib`, { recursive: true });
mkdirSync(`${sqliteOut}prebuilds`, { recursive: true });
for (const pl of platforms) cpSync(`${sqlite}prebuilds/${pl}.node`, `${sqliteOut}prebuilds/${pl}.node`);
cpSync(`${sqlite}LICENSE`, `${sqliteOut}LICENSE`);
const sqlitePkg = JSON.parse(readFileSync(`${sqlite}package.json`, 'utf8'));
writeFileSync(`${sqliteOut}package.json`, JSON.stringify({ name: sqlitePkg.name, version: sqlitePkg.version, main: sqlitePkg.main, license: sqlitePkg.license }, null, 2));

writeFileSync(`${out}package.json`, JSON.stringify({ name: '@dinepos/server-bundle', version: pkg.version, private: true, type: 'module' }, null, 2));
console.warn(`server bundle ${pkg.version} -> ${out}`);
