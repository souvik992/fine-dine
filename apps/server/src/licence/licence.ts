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
export const GRACE_DAYS = 7;
const DAY = 86_400_000;

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

/** Signature by the vendor's key, and issued for this PC. Expiry is judged by `licenceStatus`. */
export function verifyKey(raw: string, publicKey: KeyObject, hardwareId: string): Verified {
  const parsed = parseKey(raw);
  if (!parsed) return { ok: false, reason: 'This is not a DinePOS licence key. Paste the whole key you were sent.' };
  if (!verify(null, parsed.signed, publicKey, parsed.signature)) return { ok: false, reason: 'This licence key is not genuine (its signature does not match).' };
  if (parsed.payload.hardwareId !== hardwareId) {
    return { ok: false, reason: `This licence key is for another computer (${parsed.payload.hardwareId}); this one is ${hardwareId}.` };
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
    if (daysLeft <= WARN_DAYS) return { ...base, state: 'expiring', canOpenDay: true, message: `The licence ends on ${dateText(p.expiresAt)} (${daysLeft} day${daysLeft === 1 ? '' : 's'} left). Renew it in time.` };
    return { ...base, state: 'ok', canOpenDay: true, message: `Licensed to ${p.licensee} until ${dateText(p.expiresAt)}.` };
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
