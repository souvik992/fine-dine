import { createHash } from 'node:crypto';
import { UNPAIRED_DEVICE_ID } from '@dinepos/shared';
import type { FastifyRequest } from 'fastify';
import type { Actor } from '../core/context.js';
import type { Db } from '../db/connection.js';
import { resolveSession, staffCount } from './sessions.js';

export interface AuthOptions {
  /** First-run setup: allowed without a session while no staff exist. */
  allowWhenNoStaff?: boolean;
}

/** Turns request headers into an Actor, or throws UNAUTHENTICATED. Device tokens (P2-02) add to this later. */
export interface Authenticator {
  readonly mode: string;
  authenticate(req: FastifyRequest, opts?: AuthOptions): Actor;
}

const header = (req: FastifyRequest, name: string): string | undefined => {
  const v = req.headers[name];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
};

/** Staff sessions (docs/07): `X-User-Session` from PIN sign-in; `X-Manager-Pin` when an approval is needed. */
export function sessionAuth(db: Db, now: () => Date = () => new Date()): Authenticator {
  return {
    mode: 'staff-session',
    authenticate(req, opts = {}) {
      const token = header(req, 'x-user-session');
      if (!token && opts.allowWhenNoStaff && staffCount(db) === 0) return { deviceId: UNPAIRED_DEVICE_ID, userId: null };
      const session = resolveSession(db, token, now());
      return {
        deviceId: UNPAIRED_DEVICE_ID,
        userId: session.user.id,
        managerPin: header(req, 'x-manager-pin') ?? null,
        sessionKey: createHash('sha256').update(`approval:${token}`).digest('hex').slice(0, 32),
      };
    },
  };
}

/** Every request is an anonymous local terminal. Tests and tools only (pair with `allowAllRights`). */
export const singleTerminalAuth: Authenticator = {
  mode: 'single-terminal',
  authenticate: () => ({ deviceId: null, userId: null }),
};
