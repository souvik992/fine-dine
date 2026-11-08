import { randomInt } from 'node:crypto';
import { exec, hash, one, tx } from './db.ts';
import { HubError } from './hub.ts';
import type { Hub } from './hub.ts';
import type { Grant } from './licences.ts';

/**
 * Activating DinePOS on a Windows PC from its Settings › Licence (P7-03, ADR-0006). The outlet's server sends the
 * account's email and password with the PC's hardware id:
 *   trial   a 14-day trial key, once per PC, per email and per mobile (trial_claim)
 *   signin  the key this account already has for this PC (after a reinstall, or a paid plan made in the portal)
 * The first activation makes the account's store for that PC and, when asked, pairs the outlet with this cloud (the
 * device key), so later renewals reach it through GET /v1/pos/licence.
 */

export const TRIAL_DAYS = 14;
export const TRIAL_SEATS = { terminals: 1, captains: 1, kds: 1 };
const HARDWARE_ID = /^[0-9A-F]{4}(-[0-9A-F]{4}){4}$/;

export interface ActivateInput { email?: unknown; password?: unknown; hardwareId?: unknown; outletName?: unknown; mode?: unknown; link?: unknown }
export interface Activation {
  kind: Grant['kind'];
  key: string;
  expiresAt: number;
  store: { slug: string; name: string };
  /** Only when `link` was asked: the outlet's key for this cloud (sales sync, renewals). Shown once. */
  deviceKey: string | null;
}

const claimHash = (kind: string, value: string) => hash(`trial-claim:${kind}:${value}`);

export class Activations {
  private hub: Hub;
  constructor(hub: Hub) {
    this.hub = hub;
    exec(hub.db, `CREATE TABLE IF NOT EXISTS trial_claim (value_hash TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('hardware','email','phone')),
      account_id TEXT NOT NULL REFERENCES account(id), grant_id TEXT NOT NULL REFERENCES licence_grant(id), claimed_at INTEGER NOT NULL)`);
  }

  async activate(input: ActivateInput): Promise<Activation> {
    const user = await this.hub.accounts.checkLogin(input.email, input.password);
    const hardwareId = String(input.hardwareId ?? '').trim().toUpperCase();
    if (!HARDWARE_ID.test(hardwareId)) throw new HubError('VALIDATION', 'This PC’s hardware id was not sent correctly.', 400);
    const mode = input.mode === 'trial' ? 'trial' : 'signin';
    const outletName = String(input.outletName ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'DinePOS outlet';
    const account = one<{ id: string; name: string; phone: string; status: string }>(this.hub.db, 'SELECT id, name, phone, status FROM account WHERE id = ?', user.account_id)!;
    if (account.status === 'suspended' || account.status === 'closed') throw new HubError('ACCOUNT_CLOSED', 'This account is not active. Please contact us.', 403);

    // the newest key this account has for this PC that has not ended (a reinstall, or a paid key made in the portal)
    const existing = one<{ id: string; store_id: string }>(this.hub.db, `SELECT id, store_id FROM licence_grant WHERE account_id = ? AND hardware_id = ? AND revoked_at IS NULL
      AND expires_at > ? AND kind != 'demo' ORDER BY expires_at DESC LIMIT 1`, account.id, hardwareId, this.hub.now());
    if (existing) return this.answer(this.hub.licences.get(existing.id)!, input.link === true, outletName);
    if (mode === 'signin') throw new HubError('NO_LICENCE', 'This account has no licence for this PC yet. Start the free trial, or choose a plan in your account at portal.posinext.com.', 404);

    const claims: Array<[string, string]> = [['hardware', hardwareId], ['email', user.email], ['phone', account.phone]];
    const taken = claims.find(([k, v]) => one(this.hub.db, 'SELECT 1 FROM trial_claim WHERE value_hash = ?', claimHash(k, v)));
    if (taken) {
      const what = taken[0] === 'hardware' ? 'This PC has' : taken[0] === 'email' ? 'This email has' : 'This mobile number has';
      throw new HubError('TRIAL_USED', `${what} already had a free trial. Choose a plan in your account at portal.posinext.com, or contact us.`, 409, { claim: taken[0] });
    }
    const storeId = this.storeFor(account.id, hardwareId, outletName);
    const grant = tx(this.hub.db, () => {
      const g = this.hub.licences.issue({ storeId, accountId: account.id, hardwareId, kind: 'trial', days: TRIAL_DAYS, seats: TRIAL_SEATS, licensee: account.name, by: `account:${user.email}` });
      for (const [k, v] of claims) exec(this.hub.db, 'INSERT INTO trial_claim (value_hash, kind, account_id, grant_id, claimed_at) VALUES (?,?,?,?,?)', claimHash(k, v), k, account.id, g.id, this.hub.now());
      if (account.status === 'new') exec(this.hub.db, "UPDATE account SET status = 'trial' WHERE id = ?", account.id);
      return g;
    });
    return this.answer(grant, input.link === true, outletName);
  }

  /** The account's store for this PC: the one an earlier key was for, else a new one (named after the outlet). */
  private storeFor(accountId: string, hardwareId: string, outletName: string): string {
    const before = one<{ store_id: string }>(this.hub.db, 'SELECT store_id FROM licence_grant WHERE account_id = ? AND hardware_id = ? ORDER BY issued_at DESC LIMIT 1', accountId, hardwareId);
    if (before) return before.store_id;
    const base = outletName.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'outlet';
    let slug = '';
    for (let i = 0; i < 20 && !slug; i++) {
      const s = `${base.length < 3 ? `${base}-outlet` : base}-${String(randomInt(1000, 10000))}`;
      if (!one(this.hub.db, 'SELECT 1 FROM store WHERE slug = ? UNION ALL SELECT 1 FROM brand WHERE slug = ?', s, s)) slug = s;
    }
    const st = this.hub.createStore(slug, outletName);
    exec(this.hub.db, 'INSERT INTO account_store (store_id, account_id, added_at) VALUES (?,?,?)', st.storeId, accountId, this.hub.now());
    return st.storeId;
  }

  private answer(g: Grant, link: boolean, outletName: string): Activation {
    const st = one<{ slug: string; name: string }>(this.hub.db, 'SELECT slug, name FROM store WHERE id = ?', g.storeId)!;
    let deviceKey: string | null = null;
    if (link) deviceKey = this.hub.pair(this.hub.newPairingCode(g.storeId), `${outletName.slice(0, 40)} (DinePOS)`).deviceKey;
    return { kind: g.kind, key: g.key, expiresAt: g.expiresAt, store: st, deviceKey };
  }
}
