// Builds the signed Table QR package: addons/dist/packages/tableqr/
//   backend.cjs            server code (bundled; only Node built-ins left to require)
//   ui/ui.js, ui/ui.css    terminal screens (use the terminal's React through window.__DINEPOS__)
//   web/index.html, web/app.js, web/app.css   the guest page
//   manifest.json          id, version, rights, SHA-256 of every file, Ed25519 signature
// The signing key: DINEPOS_ADDON_SIGNING_KEY, else %USERPROFILE%\.dinepos\addon-signing\private.pem. Never in the repo.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import { canonicalManifest } from './canonical.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.join(here, '..');
const repo = path.join(pkgDir, '..', '..');
const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
const meta = pkg.dinepos;
const work = path.join(pkgDir, '.build');
const out = path.join(repo, 'addons', 'dist', 'packages', meta.id);
const KEY_ID = 'dinepos-addons-2026';
const TRUSTED = 'MCowBQYDK2VwAyEAkQhyHnqHIgHhqo+ACpcY1iia+fwdbqVNO3VUvv82GwQ='; // packages/shared/src/addons.ts
const shared = path.join(repo, 'packages', 'shared', 'src', 'index.ts');

const keyFile = process.env.DINEPOS_ADDON_SIGNING_KEY ?? path.join(homedir(), '.dinepos', 'addon-signing', 'private.pem');
if (!existsSync(keyFile)) {
  console.error(`Signing key not found (${keyFile}). Set DINEPOS_ADDON_SIGNING_KEY.`);
  process.exit(1);
}

process.env.NODE_ENV = 'production'; // production JSX (jsx, not jsxDEV): the terminal's React is a production build
rmSync(work, { recursive: true, force: true });
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. server code
await esbuild({
  entryPoints: [path.join(pkgDir, 'src', 'backend.ts')],
  outfile: path.join(work, 'backend.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  alias: { '@dinepos/shared': shared },
  legalComments: 'none',
  logLevel: 'warning',
});

// 2. terminal screens: one script using the terminal's React
const hostGlobals = { react: 'window.__DINEPOS__.React', 'react/jsx-runtime': 'window.__DINEPOS__.jsxRuntime', 'react-dom': 'window.__DINEPOS__.ReactDOM' };
await viteBuild({
  configFile: false,
  mode: 'production',
  logLevel: 'warn',
  root: path.join(pkgDir, 'src', 'ui'),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@dinepos/shared': shared } },
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: path.join(work, 'ui'),
    emptyOutDir: true,
    target: 'es2022',
    minify: true,
    lib: { entry: path.join(pkgDir, 'src', 'ui', 'index.tsx'), formats: ['iife'], name: 'DinePosTableQr', fileName: () => 'ui.js', cssFileName: 'ui' },
    rollupOptions: { external: Object.keys(hostGlobals), output: { globals: hostGlobals } },
  },
});

// 3. the guest page (its own React)
await viteBuild({
  configFile: false,
  mode: 'production',
  logLevel: 'warn',
  root: path.join(pkgDir, 'src', 'web'),
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@dinepos/shared': shared } },
  build: {
    outDir: path.join(work, 'web'),
    emptyOutDir: true,
    target: 'es2020',
    minify: true,
    modulePreload: false,
    rollupOptions: { output: { entryFileNames: 'app.js', chunkFileNames: 'app-[name].js', assetFileNames: (a) => (a.names?.[0]?.endsWith('.css') || a.name?.endsWith('.css') ? 'app.css' : 'asset-[name][extname]') } },
  },
});

// 4. the package
const files = {
  'backend.cjs': path.join(work, 'backend.cjs'),
  'ui/ui.js': path.join(work, 'ui', 'ui.js'),
  'ui/ui.css': path.join(work, 'ui', 'ui.css'),
  'web/index.html': path.join(work, 'web', 'index.html'),
  'web/app.js': path.join(work, 'web', 'app.js'),
  'web/app.css': path.join(work, 'web', 'app.css'),
};
const ui = readFileSync(files['ui/ui.js'], 'utf8');
if (/\brequire\(|from"react"|from 'react'/.test(ui)) throw new Error('ui.js must use the terminal React (window.__DINEPOS__), not bundle or import its own.');
if (!ui.includes('__DINEPOS__')) throw new Error('ui.js does not use window.__DINEPOS__.');
if (ui.includes('jsxDEV')) throw new Error('ui.js was built with development JSX; the terminal runs production React.');
const html = readFileSync(files['web/index.html'], 'utf8');
if (!html.includes('app.js') || !html.includes('app.css')) throw new Error('The guest page must load app.js and app.css.');

const manifest = {
  id: meta.id,
  name: meta.name,
  version: pkg.version,
  minPosVersion: meta.minPosVersion,
  commandPrefix: meta.commandPrefix,
  description: pkg.description,
  rights: meta.rights,
  keyId: KEY_ID,
  files: {},
};
for (const [name, src] of Object.entries(files)) {
  const dest = path.join(out, ...name.split('/'));
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  manifest.files[name] = createHash('sha256').update(readFileSync(dest)).digest('hex');
}
const privateKey = createPrivateKey(readFileSync(keyFile));
manifest.signature = sign(null, Buffer.from(canonicalManifest(manifest), 'utf8'), privateKey).toString('base64');
const ok = verify(null, Buffer.from(canonicalManifest(manifest), 'utf8'), createPublicKey({ key: Buffer.from(TRUSTED, 'base64'), format: 'der', type: 'spki' }), Buffer.from(manifest.signature, 'base64'));
if (!ok) throw new Error('The signing key is not the one DinePOS trusts (ADDON_TRUST_KEYS).');
writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
rmSync(work, { recursive: true, force: true });
const size = Object.values(manifest.files).length;
console.warn(`Signed ${meta.name} ${pkg.version} (${size} files) -> ${out}`);
