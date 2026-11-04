// Builds the DinePOS Kitchen installer: main process → staged app (no node_modules) → electron-builder (NSIS).
// Output: apps/kitchen/release/DinePOS-Kitchen-Setup-<version>.exe
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('..', import.meta.url));
execFileSync(process.execPath, [`${here}scripts/build.mjs`], { stdio: 'inherit' });

const pkg = JSON.parse(readFileSync(`${here}package.json`, 'utf8'));
const stage = `${here}.stage/`;
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(`${here}dist-electron`, `${stage}dist-electron`, { recursive: true });
cpSync(`${here}setup`, `${stage}setup`, { recursive: true });
writeFileSync(
  `${stage}package.json`,
  JSON.stringify({ name: 'dinepos-kitchen', productName: 'DinePOS Kitchen', version: pkg.version, description: 'DinePOS kitchen display', author: 'DinePOS', type: 'module', main: pkg.main }, null, 2),
);

const { build } = createRequire(import.meta.url)('electron-builder');
const config = createRequire(import.meta.url)(`${here}electron-builder.config.cjs`);
await build({ projectDir: here, config, win: ['nsis'], publish: 'never' });
console.warn(`installer written to ${here}release`);
