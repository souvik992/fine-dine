import { readFileSync } from 'node:fs';

/** Set by scripts/bundle.mjs (esbuild `define`) for the packaged server, which has no package.json beside it. */
declare const __DINEPOS_VERSION__: string | undefined;

function readVersion(): string {
  if (typeof __DINEPOS_VERSION__ === 'string') return __DINEPOS_VERSION__;
  // Resolves from both src/ (tsx) and dist/ (tsc build), which sit side by side under apps/server.
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

export const SERVER_VERSION: string = readVersion();
