import type { FastifyInstance } from 'fastify';
import { getHealth, type HealthDeps } from '../queries/health.js';

export function healthRoutes(app: FastifyInstance, deps: HealthDeps): void {
  app.get('/v1/health', async (_req, reply) => {
    void reply.header('cache-control', 'no-store');
    return getHealth(deps);
  });
}
