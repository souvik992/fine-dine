// Builds release/DinePOS-PrintAgent-Setup-<version>.exe (run `npm run build` first; `npm run dist` does both). Uses the
// same pinned Node runtime as the DinePOS server (apps/desktop/build-cache/node.exe, checked against nodejs.org) and
// makensis from electron-builder's cache (the first `npm run dist -w @dinepos/desktop` downloads both).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const node = path.join(root, '..', 'desktop', 'build-cache', 'node.exe');
const bundle = path.join(root, 'dist', 'agent.mjs');
if (!existsSync(bundle)) {
  console.error('Build the agent first: npm run build -w @dinepos/print-agent');
  process.exit(1);
}
if (!existsSync(node)) {
  console.error('node.exe not found: build the DinePOS installer once (npm run dist -w @dinepos/desktop), which downloads it.');
  process.exit(1);
}
const find = (dir, depth = 0) => {
  if (depth > 4 || !existsSync(dir)) return null;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === 'makensis.exe') return p;
    if (e.isDirectory()) {
      const r = find(p, depth + 1);
      if (r) return r;
    }
  }
  return null;
};
const makensis = process.env.MAKENSIS ?? find(path.join(process.env.LOCALAPPDATA ?? '', 'electron-builder', 'Cache'));
if (!makensis) {
  console.error('makensis.exe not found. Build the DinePOS installer once (npm run dist -w @dinepos/desktop), or set MAKENSIS.');
  process.exit(1);
}
const stage = path.join(root, 'release', 'stage');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
copyFileSync(node, path.join(stage, 'node.exe'));
copyFileSync(bundle, path.join(stage, 'agent.mjs'));
const outFile = path.join(root, 'release', `DinePOS-PrintAgent-Setup-${version}.exe`);
execFileSync(makensis, ['-V2', `-DVERSION=${version}`, `-DSRC=${stage}`, `-DOUTFILE=${outFile}`, path.join(root, 'installer', 'agent.nsi')], { stdio: 'inherit' });
rmSync(stage, { recursive: true, force: true });
console.warn(`Installer: ${outFile}`);
