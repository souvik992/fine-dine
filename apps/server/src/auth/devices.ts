// Device pairing (docs/07 "Device pairing", P2-02). Every terminal, captain phone and kitchen screen carries a device
// token (`Authorization: Device <token>`); only its SHA-256 is stored. The master PC itself (requests from the loopback
// address) is the built-in "Master PC" device and needs no token: whoever can use that PC can already read its disk.
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { newId, UNPAIRED_DEVICE_ID } from '@dinepos/shared';
import { PosError } from '../core/errors.js';
import type { Db } from '../db/connection.js';

/** The built-in device for the master PC (migration 0004, renamed in 0007). */
export const MASTER_DEVICE_ID = UNPAIRED_DEVICE_ID;
export const PAIRING_MINUTES = 10;
const MAX_PENDING = 20;

export const deviceTokenHash = (token: string) => createHash('sha256').update(`device:${token}`).digest('hex');

export function isLoopback(ip: string | undefined): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

/** `Authorization: Device <token>` → the token. */
export function deviceTokenOf(authorization: string | undefined): string | undefined {
  const m = /^Device ([A-Za-z0-9_-]{20,100})$/.exec(authorization?.trim() ?? '');
  return m?.[1];
}

export interface DeviceRow {
  id: string;
  name: string;
  kind: 'terminal' | 'captain' | 'kds';
}

/** The paired, not revoked device of a token, or null. */
export function resolveDevice(db: Db, token: string | undefined): DeviceRow | null {
  if (!token) return null;
  return (db.prepare('SELECT id, name, kind FROM device WHERE token_hash = ? AND revoked_at IS NULL').get(deviceTokenHash(token)) as DeviceRow | undefined) ?? null;
}

export function deviceUnpaired(): PosError {
  return new PosError('UNAUTHENTICATED', 'This device is not paired with the outlet server. Pair it first.', { reason: 'device_not_paired' });
}

/** Marks old pending requests expired (housekeeping on every new request). */
function expireOld(db: Db, at: string): void {
  db.prepare(`UPDATE pairing_request SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?`).run(at);
}

export interface PairingTicket {
  requestId: string;
  /** Only the requesting device has it; it collects the token with it. */
  secret: string;
  code: string;
  expiresAt: string;
}

/** A new device asks to be paired: a 6-digit code to show, valid for 10 minutes. */
export function createPairingRequest(db: Db, input: { name: string; kind: DeviceRow['kind'] }, remoteAddr: string | null, now: Date): PairingTicket {
  const at = now.toISOString();
  return db
    .transaction(() => {
      expireOld(db, at);
      const pending = db.prepare(`SELECT count(*) FROM pairing_request WHERE status = 'pending'`).pluck().get() as number;
      if (pending >= MAX_PENDING) throw new PosError('INVALID_STATE', 'Too many devices are waiting to be paired. Try again in a few minutes.');
      const taken = db.prepare(`SELECT 1 FROM pairing_request WHERE status = 'pending' AND code = ?`).pluck();
      let code: string;
      do code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      while (taken.get(code));
      const requestId = newId();
      const secret = randomBytes(24).toString('base64url');
      const expiresAt = new Date(now.getTime() + PAIRING_MINUTES * 60_000).toISOString();
      db.prepare(
        `INSERT INTO pairing_request (id, code, secret_hash, device_name, kind, remote_addr, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(requestId, code, deviceTokenHash(secret), input.name, input.kind, remoteAddr, at, expiresAt);
      return { requestId, secret, code, expiresAt };
    })
    .immediate();
}

export type PairingPoll = { status: 'pending' | 'expired' } | { status: 'paired'; deviceId: string; deviceName: string; deviceToken: string };

/**
 * The requesting device asks how its request is going. Once approved, the first poll gets the device token (made
 * now; only its hash is stored) and the request is closed, so the token is handed out exactly once.
 */
export function pollPairingRequest(db: Db, requestId: string, secret: string, now: Date): PairingPoll {
  const at = now.toISOString();
  return db
    .transaction((): PairingPoll => {
      expireOld(db, at);
      const r = db.prepare('SELECT status, secret_hash, device_id FROM pairing_request WHERE id = ?').get(requestId) as
        | { status: string; secret_hash: string; device_id: string | null }
        | undefined;
      if (!r || r.secret_hash !== deviceTokenHash(secret)) throw new PosError('NOT_FOUND', 'Unknown pairing request.');
      if (r.status === 'pending') return { status: 'pending' };
      if (r.status !== 'approved' || !r.device_id) return { status: 'expired' };
      const token = randomBytes(32).toString('base64url');
      db.prepare('UPDATE device SET token_hash = ? WHERE id = ?').run(deviceTokenHash(token), r.device_id);
      db.prepare(`UPDATE pairing_request SET status = 'delivered' WHERE id = ?`).run(requestId);
      const name = db.prepare('SELECT name FROM device WHERE id = ?').pluck().get(r.device_id) as string;
      return { status: 'paired', deviceId: r.device_id, deviceName: name, deviceToken: token };
    })
    .immediate();
}

/** Throttled "last seen" for the Devices screen. */
export function touchDevice(db: Db, deviceId: string, now: Date): void {
  const at = now.toISOString();
  db.prepare(`UPDATE device SET last_seen_at = ? WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < ?)`).run(at, deviceId, new Date(now.getTime() - 60_000).toISOString());
}
