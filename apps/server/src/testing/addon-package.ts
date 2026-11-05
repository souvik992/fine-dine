// Test helper (P5-01): writes a signed add-on package with a throwaway key (never the real signing key).
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalManifest, type AddonManifest } from '@dinepos/shared';

export interface TestKeys {
  trust: Record<string, string>;
  privateKey: KeyObject;
}

export function testKeys(keyId = 'test-key'): TestKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { trust: { [keyId]: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }, privateKey };
}

export function signManifest(m: Omit<AddonManifest, 'signature'>, privateKey: KeyObject): AddonManifest {
  return { ...m, signature: sign(null, Buffer.from(canonicalManifest(m), 'utf8'), privateKey).toString('base64') };
}

/** Writes `<root>/<folder>/` with the files and a signed manifest; returns the folder. */
export function writePackage(
  root: string,
  files: Record<string, string | Buffer>,
  keys: TestKeys,
  manifest: Partial<Omit<AddonManifest, 'signature' | 'files'>> = {},
  folder?: string,
): string {
  const m: Omit<AddonManifest, 'signature'> = {
    id: 'demo',
    name: 'Demo',
    version: '1.0.0',
    minPosVersion: '0.1.0',
    commandPrefix: 'Demo',
    keyId: Object.keys(keys.trust)[0]!,
    files: {},
    ...manifest,
  };
  const dir = path.join(root, folder ?? m.id);
  for (const [name, body] of Object.entries(files)) {
    const file = path.join(dir, ...name.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
    m.files[name] = createHash('sha256').update(typeof body === 'string' ? Buffer.from(body, 'utf8') : body).digest('hex');
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(signManifest(m, keys.privateKey), null, 2));
  return dir;
}
