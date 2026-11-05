// Add-on screens on the terminal (P5-01, ADR-0004). The renderer may run only app://dinepos scripts (CSP), so an
// add-on's screens are fetched here, from the outlet server's public package route, and served as
// app://dinepos/addons/<id>/<file>?server=<origin> only when this terminal itself has checked the signature (keys
// built into the app) and the file's fingerprint. A server cannot make the terminal run anything we did not sign.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { ADDON_ID, ADDON_TRUST_KEYS, canonicalManifest, parseManifest } from '@dinepos/shared';

export const ADDON_FILES = { 'ui.js': 'text/javascript; charset=utf-8', 'ui.css': 'text/css; charset=utf-8' } as const;
export type AddonFile = keyof typeof ADDON_FILES;

/** `app://dinepos/addons/<id>/<ui.js|ui.css>?server=<http(s) origin>`, or null. */
export function parseAddonUrl(url: string): { id: string; file: AddonFile; server: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const m = /^\/addons\/([a-z0-9]+)\/(ui\.js|ui\.css)$/.exec(u.pathname);
  if (!m || !ADDON_ID.test(m[1]!)) return null;
  const server = u.searchParams.get('server') ?? '';
  let origin: URL;
  try {
    origin = new URL(server);
  } catch {
    return null;
  }
  if (origin.protocol !== 'http:' && origin.protocol !== 'https:') return null;
  return { id: m[1]!, file: m[2] as AddonFile, server: origin.origin };
}

/** Null when `bytes` is the signed `ui/<file>` of a package signed by a trusted key; otherwise why not. */
export function addonFileProblem(manifestText: string, id: string, file: AddonFile, bytes: Uint8Array, trust: Readonly<Record<string, string>> = ADDON_TRUST_KEYS): string | null {
  let m;
  try {
    m = parseManifest(manifestText);
  } catch (e) {
    return e instanceof Error ? e.message : 'Bad manifest.';
  }
  if (m.id !== id) return 'The package is for another add-on.';
  const key = trust[m.keyId];
  if (!key) return 'Signed with a key this terminal does not trust.';
  try {
    const ok = verify(null, Buffer.from(canonicalManifest(m), 'utf8'), createPublicKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' }), Buffer.from(m.signature, 'base64'));
    if (!ok) return 'The signature is not valid.';
  } catch {
    return 'The signature is not valid.';
  }
  const expected = m.files[`ui/${file}`];
  if (!expected) return 'The add-on has no such screen file.';
  if (createHash('sha256').update(bytes).digest('hex') !== expected) return 'The screen file does not match its signature.';
  return null;
}

/** Fetches and checks an add-on screen file from the outlet server. */
export async function loadAddonFile(target: { id: string; file: AddonFile; server: string }, fetchFn: typeof fetch = fetch): Promise<Uint8Array> {
  const base = `${target.server}/a/${target.id}/_pkg`;
  const [mres, fres] = await Promise.all([fetchFn(`${base}/manifest.json`), fetchFn(`${base}/ui/${target.file}`)]);
  if (!mres.ok || !fres.ok) throw new Error('The add-on is not available on the outlet server.');
  const bytes = new Uint8Array(await fres.arrayBuffer());
  const problem = addonFileProblem(await mres.text(), target.id, target.file, bytes);
  if (problem) throw new Error(problem);
  return bytes;
}
