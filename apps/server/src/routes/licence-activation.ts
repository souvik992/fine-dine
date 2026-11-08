// P7-03 (ADR-0006): Settings › Licence › "Start free trial" / "Sign in to your account". The server (never the terminal)
// sends the account's email and password with this PC's hardware id to DinePOS Cloud, then installs the key it gets
// with InstallLicence and, the first time, stores the cloud link with SaveOnlineLink (so renewals arrive by
// themselves). The password is only passed through: never stored, logged or audited.
import { createHash } from 'node:crypto';
import type { LicenceInfo } from '@dinepos/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRight, sessionToken } from '../auth/require-right.js';
import { resolveSession } from '../auth/sessions.js';
import { PosError } from '../core/errors.js';
import type { Db } from '../db/connection.js';
import type { LicenceGate } from '../licence/gate.js';
import type { Execute, OnlineConnector } from '../online/connector.js';
import { PRODUCT } from '../licence/licence.js';
import { seatsUsed } from './licence.js';

/** DinePOS Cloud, unless the outlet is already linked to one (Settings › Online orders › Order hub) or DINEPOS_CLOUD_URL says otherwise. */
export const DEFAULT_CLOUD_URL = 'https://portal.posinext.com';

const body = z
  .object({
    mode: z.enum(['trial', 'signin']),
    email: z.string().trim().min(3).max(254),
    password: z.string().min(1).max(200),
  })
  .strict();

interface CloudAnswer {
  kind?: string;
  key?: string;
  expiresAt?: number;
  store?: { slug: string; name: string };
  deviceKey?: string | null;
  error?: { code?: string; message?: string };
}

export function licenceActivationRoutes(
  app: FastifyInstance,
  deps: { db: Db; now: () => Date; licence: LicenceGate; execute: Execute; connector: OnlineConnector; cloudUrl?: string; fetch?: typeof fetch },
): void {
  const { db, now } = deps;
  app.post('/v1/licence/activate', async (req) => {
    requireRight(db, req, 'admin', now());
    const parsed = body.safeParse(req.body);
    if (!parsed.success) throw new PosError('VALIDATION', 'Enter your DinePOS account email and password.');
    if (!deps.licence.enforced) throw new PosError('INVALID_STATE', 'Licences are not checked in a development run.');
    const link = db.prepare('SELECT hub_url, device_key FROM online_link WHERE id = 1').get() as { hub_url: string | null; device_key: string | null } | undefined;
    const linked = !!link?.hub_url && !!link.device_key;
    const cloud = (deps.cloudUrl ?? (linked ? link.hub_url! : DEFAULT_CLOUD_URL)).replace(/\/+$/, '');
    const outlet = db.prepare("SELECT value FROM config WHERE key = 'outlet.name'").pluck().get() as string | undefined;
    const outletName = outlet ? (JSON.parse(outlet) as string) : 'DinePOS outlet';

    let res: Response;
    try {
      res = await (deps.fetch ?? fetch)(`${cloud}/v1/activate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...parsed.data, hardwareId: deps.licence.hardwareId, outletName, link: !linked, product: PRODUCT }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new PosError('INVALID_STATE', 'DinePOS Cloud could not be reached. Connect this PC to the internet to activate, or paste a licence key below.', { reason: 'cloud_unreachable' });
    }
    const j = (await res.json().catch(() => null)) as CloudAnswer | null;
    if (!res.ok || !j?.key) {
      const code = j?.error?.code ?? 'CLOUD_ERROR';
      const message = j?.error?.message ?? 'DinePOS Cloud could not activate this PC. Please try again.';
      throw new PosError(res.status === 401 || res.status === 400 ? 'VALIDATION' : 'INVALID_STATE', message, { reason: code.toLowerCase() });
    }

    const session = resolveSession(db, sessionToken(req), now());
    const actor = { deviceId: req.deviceId, userId: session.user.id, sessionKey: createHash('sha256').update(`approval:${sessionToken(req)}`).digest('hex').slice(0, 32) };
    deps.execute('InstallLicence', { key: j.key }, actor);
    if (!linked && j.deviceKey && j.store) {
      deps.execute('SaveOnlineLink', { hubUrl: cloud, deviceKey: j.deviceKey, storeSlug: j.store.slug, storeName: j.store.name }, actor);
      deps.connector.refresh();
    }
    const info: LicenceInfo = { ...deps.licence.status(db, now()), enforced: true, used: seatsUsed(db) };
    return { kind: j.kind ?? null, store: j.store ?? null, linked: linked || !!j.deviceKey, licence: info };
  });
}
