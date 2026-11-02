import type { FastifyRequest } from 'fastify';
import type { Actor } from '../core/context.js';

/** Turns request headers into an Actor, or throws UNAUTHENTICATED. Device tokens + PIN sessions land in P2-01/P2-02. */
export interface Authenticator {
  readonly mode: string;
  authenticate(req: FastifyRequest): Actor;
}

/**
 * Phase 1 single-terminal mode: every request is the local terminal, no user. Only safe while the master
 * serves one terminal on a trusted LAN; the server logs a warning at startup. Replaced in P2-02.
 */
export const singleTerminalAuth: Authenticator = {
  mode: 'single-terminal',
  authenticate: () => ({ deviceId: null, userId: null }),
};
