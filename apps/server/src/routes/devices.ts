import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createPairingRequest, isLoopback, MASTER_DEVICE_ID, pollPairingRequest } from '../auth/devices.js';
import { requireRight } from '../auth/require-right.js';
import { PosError } from '../core/errors.js';
import type { Db } from '../db/connection.js';

const requestBody = z.object({ name: z.string().trim().min(1).max(40), kind: z.enum(['terminal', 'captain', 'kds']).default('terminal') }).strict();
const collectBody = z.object({ secret: z.string().min(10).max(100) }).strict();

/**
 * Device pairing (docs/07, P2-02). A new device asks (public), shows the 6-digit code, a manager approves it with
 * PairDevice on a paired terminal, and the device collects its token once.
 */
export function deviceRoutes(app: FastifyInstance, deps: { db: Db; now: () => Date }): void {
  const { db, now } = deps;
  const noStore = { 'cache-control': 'no-store' };

  app.post('/v1/pairing-requests', (req, reply) => {
    const body = requestBody.safeParse(req.body);
    if (!body.success) throw new PosError('VALIDATION', 'Give this device a name (up to 40 characters).');
    return reply.headers(noStore).send(createPairingRequest(db, body.data, req.ip ?? null, now()));
  });

  app.post<{ Params: { id: string } }>('/v1/pairing-requests/:id/collect', (req, reply) => {
    const body = collectBody.safeParse(req.body);
    if (!body.success) throw new PosError('VALIDATION', 'Missing pairing secret.');
    return reply.headers(noStore).send(pollPairingRequest(db, req.params.id, body.data.secret, now()));
  });

  /** This device, as the server sees it (the master PC when on the server itself). */
  app.get('/v1/device', (req, reply) => {
    const id = req.deviceId ?? MASTER_DEVICE_ID;
    const d = db.prepare('SELECT id, name, kind FROM device WHERE id = ?').get(id) as { id: string; name: string; kind: string };
    return reply.headers(noStore).send({ ...d, master: id === MASTER_DEVICE_ID, loopback: isLoopback(req.ip) });
  });

  app.get('/v1/devices', (req, reply) => {
    requireRight(db, req, 'admin', now());
    const at = now().toISOString();
    const devices = db
      .prepare(
        `SELECT d.id, d.name, d.kind, d.paired_at AS pairedAt, d.last_seen_at AS lastSeenAt, d.revoked_at AS revokedAt,
                (SELECT count(*) FROM user_session s WHERE s.device_id = d.id AND s.expires_at > ?) AS sessions
         FROM device d ORDER BY d.revoked_at IS NOT NULL, d.id = ? DESC, d.paired_at DESC`,
      )
      .all(at, MASTER_DEVICE_ID) as Array<Record<string, unknown>>;
    const pending = db
      .prepare(`SELECT id, code, device_name AS name, kind, remote_addr AS remoteAddr, created_at AS createdAt, expires_at AS expiresAt FROM pairing_request WHERE status = 'pending' AND expires_at > ? ORDER BY created_at`)
      .all(at);
    return reply.headers(noStore).send({ devices: devices.map((d) => ({ ...d, master: d.id === MASTER_DEVICE_ID })), pending });
  });
}
