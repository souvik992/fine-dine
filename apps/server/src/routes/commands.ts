import type { FastifyInstance } from 'fastify';
import type { Authenticator } from '../auth/authenticate.js';
import { executeCommand, type ExecuteDeps } from '../core/execute-command.js';

export function commandRoutes(app: FastifyInstance, deps: ExecuteDeps, auth: Authenticator): void {
  // Synchronous on purpose: the whole command runs inside one better-sqlite3 transaction.
  app.post('/v1/commands', (req, reply) => {
    // First-run setup is the one command allowed without a session, and only while no staff exist.
    const type = (req.body as { type?: unknown } | null)?.type;
    void reply.send(executeCommand(deps, req.body, auth.authenticate(req, { allowWhenNoStaff: type === 'SetupOutlet' })));
    return reply;
  });
}
