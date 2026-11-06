// Print agents (P6-03). The agent authenticates with its own key ("Authorization: Agent <key>"), not as a paired device:
//   GET  /v1/print-agent/jobs?wait=<ms>     the printers it serves and the jobs waiting for it (long poll, at most 25 s)
//   POST /v1/print-agent/jobs/:jobId        { ok, error? } once it printed (or could not)
// Staff see the agents in GET /v1/print-agents (any paired device).
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { PosError } from '../core/errors.js';
import type { Db } from '../db/connection.js';
import type { AgentBroker } from '../print/agent-broker.js';

export interface PrintAgentRouteDeps {
  db: Db;
  agents: AgentBroker;
  now: () => Date;
}

export const agentKeyHash = (key: string) => createHash('sha256').update(`agent:${key}`).digest('hex');

const resultSchema = z.object({ ok: z.boolean(), error: z.string().max(500).nullable().optional() }).strict();

export function printAgentRoutes(app: FastifyInstance, deps: PrintAgentRouteDeps): void {
  const agentOf = (req: FastifyRequest) => {
    const key = /^Agent (\S{20,200})$/.exec(String(req.headers.authorization ?? ''))?.[1];
    const row = key ? (deps.db.prepare('SELECT id, name FROM print_agent WHERE key_hash = ? AND revoked_at IS NULL').get(agentKeyHash(key)) as { id: string; name: string } | undefined) : undefined;
    if (!row) throw new PosError('UNAUTHENTICATED', 'This print agent key is not valid (it was removed, or mistyped). Add the agent again in Settings › Kitchen & printers.');
    const version = String(req.headers['x-agent-version'] ?? '').slice(0, 40) || null;
    // last seen, like a device's: telemetry, not outlet data
    deps.db.prepare('UPDATE print_agent SET last_seen_at = ?, version = coalesce(?, version) WHERE id = ?').run(deps.now().toISOString(), version, row.id);
    return row;
  };
  const printersOf = (agentId: string) =>
    deps.db.prepare('SELECT p.id, p.name, p.transport FROM printer_agent pa JOIN printer p ON p.id = pa.printer_id WHERE pa.agent_id = ? ORDER BY p.name COLLATE NOCASE').all(agentId) as Array<{ id: string; name: string; transport: string }>;

  app.get<{ Querystring: { wait?: string } }>('/v1/print-agent/jobs', async (req, reply) => {
    const agent = agentOf(req);
    const wait = Math.max(0, Math.min(25_000, Number(req.query.wait ?? 0) || 0));
    const jobs = await deps.agents.poll(agent.id, wait);
    return reply.header('cache-control', 'no-store').send({ agent, printers: printersOf(agent.id), jobs });
  });

  app.post<{ Params: { jobId: string } }>('/v1/print-agent/jobs/:jobId', (req, reply) => {
    const agent = agentOf(req);
    const body = resultSchema.safeParse(req.body);
    if (!body.success) throw new PosError('VALIDATION', 'Send { ok, error }.');
    const known = deps.agents.result(agent.id, req.params.jobId, body.data.ok, body.data.error ?? null);
    return reply.send({ ok: true, known });
  });

  app.get('/v1/print-agents', (_req, reply) => {
    const rows = deps.db.prepare('SELECT id, name, created_at, last_seen_at, version FROM print_agent WHERE revoked_at IS NULL ORDER BY name COLLATE NOCASE').all() as Array<{ id: string; name: string; created_at: string; last_seen_at: string | null; version: string | null }>;
    return reply.header('cache-control', 'no-store').send({
      agents: rows.map((a) => ({ id: a.id, name: a.name, createdAt: a.created_at, lastSeenAt: a.last_seen_at, version: a.version, online: deps.agents.online(a.id), printers: printersOf(a.id).map((p) => ({ id: p.id, name: p.name })) })),
    });
  });
}
