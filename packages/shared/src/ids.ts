import { ulid } from 'ulid';

/** Crockford base32 ULID: 26 chars, no I, L, O or U. */
export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** New ULID. Records get their id where they are born (client or server). */
export function newId(): string {
  return ulid();
}

export function isUlid(value: unknown): value is string {
  return typeof value === 'string' && ULID_RE.test(value);
}
