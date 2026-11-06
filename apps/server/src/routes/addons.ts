// Add-on routes (P5-01, ADR-0004):
//  GET  /v1/addons                         the add-ons found and whether each is on (any paired device)
//  *    /v1/addons/<id>/<path>             the add-on's staff routes: signed in, with the route's right
//  GET  /a/<id>/_pkg/manifest.json, ui/*   the signed screens, so a terminal can check the signature itself
//  GET  /a/<id>/<path>                     the add-on's guest pages (public, strict CSP)
//  *    /a/<id>/api/<path>                 the add-on's guest API (public, rate limited)
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AddonFile, type AddonRoute, type AddonSet, type LoadedAddon } from '../addons/loader.js';
import type { Authenticator } from '../auth/authenticate.js';
import { PosError } from '../core/errors.js';
import type { RightsPolicy } from '../core/rights.js';
import type { Db } from '../db/connection.js';

/** Guest pages: own files only; they call only their own server (no inline scripts, no other sites). */
export const GUEST_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

/** A small per-address limit for the public guest API: `burst` requests, refilled at `perMinute`. */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  constructor(
    private readonly burst = 30,
    private readonly perMinute = 60,
    private readonly now: () => number = Date.now,
  ) {}
  take(key: string): boolean {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.burst, at: t };
    b.tokens = Math.min(this.burst, b.tokens + ((t - b.at) / 60_000) * this.perMinute);
    b.at = t;
    if (this.buckets.size > 5_000) this.buckets.clear();
    this.buckets.set(key, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}

/**
 * P5-03: requests the order hub relays are replayed inside the server (app.inject) with this header, carrying a secret
 * made at start and the guest's address. Only those requests can name another address (rate limiting is per guest).
 */
export const RELAY_HEADER = 'x-dinepos-relay';

export interface AddonRouteDeps {
  db: Db;
  addons: AddonSet;
  auth: Authenticator;
  rights: RightsPolicy;
  limiter?: RateLimiter;
  /** The secret of relayed requests (RELAY_HEADER). */
  relaySecret?: string;
}

export function addonRoutes(app: FastifyInstance, deps: AddonRouteDeps): void {
  const { addons } = deps;
  const limiter = deps.limiter ?? new RateLimiter();
  app.get('/v1/addons', (_req, reply) => {
    void reply.header('cache-control', 'no-store').send({ addons: addons.infos() });
    return reply;
  });

  const byId = (id: string): LoadedAddon => {
    const a = addons.active.find((x) => x.manifest.id === id);
    if (!a) throw new PosError('NOT_FOUND', 'This add-on is not installed or is switched off.', { id });
    return a;
  };
  const send = (reply: FastifyReply, a: LoadedAddon, file: string, type: string, csp = true) => {
    const bytes = a.files.get(file);
    if (!bytes) throw new PosError('NOT_FOUND', 'No such file.');
    void reply
      .header('content-type', type)
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'no-cache')
      .header('referrer-policy', 'no-referrer');
    if (csp) void reply.header('content-security-policy', GUEST_CSP);
    void reply.send(bytes);
    return reply;
  };

  // the signed screens and their manifest (public: signed code, nothing secret; the terminal checks the signature)
  app.get<{ Params: { id: string } }>('/a/:id/_pkg/manifest.json', (req, reply) => {
    const a = byId(req.params.id);
    const { id, name, version, minPosVersion, commandPrefix, description, rights, keyId, files, signature } = a.manifest;
    void reply.header('cache-control', 'no-cache').send({ id, name, version, minPosVersion, commandPrefix, description, rights, keyId, files, signature });
    return reply;
  });
  app.get<{ Params: { id: string; file: string } }>('/a/:id/_pkg/ui/:file', (req, reply) => {
    const a = byId(req.params.id);
    const file = `ui/${req.params.file}`;
    const type = file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : null;
    if (!type) throw new PosError('NOT_FOUND', 'No such file.');
    return send(reply, a, file, type, false);
  });

  for (const a of addons.active) {
    const id = a.manifest.id;
    for (const r of a.routes) mount(app, a, r, deps, limiter);
    // guest pages
    for (const [urlPath, s] of a.statics) {
      app.get(`/a/${id}/${urlPath}`, (_req, reply) => send(reply, a, s.file, s.type));
      if (urlPath === 'index.html') app.get(`/a/${id}/`, (_req, reply) => send(reply, a, s.file, s.type));
    }
  }
}

function mount(app: FastifyInstance, a: LoadedAddon, r: AddonRoute, deps: AddonRouteDeps, limiter: RateLimiter): void {
  const url = r.access === 'staff' ? `/v1/addons/${a.manifest.id}${r.path}` : `/a/${a.manifest.id}/api${r.path}`;
  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    const relayed = guestAddress(req.headers[RELAY_HEADER], deps.relaySecret);
    const ip = relayed ?? req.ip;
    if (r.access === 'guest' && !limiter.take(`${a.manifest.id}:${relayed ? 'hub:' : ''}${ip}`)) throw new PosError('RATE_LIMITED', 'Too many requests. Please wait a moment.');
    const actor = r.access === 'staff' ? deps.auth.authenticate(req, r.right ? { right: r.right } : {}) : null;
    // the route's right, as a command would check it (a manager PIN may approve)
    let approved = actor;
    if (actor && r.right) {
      const verdict = deps.rights.check({ db: deps.db, actor, right: r.right, commandType: `${a.manifest.id}${r.path}` });
      if (verdict?.approvedBy) approved = { ...actor, approvedBy: verdict.approvedBy };
    }
    const result = await r.handler({
      actor: approved,
      body: req.body ?? null,
      query: (req.query ?? {}) as Record<string, string>,
      params: (req.params ?? {}) as Record<string, string>,
      ip,
      via: relayed ? 'hub' : 'lan',
    });
    if (result instanceof AddonFile) {
      return reply.header('content-type', result.contentType).header('x-content-type-options', 'nosniff').header('cache-control', 'private, max-age=86400').send(Buffer.from(result.bytes));
    }
    void reply.header('cache-control', 'no-store');
    if (r.access === 'guest') void reply.header('content-security-policy', GUEST_CSP);
    return reply.send(result ?? { ok: true });
  };
  if (r.method === 'GET') app.get(url, handler);
  else app.post(url, { bodyLimit: 64 * 1024 }, handler);
}

/** The guest's address of a relayed request, when it carries the right secret; otherwise null. */
function guestAddress(header: string | string[] | undefined, secret: string | undefined): string | null {
  if (!secret || typeof header !== 'string') return null;
  const [given, ip] = header.split(' ');
  return given === secret && ip ? ip.slice(0, 64) : null;
}
