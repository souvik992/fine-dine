// Add-ons (P5-01, docs/adr/0004-signed-addons.md): the signed package format, shared by the server (which loads
// add-ons) and the desktop (which runs their screens only after checking the same signature itself).
// Pure code: no crypto here (the browser bundles this file); the callers verify with node:crypto.
import { isRight, type Right } from './rights.js';

/**
 * Public keys whose signatures make an add-on trusted (Ed25519, SPKI DER, base64), by key id. The private key lives
 * only on the signing PC (%USERPROFILE%\.dinepos\addon-signing\private.pem), never in the repository. Several keys
 * may be listed so a key can be replaced.
 */
export const ADDON_TRUST_KEYS: Readonly<Record<string, string>> = {
  'dinepos-addons-2026': 'MCowBQYDK2VwAyEAkQhyHnqHIgHhqo+ACpcY1iia+fwdbqVNO3VUvv82GwQ=',
};

export interface AddonManifest {
  /** Folder name and route prefix: lower-case letters and digits, e.g. `tableqr`. Its tables are named `<id>_...`. */
  id: string;
  name: string;
  /** x.y.z; every release raises it (an older version than one already run is refused). */
  version: string;
  /** The oldest DinePOS server this add-on works with (x.y.z). */
  minPosVersion: string;
  /** Its command names start with this, e.g. `TableQr` → `TableQrPlaceOrder`. */
  commandPrefix: string;
  description?: string;
  /**
   * Rights the add-on's own server-side actor may use with no one signed in (e.g. a guest's order accepted
   * automatically). Signed with the rest, listed in Settings › Add-ons. Staff actions use the staff member's rights.
   */
  rights?: Right[];
  /** Which key signed it (a key of ADDON_TRUST_KEYS). */
  keyId: string;
  /** Every file of the package (path relative to the add-on folder) and its SHA-256 (hex). Others are ignored. */
  files: Record<string, string>;
  /** Ed25519 over `canonicalManifest(manifest)`, base64. */
  signature: string;
}

/** What `GET /v1/addons` says about each add-on found. */
export interface AddonInfo {
  id: string;
  name: string;
  version: string;
  description: string | null;
  /** off: not loaded, `error` says why (billing always carries on without it). */
  status: 'on' | 'off';
  error: string | null;
  /** The desktop screens, when the add-on has them: files under `ui/` and their fingerprints. */
  ui: { script: string; style: string | null } | null;
}

/** A mark an add-on puts on a floor tile (e.g. "QR order"), shown by the desktop and captain apps. */
export interface TableBadge {
  addonId: string;
  key: string;
  label: string;
  tone: 'info' | 'warn' | 'alert';
}

export const ADDON_ID = /^[a-z][a-z0-9]{1,19}$/;
export const ADDON_PREFIX = /^[A-Z][A-Za-z0-9]{1,19}$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;
const FILE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*(\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/;
const SHA = /^[0-9a-f]{64}$/;

/** The signed bytes: every field except `signature`, keys sorted at every level, no spaces. */
export function canonicalManifest(m: Omit<AddonManifest, 'signature'> & { signature?: string }): string {
  const { signature: _signature, ...rest } = m;
  return stable(rest);
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Reads a manifest.json, or throws an Error saying (plainly) what is wrong with it. */
export function parseManifest(text: string): AddonManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('manifest.json is not valid JSON.');
  }
  const m = raw as Partial<AddonManifest>;
  const str = (k: keyof AddonManifest) => {
    const v = m[k];
    return typeof v === 'string' && v.length > 0;
  };
  if (!m || typeof m !== 'object') throw new Error('manifest.json is empty.');
  if (!str('id') || !ADDON_ID.test(m.id!)) throw new Error('The add-on id must be 2-20 lower-case letters or digits.');
  if (!str('name') || m.name!.length > 60) throw new Error('The add-on needs a name (at most 60 characters).');
  if (!str('version') || !VERSION.test(m.version!)) throw new Error('The add-on version must look like 1.2.3.');
  if (!str('minPosVersion') || !VERSION.test(m.minPosVersion!)) throw new Error('minPosVersion must look like 0.1.0.');
  if (!str('commandPrefix') || !ADDON_PREFIX.test(m.commandPrefix!)) throw new Error('commandPrefix must be a name such as TableQr.');
  if (!str('keyId')) throw new Error('The add-on does not say which key signed it.');
  if (!str('signature')) throw new Error('The add-on is not signed.');
  if (m.description !== undefined && (typeof m.description !== 'string' || m.description.length > 300)) throw new Error('The description is too long.');
  if (m.rights !== undefined && (!Array.isArray(m.rights) || !m.rights.every((r) => typeof r === 'string' && isRight(r)))) throw new Error('The add-on asks for a right DinePOS does not have.');
  if (!m.files || typeof m.files !== 'object' || Array.isArray(m.files)) throw new Error('The add-on lists no files.');
  for (const [name, sha] of Object.entries(m.files)) {
    if (!FILE.test(name) || name.split('/').some((p) => p === '..' || p === '.') || name === 'manifest.json') throw new Error(`Bad file name in the add-on: ${name}`);
    if (typeof sha !== 'string' || !SHA.test(sha)) throw new Error(`Bad fingerprint for ${name}.`);
  }
  if (!m.files['backend.cjs']) throw new Error('The add-on has no backend.cjs.');
  return m as AddonManifest;
}

/** -1, 0 or 1 for x.y.z versions (a `-dev` or other suffix is ignored). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('-')[0]!.split('.').map(Number);
  const pb = b.split('-')[0]!.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}
