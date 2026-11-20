// Builds the Table QR installer for a Mac: addons/dist/installers/DinePOS-TableQR-<version>-mac.pkg
// Run on a Mac after `npm run build` (or `npm run installer:mac`, which does both). Uses Apple's pkgbuild/productbuild.
// Installs the same signed package as the Windows installer, where the Mac's DinePOS Server loads add-ons from:
//   /Users/Shared/DinePOS/addons/tableqr/   (DinePOS checks the signature and every file before loading it)
// With APPLE_INSTALLER_IDENTITY ("Developer ID Installer: …" in the keychain) the .pkg is signed for Gatekeeper.
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  console.error('The Mac installer is built on a Mac (pkgbuild). On Windows use: npm run installer -w @dinepos/addon-tableqr');
  process.exit(1);
}
const pkgDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.join(pkgDir, '..', '..');
const version = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version;
const src = path.join(repo, 'addons', 'dist', 'packages', 'tableqr');
const outDir = path.join(repo, 'addons', 'dist', 'installers');
if (!existsSync(path.join(src, 'manifest.json'))) {
  console.error('Build the add-on first: npm run build -w @dinepos/addon-tableqr');
  process.exit(1);
}

const work = path.join(pkgDir, '.mac-pkg');
rmSync(work, { recursive: true, force: true });
const root = path.join(work, 'root');
const scripts = path.join(work, 'scripts');
cpSync(src, root, { recursive: true });
cpSync(path.join(pkgDir, 'installer', 'mac-scripts'), scripts, { recursive: true });
for (const s of ['preinstall', 'postinstall']) chmodSync(path.join(scripts, s), 0o755);

const component = path.join(work, 'tableqr.pkg');
execFileSync('pkgbuild', ['--root', root, '--identifier', 'com.dinepos.addon.tableqr', '--version', version, '--install-location', '/Users/Shared/DinePOS/addons/tableqr', '--scripts', scripts, '--ownership', 'recommended', component], { stdio: 'inherit' });

// a product archive, for the welcome and finish text (the same words as the Windows installer)
const res = path.join(work, 'resources');
mkdirSync(res, { recursive: true });
writeFileSync(path.join(res, 'welcome.txt'), `Table QR for DinePOS ${version}

This adds table QR ordering to DinePOS:
- guests scan the code on their table to see the menu and order
- call a waiter, ask for the bill, see the running bill
- pay a printed bill by UPI (the cashier confirms)
- Settings > Table QR: switch on, accepting, print the codes

Run it on the master Mac (where DinePOS runs the DinePOS Server). Your bills and data are not changed.
`);
writeFileSync(path.join(res, 'conclusion.txt'), `Table QR is installed.

Quit the DinePOS Server (its menu-bar icon > Quit) and DinePOS on this Mac, and open DinePOS again. Then switch Table QR on in Settings > Table QR and print the codes.
`);
writeFileSync(path.join(work, 'distribution.xml'), `<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>DinePOS - Table QR</title>
  <welcome file="welcome.txt"/>
  <conclusion file="conclusion.txt"/>
  <options customize="never" require-scripts="false" hostArchitectures="arm64,x86_64"/>
  <domains enable_localSystem="true"/>
  <choices-outline><line choice="default"><line choice="tableqr"/></line></choices-outline>
  <choice id="default"/>
  <choice id="tableqr" visible="false"><pkg-ref id="com.dinepos.addon.tableqr"/></choice>
  <pkg-ref id="com.dinepos.addon.tableqr" version="${version}" onConclusion="none">tableqr.pkg</pkg-ref>
</installer-gui-script>
`);
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `DinePOS-TableQR-${version}-mac.pkg`);
const sign = process.env.APPLE_INSTALLER_IDENTITY ? ['--sign', process.env.APPLE_INSTALLER_IDENTITY] : [];
execFileSync('productbuild', ['--distribution', path.join(work, 'distribution.xml'), '--resources', res, '--package-path', work, ...sign, outFile], { stdio: 'inherit' });
rmSync(work, { recursive: true, force: true });
console.warn(`Installer: ${outFile}${sign.length ? '' : ' (not signed: set APPLE_INSTALLER_IDENTITY to sign it)'}`);
