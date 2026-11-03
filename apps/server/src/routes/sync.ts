// Cloud sync (P4-05): the agent's status for Settings › Cloud sync, and "Sync now".
import type { FastifyInstance } from 'fastify';
import { requireRight } from '../auth/require-right.js';
import type { Db } from '../db/connection.js';
import type { SyncAgent } from '../sync/sync-agent.js';

export function syncRoutes(app: FastifyInstance, deps: { db: Db; now: () => Date; agent: SyncAgent }): void {
  app.get('/v1/sync', (_req, reply) => {
    void reply.header('cache-control', 'no-store').send(deps.agent.status());
    return reply;
  });

  /** Sends what is waiting and looks for a renewed licence key now (admin); answers with the status after. */
  app.post('/v1/sync/run', async (req) => {
    requireRight(deps.db, req, 'admin', deps.now());
    return deps.agent.syncNow();
  });
}
