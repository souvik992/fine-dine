// Online orders (P4-06): status, the orders for the screen, and pairing with the order hub.
import { createHash } from 'node:crypto';
import type { OnlineOrderView } from '@dinepos/shared';
import type { FastifyInstance } from 'fastify';
import { requireRight, sessionToken } from '../auth/require-right.js';
import { resolveSession } from '../auth/sessions.js';
import { PosError } from '../core/errors.js';
import type { Db } from '../db/connection.js';
import type { Execute, OnlineConnector } from '../online/connector.js';
import { onlineView, type OnlineOrderRow } from '../online/online-support.js';

/** "https://orders.example.in/connect/ABCD-EFGH" → hub address + code. Plain http only for a hub on this PC (testing). */
export function parseConnectLink(link: string): { hubUrl: string; code: string } {
  const m = /^(https?:\/\/[^\s/]+(?::\d+)?(?:\/[^\s]*?)?)\/connect\/([A-Za-z0-9]{4}-?[A-Za-z0-9]{4})\/?$/.exec(link.trim());
  if (!m) throw new PosError('VALIDATION', 'Paste the whole connection link from the order hub, for example https://orders.example.in/connect/ABCD-EFGH', { field: 'link' });
  const hubUrl = m[1]!.replace(/\/+$/, '');
  if (/^http:/.test(hubUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(hubUrl)) {
    throw new PosError('VALIDATION', 'The hub address must start with https:// (the outlet’s key travels on it).', { field: 'link' });
  }
  return { hubUrl, code: m[2]!.toUpperCase() };
}

export function onlineRoutes(app: FastifyInstance, deps: { db: Db; now: () => Date; connector: OnlineConnector; execute: Execute; fetch?: typeof fetch }): void {
  const { db, now } = deps;
  app.get('/v1/online', (_req, reply) => {
    void reply.header('cache-control', 'no-store').send(deps.connector.status());
    return reply;
  });

  /** Open orders (and today's finished ones), newest first within each state. */
  app.get('/v1/online/orders', (_req, reply) => {
    const since = new Date(now().getTime() - 24 * 3_600_000).toISOString();
    const rows = db
      .prepare(
        `SELECT * FROM online_order
         WHERE state NOT IN ('REJECTED', 'AUTO_REJECTED', 'CANCELLED', 'DELIVERED', 'PICKED_UP') OR updated_at >= ? OR alert IS NOT NULL
         ORDER BY received_at DESC LIMIT 200`,
      )
      .all(since) as OnlineOrderRow[];
    const orders: OnlineOrderView[] = rows.map((r) => onlineView(db, r));
    void reply.header('cache-control', 'no-store').send({ orders });
    return reply;
  });

  /** Pair with the hub (admin): the server asks the hub, then stores the link by command (the key never leaves it). */
  app.post<{ Body: { link?: unknown } }>('/v1/online/pair', async (req) => {
    requireRight(db, req, 'admin', now());
    const link = req.body?.link;
    const { hubUrl, code } = parseConnectLink(typeof link === 'string' ? link : '');
    const outlet = (db.prepare("SELECT value FROM config WHERE key = 'outlet.name'").pluck().get() as string | undefined) ?? '"DinePOS"';
    let r: Response;
    try {
      r = await (deps.fetch ?? fetch)(`${hubUrl}/v1/pos/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, deviceName: `${(JSON.parse(outlet) as string).slice(0, 40)} (DinePOS)` }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new PosError('INVALID_STATE', 'The order hub could not be reached. Check the link and the internet connection.', { reason: 'hub_unreachable' });
    }
    const j = (await r.json().catch(() => null)) as { deviceKey?: string; slug?: string; name?: string; storeId?: string; error?: { message?: string } } | null;
    if (!r.ok || !j?.deviceKey) throw new PosError('VALIDATION', j?.error?.message ?? 'The hub did not accept the code. Ask for a new connection link.', { field: 'link' });
    const session = resolveSession(db, sessionToken(req), now());
    const actor = { deviceId: req.deviceId, userId: session.user.id, sessionKey: createHash('sha256').update(`approval:${sessionToken(req)}`).digest('hex').slice(0, 32) };
    deps.execute('SaveOnlineLink', { hubUrl, deviceKey: j.deviceKey, storeSlug: j.slug ?? j.storeId ?? 'store', storeName: j.name ?? j.slug ?? 'Store' }, actor);
    deps.connector.refresh();
    return deps.connector.status();
  });
}
