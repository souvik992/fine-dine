// The server's licence check (P2-09): the stored key, verified with the vendor's public key for this PC, judged at the
// latest time the server has seen (turning the clock back does not extend a licence).
import type { KeyObject } from 'node:crypto';
import type { Db } from '../db/connection.js';
import { licenceStatus, publicKeyFrom, verifyKey, type LicenceSeats, type LicenceStatus, type TrustedKey, type Verified } from './licence.js';

export interface LicenceGate {
  /** False in development runs: everything is allowed and the status says so. */
  readonly enforced: boolean;
  readonly hardwareId: string;
  status(db: Db, now: Date): LicenceStatus;
  verify(raw: string): Verified;
  /** Seats of a kind the licence allows (null = no limit, development only). */
  seats(db: Db, now: Date): LicenceSeats | null;
}

interface Row {
  licence_key: string | null;
  last_seen_at: string | null;
}

function stored(db: Db): Row {
  return (db.prepare('SELECT licence_key, last_seen_at FROM licence WHERE id = 1').get() as Row | undefined) ?? { licence_key: null, last_seen_at: null };
}

/** The later of the clock and the latest time already seen; records it (at most once a minute: health polls often). */
function effectiveNow(db: Db, now: Date): Date {
  const last = stored(db).last_seen_at;
  const lastMs = last ? Date.parse(last) : 0;
  if (now.getTime() >= lastMs) {
    if (now.getTime() - lastMs > 60_000) db.prepare('UPDATE licence SET last_seen_at = ? WHERE id = 1').run(now.toISOString());
    return now;
  }
  return new Date(lastMs);
}

/** A trusted key as configured: base64 SPKI (or a KeyObject), with an optional limit in days (P7-02). */
export interface TrustedKeyConfig {
  id: string;
  publicKey: string | KeyObject;
  maxDays?: number;
}

/** `publicKey` alone is the master key; `keys` lists every trusted key (master and cloud, P7-02). */
export function createLicenceGate(opts: { publicKey?: string | KeyObject; keys?: readonly TrustedKeyConfig[]; hardwareId: string }): LicenceGate {
  const configs = opts.keys ?? (opts.publicKey ? [{ id: 'master', publicKey: opts.publicKey }] : []);
  if (!configs.length) throw new Error('createLicenceGate: no trusted key');
  const keys: TrustedKey[] = configs.map((k) => ({ id: k.id, publicKey: typeof k.publicKey === 'string' ? publicKeyFrom(k.publicKey) : k.publicKey, ...(k.maxDays !== undefined ? { maxDays: k.maxDays } : {}) }));
  const verify = (raw: string) => verifyKey(raw, keys, opts.hardwareId);
  const status = (db: Db, now: Date) => {
    const raw = stored(db).licence_key;
    return licenceStatus(raw ? verify(raw) : null, effectiveNow(db, now), opts.hardwareId);
  };
  return {
    enforced: true,
    hardwareId: opts.hardwareId,
    status,
    verify,
    seats: (db, now) => status(db, now).seats ?? { terminals: 1, captains: 0, kds: 0 },
  };
}

/** Development and tests: not enforced (the status says so, so nobody mistakes it for a licensed outlet). */
export function unenforcedGate(hardwareId = 'DEV'): LicenceGate {
  return {
    enforced: false,
    hardwareId,
    status: () => ({ state: 'dev', canOpenDay: true, hardwareId, message: 'Development run: the licence is not enforced.' }),
    verify: () => ({ ok: false, reason: 'Licences are not checked in a development run.' }),
    seats: () => null,
  };
}
