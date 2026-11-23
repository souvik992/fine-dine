// Prepares the DinePOS for Android project for a build (approach and Node runtime from quickPOS for Android):
//  1. Node 24 for Android (Termux's nodejs-lts and its libraries, pinned with SHA-256 in node-runtime.json), renamed to
//     lib*.so in app/src/main/jniLibs/<abi>/ (the only place Android lets an app run programs from).
//  2. The DinePOS server for Android (apps/server: `npm run bundle:android`, node:sqlite, with the /pos, /captain and
//     /kds screens) into app/src/main/assets/dinepos/, with a fingerprint so the app unpacks it once per version.
//   node scripts/prepare.mjs [--abi=arm64-v8a,armeabi-v7a] [--no-bundle]
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apkName, readElf, renameLib } from './elf.mjs';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(HERE, '..', '..');
const CACHE = path.join(HERE, '.cache');
const APP = path.join(HERE, 'app', 'src', 'main');
const SYSTEM = new Set(['libc.so', 'libm.so', 'libdl.so', 'liblog.so', 'libandroid.so']);
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/** The data.tar.* member of a .deb (an "ar" archive). */
function debData(deb) {
  if (deb.toString('latin1', 0, 8) !== '!<arch>\n') throw new Error('not a .deb file');
  for (let o = 8; o < deb.length; ) {
    const name = deb.toString('latin1', o, o + 16).trim().replace(/\/$/, '');
    const size = Number(deb.toString('latin1', o + 48, o + 58).trim());
    if (name.startsWith('data.tar')) return { name, body: deb.subarray(o + 60, o + 60 + size) };
    o += 60 + size + (size % 2);
  }
  throw new Error('no data in the .deb');
}

async function runtime(abi, pkgs, repo) {
  const dir = path.join(CACHE, abi);
  const root = path.join(dir, 'root');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  for (const p of pkgs) {
    const file = path.join(dir, path.basename(p.filename).replace(/:/g, '_'));
    if (!existsSync(file) || sha256(readFileSync(file)) !== p.sha256) {
      const r = await fetch(`${repo}/${p.filename}`);
      if (!r.ok) throw new Error(`${p.name}: HTTP ${r.status}`);
      writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    }
    const deb = readFileSync(file);
    if (sha256(deb) !== p.sha256) throw new Error(`${p.name} ${p.version}: checksum does not match node-runtime.json; not used`);
    const data = debData(deb);
    const tarFile = path.join(dir, `${p.name}.${data.name}`);
    writeFileSync(tarFile, data.body);
    // relative paths from inside the folder: Git's tar on Windows reads "C:\..." as a remote host
    try {
      execFileSync('tar', ['-xf', path.basename(tarFile), '-C', 'root'], { cwd: dir, stdio: 'ignore' });
    } catch {
      // symbolic links cannot be made on Windows; only real files are needed
    }
  }
  const usr = path.join(root, 'data', 'data', 'com.termux', 'files', 'usr');
  const libs = readdirSync(path.join(usr, 'lib'));
  const out = path.join(APP, 'jniLibs', abi);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  // follow the needed libraries from node, renaming each to lib*.so
  const fileFor = (need) => libs.find((f) => f === need) ?? libs.filter((f) => f.startsWith(`${need}.`)).sort((a, z) => z.length - a.length)[0];
  const queue = [[path.join(usr, 'bin', 'node'), 'libdineposnode.so']];
  const done = new Set();
  while (queue.length) {
    const [src, dst] = queue.shift();
    if (done.has(dst)) continue;
    done.add(dst);
    const info = readElf(src);
    const buf = Buffer.from(readFileSync(src));
    for (const need of info.needed) {
      if (SYSTEM.has(need)) continue;
      const f = fileFor(need);
      if (!f) throw new Error(`${path.basename(src)} needs ${need}, which is not in the Termux packages`);
      renameLib(buf, need, apkName(need));
      queue.push([path.join(usr, 'lib', f), apkName(need)]);
    }
    if (info.soname) renameLib(buf, info.soname, apkName(info.soname));
    writeFileSync(path.join(out, dst), buf);
  }
  console.warn(`  ${abi}: ${[...done].join(', ')}`);
}

function assets(bundle) {
  const server = path.join(REPO, 'apps', 'server', 'dist-android');
  if (bundle) execSync('npm run bundle:android -w @dinepos/server', { cwd: REPO, stdio: 'inherit' });
  if (!existsSync(path.join(server, 'server.mjs'))) throw new Error('No Android server bundle: npm run bundle:android -w @dinepos/server');
  const dest = path.join(APP, 'assets', 'dinepos');
  rmSync(dest, { recursive: true, force: true });
  cpSync(server, path.join(dest, 'server'), { recursive: true });
  // a fingerprint of everything, so the app unpacks the files again only when they changed
  const h = createHash('sha256');
  const walk = (d) => {
    for (const f of readdirSync(d, { withFileTypes: true }).sort((a, z) => a.name.localeCompare(z.name))) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else {
        h.update(p.slice(dest.length).replace(/\\/g, '/'));
        h.update(readFileSync(p));
      }
    }
  };
  walk(dest);
  writeFileSync(path.join(dest, 'fingerprint.txt'), h.digest('hex').slice(0, 16));
  console.warn(`  assets: DinePOS server + screens (${readFileSync(path.join(dest, 'fingerprint.txt'), 'utf8')})`);
}

const lock = JSON.parse(readFileSync(path.join(HERE, 'node-runtime.json'), 'utf8'));
const only = process.argv.find((a) => a.startsWith('--abi='))?.slice(6);
console.warn('Node runtime for Android:');
for (const [abi, pkgs] of Object.entries(lock.abis)) if (!only || only.split(',').includes(abi)) await runtime(abi, pkgs, lock.repo);
assets(!process.argv.includes('--no-bundle'));
