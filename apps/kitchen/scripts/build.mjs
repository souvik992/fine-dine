// Bundles the Electron main process (electron/*.ts) to dist-electron/main.js (ESM).
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const repo = fileURLToPath(new URL('../../..', import.meta.url));
await build({
  absWorkingDir: root,
  entryPoints: ['electron/main.ts'],
  outfile: 'dist-electron/main.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['electron'],
  // P2-15: the discovery format, from source (never a stale build)
  alias: { '@dinepos/shared': `${repo}packages/shared/src/index.ts` },
  logLevel: 'warning',
});
console.warn('built apps/kitchen/dist-electron/main.js');
