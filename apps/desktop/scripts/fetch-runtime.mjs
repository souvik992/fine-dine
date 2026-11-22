// Downloads the third-party runtime the installer ships, verifies it against a pinned SHA-256 hash and caches it in
// build-cache/. A changed or corrupted download stops the build.
//
//   node.exe             Node.js 24.21.0 win-x64 (the version the whole test suite runs on).
//   node-darwin-arm64    Node.js 24.21.0 for Macs with an Apple chip (bin/node from the official .tar.gz).
//   node-darwin-x64      Node.js 24.21.0 for Intel Macs.
// Hashes from nodejs.org SHASUMS256.txt (for the Macs: of the .tar.gz, checked before anything is unpacked).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const NODE_VERSION = '24.21.0';
export const BINARIES = [
  {
    platform: 'win32',
    file: 'node.exe',
    url: `https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe`,
    sha256: 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32',
  },
  {
    platform: 'darwin',
    file: 'node-darwin-arm64',
    url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
    sha256: 'bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057',
    member: `node-v${NODE_VERSION}-darwin-arm64/bin/node`,
  },
  {
    platform: 'darwin',
    file: 'node-darwin-x64',
    url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-x64.tar.gz`,
    sha256: '1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097',
    member: `node-v${NODE_VERSION}-darwin-x64/bin/node`,
  },
];

const cacheDir = fileURLToPath(new URL('../build-cache/', import.meta.url));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** The pinned archive a binary came from, kept beside it so a later build can skip the download. */
const stamp = (b) => `${cacheDir}${b.file}.sha256`;

/** Fetches the runtime for one platform ('win32' or 'darwin'); default: the Windows installer's. */
export async function fetchRuntime(platform = 'win32') {
  mkdirSync(cacheDir, { recursive: true });
  for (const b of BINARIES.filter((x) => x.platform === platform)) {
    const target = `${cacheDir}${b.file}`;
    if (!b.member && existsSync(target) && sha256(readFileSync(target)) === b.sha256) continue;
    if (b.member && existsSync(target) && existsSync(stamp(b)) && readFileSync(stamp(b), 'utf8') === b.sha256) continue;
    console.warn(`downloading ${b.url}`);
    const res = await fetch(b.url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`${b.file}: HTTP ${res.status} from ${b.url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const got = sha256(buf);
    if (got !== b.sha256) throw new Error(`${b.file}: SHA-256 mismatch (expected ${b.sha256}, got ${got}). Refusing to package it.`);
    if (!b.member) {
      writeFileSync(`${target}.part`, buf);
      renameSync(`${target}.part`, target);
      continue;
    }
    // a Mac runtime: only bin/node from the verified archive
    const tmp = mkdtempSync(path.join(tmpdir(), 'dinepos-node-'));
    try {
      writeFileSync(path.join(tmp, 'node.tar.gz'), buf);
      execFileSync('tar', ['-xzf', 'node.tar.gz', b.member], { cwd: tmp, stdio: 'inherit' });
      renameSync(path.join(tmp, ...b.member.split('/')), target);
      chmodSync(target, 0o755);
      writeFileSync(stamp(b), b.sha256);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  return cacheDir;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await fetchRuntime(process.argv[2] ?? 'win32');
  console.warn(`runtime binaries verified in ${cacheDir}`);
}
