// Bundles the print agent to dist/agent.mjs (Node 24, ESM, everything inside: only Node built-ins at run time).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const src = (pkg) => fileURLToPath(new URL(`../../../packages/${pkg}/src/index.ts`, import.meta.url));
await build({
  absWorkingDir: root,
  entryPoints: ['src/main.ts'],
  outfile: 'dist/agent.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  alias: { '@dinepos/printing': src('printing'), '@dinepos/shared': src('shared') },
  define: { __AGENT_VERSION__: JSON.stringify(version) },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'warning',
});
console.warn(`built dist/agent.mjs (${version})`);
