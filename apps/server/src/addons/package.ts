// Checks one add-on folder before anything of it runs (P5-01, ADR-0004): signature, folder name, POS version,
// fingerprint of every file. Only the checked bytes are used afterwards (a file changed on disk later is never read).
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ADDON_TRUST_KEYS, canonicalManifest, compareVersions, parseManifest, type AddonManifest } from '@dinepos/shared';

export interface CheckedPackage {
  manifest: AddonManifest;
  /** The package's files as checked (path → bytes). */
  files: ReadonlyMap<string, Buffer>;
}

const MAX_FILE = 8 * 1024 * 1024;
const MAX_TOTAL = 32 * 1024 * 1024;

/** True when `signature` is a valid Ed25519 signature of the manifest by one of `trustKeys`. */
export function signatureValid(manifest: AddonManifest, trustKeys: Readonly<Record<string, string>>): boolean {
  const key = trustKeys[manifest.keyId];
  if (!key) return false;
  try {
    const publicKey = createPublicKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(canonicalManifest(manifest), 'utf8'), publicKey, Buffer.from(manifest.signature, 'base64'));
  } catch {
    return false;
  }
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Throws an Error with a plain reason when the folder is not a trusted, intact add-on for this POS. */
export function checkPackage(dir: string, posVersion: string, trustKeys: Readonly<Record<string, string>> = ADDON_TRUST_KEYS): CheckedPackage {
  const folder = path.basename(dir);
  let text: string;
  try {
    text = readFileSync(path.join(dir, 'manifest.json'), 'utf8');
  } catch {
    throw new Error('manifest.json is missing.');
  }
  const manifest = parseManifest(text);
  if (!signatureValid(manifest, trustKeys)) throw new Error('The signature is not valid: this package was not made by DinePOS or was changed.');
  if (manifest.id !== folder) throw new Error(`The folder "${folder}" holds the add-on "${manifest.id}"; it must be in a folder of that name.`);
  if (!posVersion.includes('-dev') && compareVersions(posVersion, manifest.minPosVersion) < 0) {
    throw new Error(`It needs DinePOS ${manifest.minPosVersion} or newer (this is ${posVersion}). Update DinePOS first.`);
  }
  const files = new Map<string, Buffer>();
  let total = 0;
  for (const [name, expected] of Object.entries(manifest.files)) {
    const file = path.join(dir, ...name.split('/'));
    let bytes: Buffer;
    try {
      if (statSync(file).size > MAX_FILE) throw new Error(`${name} is too large.`);
      bytes = readFileSync(file);
    } catch (e) {
      throw new Error(e instanceof Error && e.message.endsWith('too large.') ? e.message : `${name} is missing.`, { cause: e });
    }
    total += bytes.length;
    if (total > MAX_TOTAL) throw new Error('The add-on is too large.');
    if (sha256(bytes) !== expected) throw new Error(`${name} was changed after it was signed.`);
    files.set(name, bytes);
  }
  return { manifest, files };
}
