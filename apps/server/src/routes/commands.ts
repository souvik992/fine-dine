import type { FastifyInstance } from 'fastify';
import type { Authenticator } from '../auth/authenticate.js';
import { executeCommand, type ExecuteDeps } from '../core/execute-command.js';

export function commandRoutes(app: FastifyInstance, deps: ExecuteDeps, auth: Authenticator): void {
  // Synchronous on purpose: the whole command runs inside one better-sqlite3 transaction.
  app.post('/v1/commands', (req, reply) => {
    // First-run setup is the one command allowed without a session, and only while no staff exist.
    const type = (req.body as { type?: unknown } | null)?.type;
    // A kitchen screen may run its own commands with no one signed in (DEVICE_RIGHTS, P4-02).
    const right = typeof type === 'string' ? deps.registry.get(type)?.right : undefined;
    void reply.send(executeCommand(deps, req.body, auth.authenticate(req, { allowWhenNoStaff: type === 'SetupOutlet', right: right ?? undefined })));
    return reply;
  });
}
