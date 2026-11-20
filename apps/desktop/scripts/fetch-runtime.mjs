// Downloads the third-party runtime the installer ships, verifies it against a pinned SHA-256 hash and caches it in
// build-cache/. A changed or corrupted download stops the build.
//
//   Windows: node.exe   Node.js 24.21.0 win-x64 (the version the whole test suite runs on).
//   macOS:   node       Node.js 24.21.0 for Apple silicon and Intel, joined into one universal binary (lipo), so one
//                       DinePOS.app runs on every Mac. Hashes from nodejs.org SHASUMS256.txt.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const NODE_VERSION = '24.21.0';
export const BINARIES = [
  {
    file: 'node.exe',
    url: `https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe`,
    sha256: 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32',
  },
];
export const MAC_ARCHIVES = [
  {
    arch: 'arm64',
    url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
    sha256: 'bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057',
  },
  {
    arch: 'x64',
    url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-x64.tar.gz`,
    sha256: '1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097',
  },
];

const cacheDir = fileURLToPath(new URL('../build-cache/', import.meta.url));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function download(url, expected, name) {
  console.warn(`downloading ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} from ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== expected) throw new Error(`${name}: SHA-256 mismatch (expected ${expected}, got ${got}). Refusing to package it.`);
  return buf;
}

async function fetchWindows() {
  for (const b of BINARIES) {
    const target = `${cacheDir}${b.file}`;
    if (existsSync(target) && sha256(readFileSync(target)) === b.sha256) continue;
    const buf = await download(b.url, b.sha256, b.file);
    writeFileSync(`${target}.part`, buf);
    renameSync(`${target}.part`, target);
  }
}

/** build-cache/mac/node: a universal (arm64 + x86_64) Node, built from the two verified archives. */
async function fetchMac() {
  const out = `${cacheDir}mac/node`;
  const stamp = `${cacheDir}mac/node.sources`;
  const sources = MAC_ARCHIVES.map((a) => a.sha256).join('\n');
  if (existsSync(out) && existsSync(stamp) && readFileSync(stamp, 'utf8') === sources) return;
  const work = `${cacheDir}mac/work/`;
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const parts = [];
  for (const a of MAC_ARCHIVES) {
    const tgz = `${work}node-${a.arch}.tar.gz`;
    writeFileSync(tgz, await download(a.url, a.sha256, `node darwin-${a.arch}`));
    const member = `node-v${NODE_VERSION}-darwin-${a.arch}/bin/node`;
    execFileSync('tar', ['-xzf', tgz, '-C', work, member], { stdio: 'inherit' });
    parts.push(`${work}${member}`);
  }
  execFileSync('lipo', ['-create', ...parts, '-output', `${out}.part`], { stdio: 'inherit' });
  chmodSync(`${out}.part`, 0o755);
  renameSync(`${out}.part`, out);
  writeFileSync(stamp, sources);
  rmSync(work, { recursive: true, force: true });
}

export async function fetchRuntime(platform = process.platform) {
  mkdirSync(`${cacheDir}mac`, { recursive: true });
  if (platform === 'darwin') await fetchMac();
  else await fetchWindows();
  return cacheDir;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await fetchRuntime();
  console.warn(`runtime binaries verified in ${cacheDir}`);
}
