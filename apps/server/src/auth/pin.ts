// Staff PIN hashing (docs/07). scrypt from node:crypto, as in Tiffin POS: no native module to build on shop PCs
// (docs/07 names Argon2id; scrypt is the memory-hard alternative Node ships). Format: s1$<N>$<salt hex>$<hash hex>.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** 2^14: about 30 ms per check on a modest PC, so a lockout after 5 tries keeps guessing slow. */
export const PIN_COST = 16_384;

export function isValidPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

export function hashPin(pin: string, cost = PIN_COST): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 32, { N: cost, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `s1$${cost}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [tag, n, salt, hash] = stored.split('$');
  if (tag !== 's1' || !n || !salt || !hash || !isValidPin(pin)) return false;
  const actual = scryptSync(pin, Buffer.from(salt, 'hex'), 32, { N: Number(n), r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
