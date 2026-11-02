// Downloads the two third-party binaries the installer ships, verifies them against pinned SHA-256 hashes and
// caches them in build-cache/. A changed or corrupted download stops the build.
//
//   node.exe   Node.js 24.21.0 win-x64 (the version the whole test suite runs on). Hash from nodejs.org SHASUMS256.
//   WinSW      Windows service wrapper 2.12.0, .NET 4.6.1 build (in-box on Windows 10/11), MIT licence.
//              That release predates GitHub asset digests; the hash was recorded from the official release
//              (655,872 bytes, FileVersion 2.12.0.0) on 2026-11-02.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const NODE_VERSION = '24.21.0';
export const BINARIES = [
  {
    file: 'node.exe',
    url: `https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe`,
    sha256: 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32',
  },
  {
    file: 'WinSW.NET461.exe',
    url: 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW.NET461.exe',
    sha256: 'b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f',
  },
];

const cacheDir = fileURLToPath(new URL('../build-cache/', import.meta.url));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

export async function fetchRuntime() {
  mkdirSync(cacheDir, { recursive: true });
  for (const b of BINARIES) {
    const target = `${cacheDir}${b.file}`;
    if (existsSync(target) && sha256(readFileSync(target)) === b.sha256) continue;
    console.warn(`downloading ${b.url}`);
    const res = await fetch(b.url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`${b.file}: HTTP ${res.status} from ${b.url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const got = sha256(buf);
    if (got !== b.sha256) throw new Error(`${b.file}: SHA-256 mismatch (expected ${b.sha256}, got ${got}). Refusing to package it.`);
    writeFileSync(`${target}.part`, buf);
    renameSync(`${target}.part`, target);
  }
  return cacheDir;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await fetchRuntime();
  console.warn(`runtime binaries verified in ${cacheDir}`);
}
