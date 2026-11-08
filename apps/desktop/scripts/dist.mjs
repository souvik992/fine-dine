// Builds the Windows installer: server bundle → desktop build → verified runtime binaries → staged app →
// electron-builder (NSIS). Output: apps/desktop/release/DinePOS-Setup-<version>.exe (+ win-unpacked/).
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchRuntime } from './fetch-runtime.mjs';

const here = fileURLToPath(new URL('..', import.meta.url));
const repo = fileURLToPath(new URL('../../..', import.meta.url));
// Run npm through the current Node (npm_execpath is set by `npm run`), so no shell is involved.
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this through npm: npm run dist -w @dinepos/desktop');
const run = (args, cwd = repo) => execFileSync(process.execPath, [npmCli, ...args], { cwd, stdio: 'inherit' });

// The workspace packages (@dinepos/shared, ...) are used from their compiled dist/; a fresh checkout (CI) has none.
run(['run', 'build']);
run(['run', 'bundle', '-w', '@dinepos/server']);
run(['run', 'build', '-w', '@dinepos/desktop']);
await fetchRuntime();
// Electron's own binary (node_modules/electron/dist): electron has no install script, so a fresh `npm ci` (CI) has
// none until something runs it. Its install.js downloads it (checksum-verified) and exits at once if it is there.
execFileSync(process.execPath, [path.join(path.dirname(createRequire(import.meta.url).resolve('electron/package.json')), 'install.js')], { stdio: 'inherit' });

// Stage the app: only the bundled outputs and a dependency-free package.json.
const pkg = JSON.parse(readFileSync(`${here}package.json`, 'utf8'));
const stage = `${here}.stage/`;
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(`${here}dist-electron`, `${stage}dist-electron`, { recursive: true });
cpSync(`${here}dist-renderer`, `${stage}dist-renderer`, { recursive: true });
writeFileSync(
  `${stage}package.json`,
  JSON.stringify({ name: 'dinepos', productName: 'DinePOS', version: pkg.version, description: 'DinePOS restaurant POS', author: 'DinePOS', type: 'module', main: pkg.main }, null, 2),
);

const { build } = createRequire(import.meta.url)('electron-builder');
const config = createRequire(import.meta.url)(`${here}electron-builder.config.cjs`);
await build({ projectDir: here, config, win: ['nsis'], publish: 'never' });
console.warn(`installer written to ${here}release`);
execFileSync(process.execPath, [`${here}scripts/inspect-release.mjs`], { stdio: 'inherit' });
