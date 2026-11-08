// Licence keys (docs/07 "Licence"): a payload signed with the vendor's Ed25519 private key; the app holds only the
// public key. Pure functions: parsing, verifying and the status at a moment in time.
import { createPublicKey, verify, type KeyObject } from 'node:crypto';

export interface LicenceSeats {
  /** Billing terminals, the master PC included. */
  terminals: number;
  captains: number;
  kds: number;
}

/** What the vendor signs. */
export interface LicencePayload {
  v: 1;
  licensee: string;
  hardwareId: string;
  issuedAt: string;
  expiresAt: string;
  seats: LicenceSeats;
  features: string[];
  /** Optional: the outlet the key was issued for (informational; reinstalling keeps the same key). */
  outletId?: string;
  /** P7-02: which trusted key signed it ("master" when missing: every key made before DinePOS Cloud signed keys). */
  kid?: string;
  /** P8-02 (ADR-0007): the product the key is for. Missing on keys made before products: those are DinePOS keys. */
  product?: string;
}

/**
 * A key the app trusts (ADR-0006). `master` is the vendor's offline key (no limit); `cloud` is DinePOS Cloud's own
 * key, trusted only for keys of at most `maxDays` (a leaked cloud key cannot make long licences).
 */
export interface TrustedKey {
  id: string;
  publicKey: KeyObject;
  maxDays?: number;
}

export type LicenceState =
  /** Development run: nothing enforced. */
  | 'dev'
  | 'none'
  | 'invalid'
  | 'ok'
  /** Valid, ends within WARN_DAYS. */
  | 'expiring'
  /** Ended less than GRACE_DAYS ago: still works, loudly. */
  | 'grace'
  | 'expired';

export interface LicenceStatus {
  state: LicenceState;
  /** May a new business date be opened? (never stops a day already open) */
  canOpenDay: boolean;
  message: string;
  licensee?: string;
  expiresAt?: string;
  /** Whole days until expiry (negative after it). */
  daysLeft?: number;
  /** Last day of the grace period. */
  graceEndsAt?: string;
  seats?: LicenceSeats;
  hardwareId: string;
}

export const WARN_DAYS = 15;
/** P7-03: a trial key (feature "trial") warns only in its last 2 days, not for the whole last WARN_DAYS of a 30-day trial. */
export const TRIAL_WARN_DAYS = 2;
export const GRACE_DAYS = 7;
const DAY = 86_400_000;
/** P8-02: this app's product code (keys for another product, e.g. Tiffin POS, are refused). */
export const PRODUCT = 'fine_dine';

const b64url = (s: string) => Buffer.from(s, 'base64url');

/** `<base64url payload JSON>.<base64url signature>`, as the keygen prints it (spaces and line breaks ignored). */
export function parseKey(raw: string): { payload: LicencePayload; signed: Buffer; signature: Buffer } | null {
  const key = raw.replace(/\s+/g, '');
  const parts = key.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const signed = b64url(parts[0]);
    const payload = JSON.parse(signed.toString('utf8')) as LicencePayload;
    if (payload.v !== 1 || typeof payload.hardwareId !== 'string' || typeof payload.expiresAt !== 'string' || Number.isNaN(Date.parse(payload.expiresAt))) return null;
    const s = payload.seats;
    if (!s || ![s.terminals, s.captains, s.kds].every((n) => Number.isInteger(n) && n >= 0)) return null;
    return { payload, signed, signature: b64url(parts[1]) };
  } catch {
    return null;
  }
}

export function publicKeyFrom(spkiBase64: string): KeyObject {
  return createPublicKey({ key: Buffer.from(spkiBase64, 'base64'), format: 'der', type: 'spki' });
}

export type Verified = { ok: true; payload: LicencePayload } | { ok: false; reason: string };

/** Signature by a trusted key (within that key's limit), and issued for this PC. Expiry is judged by `licenceStatus`. */
export function verifyKey(raw: string, trusted: KeyObject | readonly TrustedKey[], hardwareId: string): Verified {
  const parsed = parseKey(raw);
  if (!parsed) return { ok: false, reason: 'This is not a DinePOS licence key. Paste the whole key you were sent.' };
  const keys: readonly TrustedKey[] = 'length' in trusted ? trusted : [{ id: 'master', publicKey: trusted }];
  const kid = parsed.payload.kid ?? 'master';
  const signer = keys.find((k) => k.id === kid);
  if (!signer || !verify(null, parsed.signed, signer.publicKey, parsed.signature)) return { ok: false, reason: 'This licence key is not genuine (its signature does not match).' };
  if (signer.maxDays !== undefined) {
    const issued = Date.parse(parsed.payload.issuedAt);
    const span = Date.parse(parsed.payload.expiresAt) - issued;
    if (Number.isNaN(issued) || span > signer.maxDays * DAY) {
      return { ok: false, reason: `This licence key is not valid: keys from DinePOS Cloud last at most ${signer.maxDays} days. Ask for a new key.` };
    }
  }
  if (parsed.payload.hardwareId !== hardwareId) {
    return { ok: false, reason: `This licence key is for another computer (${parsed.payload.hardwareId}); this one is ${hardwareId}.` };
  }
  if (parsed.payload.product !== undefined && parsed.payload.product !== PRODUCT) {
    const other = parsed.payload.product === 'tiffin_qsr' ? 'Tiffin POS' : 'another product';
    return { ok: false, reason: `This licence key is for ${other}, not DinePOS.` };
  }
  return { ok: true, payload: parsed.payload };
}

const dateText = (iso: string) => iso.slice(0, 10);

/** The licence at `now`: warn 15 days before the end, then 7 days of grace, then no new business date. */
export function licenceStatus(verified: Verified | null, now: Date, hardwareId: string): LicenceStatus {
  if (!verified) {
    return { state: 'none', canOpenDay: false, hardwareId, message: 'No licence key yet. A new business day cannot start until one is entered (Settings › Licence).' };
  }
  if (!verified.ok) return { state: 'invalid', canOpenDay: false, hardwareId, message: verified.reason };
  const p = verified.payload;
  const expires = Date.parse(p.expiresAt);
  const daysLeft = Math.ceil((expires - now.getTime()) / DAY);
  const base = { licensee: p.licensee, expiresAt: p.expiresAt, daysLeft, seats: p.seats, hardwareId };
  if (now.getTime() < expires) {
    const trial = Array.isArray(p.features) && p.features.includes('trial');
    const left = `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;
    if (daysLeft <= (trial ? TRIAL_WARN_DAYS : WARN_DAYS)) {
      return { ...base, state: 'expiring', canOpenDay: true, message: trial ? `The free trial ends on ${dateText(p.expiresAt)} (${left}). Choose a plan in your DinePOS account to keep billing.` : `The licence ends on ${dateText(p.expiresAt)} (${left}). Renew it in time.` };
    }
    return { ...base, state: 'ok', canOpenDay: true, message: trial ? `Free trial until ${dateText(p.expiresAt)} (${left}).` : `Licensed to ${p.licensee} until ${dateText(p.expiresAt)}.` };
  }
  const graceEnds = new Date(expires + GRACE_DAYS * DAY).toISOString();
  if (now.getTime() < Date.parse(graceEnds)) {
    return {
      ...base,
      graceEndsAt: graceEnds,
      state: 'grace',
      canOpenDay: true,
      message: `The licence ended on ${dateText(p.expiresAt)}. Billing continues until ${dateText(graceEnds)}; after that no new business day can start. Enter a new key.`,
    };
  }
  return { ...base, graceEndsAt: graceEnds, state: 'expired', canOpenDay: false, message: `The licence ended on ${dateText(p.expiresAt)}. A new business day cannot start until a new key is entered (Settings › Licence).` };
}
