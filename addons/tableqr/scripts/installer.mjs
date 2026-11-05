// Builds the Table QR installer: addons/dist/installers/DinePOS-TableQR-Setup-<version>.exe
// Run `npm run build` first (or `npm run installer`, which does both). Uses makensis from electron-builder's cache
// (downloaded the first time the DinePOS installer is built: npm run dist -w @dinepos/desktop), or MAKENSIS.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.join(pkgDir, '..', '..');
const version = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version;
const src = path.join(repo, 'addons', 'dist', 'packages', 'tableqr');
const outDir = path.join(repo, 'addons', 'dist', 'installers');
if (!existsSync(path.join(src, 'manifest.json'))) {
  console.error('Build the add-on first: npm run build -w @dinepos/addon-tableqr');
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
const icon = [path.join(repo, 'apps', 'desktop', 'build', 'icon.ico')].find((p) => existsSync(p));
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `DinePOS-TableQR-Setup-${version}.exe`);
execFileSync(makensis, ['-V2', `-DVERSION=${version}`, `-DSRC=${src}`, `-DOUTFILE=${outFile}`, ...(icon ? [`-DICON=${icon}`] : []), path.join(pkgDir, 'installer', 'tableqr.nsi')], { stdio: 'inherit' });
console.warn(`Installer: ${outFile}`);
