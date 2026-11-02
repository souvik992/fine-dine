// Packages the outlet server for the Windows installer: one ESM file plus the files it needs at runtime.
//
//   dist-bundle/
//     server.mjs                         all server + workspace code (esbuild)
//     migrations/NNNN_*.sql              read at startup next to server.mjs
//     node_modules/better-sqlite3/       native SQLite binding (Node-API prebuild, any Node >= 18)
//     package.json                       { "type": "module" }
//
// The installer adds node.exe (pinned Node runtime) and the service wrapper beside these.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const repo = fileURLToPath(new URL('../../..', import.meta.url));
const out = `${root}dist-bundle/`;
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
  sourcemap: 'linked',
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

// better-sqlite3: only what runs (no sources, no build tooling), Windows x64 prebuild.
const sqlite = `${repo}node_modules/better-sqlite3/`;
const sqliteOut = `${out}node_modules/better-sqlite3/`;
cpSync(`${sqlite}lib`, `${sqliteOut}lib`, { recursive: true });
mkdirSync(`${sqliteOut}prebuilds`, { recursive: true });
cpSync(`${sqlite}prebuilds/win32-x64.node`, `${sqliteOut}prebuilds/win32-x64.node`);
cpSync(`${sqlite}LICENSE`, `${sqliteOut}LICENSE`);
const sqlitePkg = JSON.parse(readFileSync(`${sqlite}package.json`, 'utf8'));
writeFileSync(`${sqliteOut}package.json`, JSON.stringify({ name: sqlitePkg.name, version: sqlitePkg.version, main: sqlitePkg.main, license: sqlitePkg.license }, null, 2));

writeFileSync(`${out}package.json`, JSON.stringify({ name: '@dinepos/server-bundle', version: pkg.version, private: true, type: 'module' }, null, 2));
console.warn(`server bundle ${pkg.version} -> ${out}`);
