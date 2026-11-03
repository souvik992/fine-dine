// The phone and kitchen-screen apps (docs/01: "Captain and KDS PWAs are served at /captain and /kds"). Static files
// built by Vite; served without a device token (they are code, not data: every API call they make needs one).
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { IS_BUNDLED } from '../version.js';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/** The apps own their page: same-origin API and stream only, no inline scripts. */
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'";

/** Where a web app's built files are: next to server.mjs in the installer, apps/<name>/dist in the repo. */
export function defaultWebDir(name: 'captain' | 'kds'): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return IS_BUNDLED ? path.join(here, 'web', name) : path.resolve(here, '..', '..', '..', name, 'dist');
}

export function webAppRoutes(app: FastifyInstance, name: 'captain' | 'kds', dir: string): void {
  const prefix = `/${name}`;
  const send = (reply: FastifyReply, file: string, cache: string) =>
    reply
      .header('content-type', TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
      .header('cache-control', cache)
      .header('content-security-policy', CSP)
      .header('x-content-type-options', 'nosniff')
      .header('referrer-policy', 'no-referrer')
      .send(readFileSync(file));

  app.get(prefix, (_req, reply) => reply.redirect(`${prefix}/`));
  app.get<{ Params: { '*': string } }>(`${prefix}/*`, (req, reply) => {
    const index = path.join(dir, 'index.html');
    if (!existsSync(index)) {
      return reply.status(404).type('text/plain; charset=utf-8').send(`The ${name} app is not built on this server (npm run build -w @dinepos/${name}).`);
    }
    const rel = decodeURIComponent(req.params['*'] || 'index.html');
    const file = path.resolve(dir, rel);
    // Never outside the app folder (../, absolute paths, drive letters).
    if (file !== dir && !file.startsWith(dir + path.sep)) return reply.status(404).send();
    if (existsSync(file) && statSync(file).isFile()) {
      const fresh = rel === 'index.html' || rel === 'sw.js' || rel.endsWith('.webmanifest');
      return send(reply, file, fresh ? 'no-cache' : rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
    }
    // App routes (/captain/tables/T7) get the page; a missing file with an extension is a real 404.
    if (path.extname(rel)) return reply.status(404).send();
    return send(reply, index, 'no-cache');
  });
}
