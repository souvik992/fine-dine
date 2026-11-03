import type { LicenceInfo } from '@dinepos/shared';
import type { FastifyInstance } from 'fastify';
import { MASTER_DEVICE_ID } from '../auth/devices.js';
import type { Db } from '../db/connection.js';
import type { LicenceGate } from '../licence/gate.js';

/** Paired devices of a kind still in use (the master PC's own built-in row is not a paired device). */
export function pairedCount(db: Db, kind: string): number {
  return db.prepare('SELECT count(*) FROM device WHERE kind = ? AND revoked_at IS NULL AND id <> ?').pluck().get(kind, MASTER_DEVICE_ID) as number;
}

/** Seats in use: paired devices not revoked; the master PC is one terminal. */
export function seatsUsed(db: Db): LicenceInfo['used'] {
  const n = (kind: string) => pairedCount(db, kind);
  return { terminals: n('terminal') + 1, captains: n('captain'), kds: n('kds') };
}

/** P2-09: the licence for Settings › Licence — status, this PC's hardware id (to request a key), seats in use. */
export function licenceRoutes(app: FastifyInstance, deps: { db: Db; now: () => Date; licence: LicenceGate }): void {
  app.get('/v1/licence', (_req, reply) => {
    const body: LicenceInfo = { ...deps.licence.status(deps.db, deps.now()), enforced: deps.licence.enforced, used: seatsUsed(deps.db) };
    void reply.header('cache-control', 'no-store').send(body);
    return reply;
  });
}
