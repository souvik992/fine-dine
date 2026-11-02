import type { Right } from '@dinepos/shared';
import type { FastifyRequest } from 'fastify';
import { PosError } from '../core/errors.js';
import type { Db } from '../db/connection.js';
import { resolveSession } from './sessions.js';

/** Session token of a request (X-User-Session), if any. */
export const sessionToken = (req: FastifyRequest): string | undefined => {
  const v = req.headers['x-user-session'];
  return typeof v === 'string' && v ? v : undefined;
};

/** For protected reads: a signed-in session whose role has `right` without needing a manager's PIN. */
export function requireRight(db: Db, req: FastifyRequest, right: Right, now: Date): void {
  const s = resolveSession(db, sessionToken(req), now);
  if (!s.rights.some((r) => r.right === right && !r.needsPin)) {
    throw new PosError('FORBIDDEN', `You do not have the "${right}" right.`, { right });
  }
}
