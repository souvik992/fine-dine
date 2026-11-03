import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RealtimeHub } from '../realtime/hub.js';

/**
 * True when a browser Origin may use the API: listed origins (the desktop app, dev server), or pages served by
 * this server itself (captain/KDS PWAs). Requests without an Origin (native clients, curl) pass; auth still applies.
 */
export function isAllowedOrigin(origin: string | undefined, host: string | undefined, allowed: readonly string[]): boolean {
  if (!origin) return true;
  if (allowed.includes(origin)) return true;
  try {
    return host !== undefined && new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function streamRoutes(app: FastifyInstance, hub: RealtimeHub, allowedOrigins: readonly string[]): void {
  void app.register((scope, _opts, done) => {
    scope.get(
      '/v1/stream',
      {
        websocket: true,
        // Refuse cross-site WebSocket hijacking before the upgrade.
        preValidation: (req: FastifyRequest, reply, next) => {
          if (isAllowedOrigin(req.headers.origin, req.headers.host, allowedOrigins)) return next();
          void reply.status(403).send({ ok: false, error: { code: 'FORBIDDEN', message: 'Origin not allowed.' } });
        },
      },
      (socket, req) => hub.attach(socket, req.ip),
    );
    done();
  });
}
