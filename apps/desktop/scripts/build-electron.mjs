// Bundles the Electron main process (electron/*.ts) to dist-electron/main.js (ESM).
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
await build({
  absWorkingDir: root,
  entryPoints: ['electron/main.ts'],
  outfile: 'dist-electron/main.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'warning',
});
// The DinePOS Server window's preload (a sandboxed preload must be CommonJS; only electron is required).
await build({
  absWorkingDir: root,
  entryPoints: ['electron/server-preload.ts'],
  outfile: 'dist-electron/server-preload.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  logLevel: 'warning',
});
console.warn('built dist-electron/main.js and server-preload.cjs');
