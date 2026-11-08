import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { newId } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { currentBusinessDate, ensureBusinessDay } from '../core/business-day.js';
import { denyAll, TEST_NOW, useHarness } from '../testing/command-harness.js';
import { createTestDb } from '../testing/test-db.js';
import { line, orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';
import { licenceGateFor } from './from-env.js';
import { createLicenceGate, unenforcedGate } from './gate.js';
import { formatHardwareId } from './hardware.js';
import { licenceStatus, parseKey, verifyKey, type LicencePayload } from './licence.js';

// P2-09: a key signed by the vendor for this PC; warning, grace, then no new business date; seats at pairing.
const DAY = 86_400_000;
const HW = 'AB12-CD34-EF56-7890-1A2B';
const vendor = generateKeyPairSync('ed25519');
const stranger = generateKeyPairSync('ed25519');

function issue(over: Partial<LicencePayload> = {}, privateKey: KeyObject = vendor.privateKey): string {
  const payload: LicencePayload = {
    v: 1,
    licensee: 'Spice Garden, Kolkata',
    hardwareId: HW,
    issuedAt: TEST_NOW().toISOString(),
    expiresAt: new Date(TEST_NOW().getTime() + 365 * DAY).toISOString(),
    seats: { terminals: 2, captains: 1, kds: 1 },
    features: [],
    ...over,
  };
  const body = Buffer.from(JSON.stringify(payload));
  return `${body.toString('base64url')}.${sign(null, body, privateKey).toString('base64url')}`;
}
const gate = () => createLicenceGate({ publicKey: vendor.publicKey, hardwareId: HW });
const at = (days: number) => new Date(TEST_NOW().getTime() + days * DAY);

describe('licence keys', () => {
  it('a genuine key for this PC verifies; another key, another PC, a changed payload or rubbish do not', () => {
    expect(verifyKey(issue(), vendor.publicKey, HW)).toMatchObject({ ok: true, payload: { licensee: 'Spice Garden, Kolkata' } });
    const reason = (r: ReturnType<typeof verifyKey>) => (r.ok ? 'ok' : r.reason);
    expect(reason(verifyKey(issue({}, stranger.privateKey), vendor.publicKey, HW))).toMatch(/not genuine/);
    expect(reason(verifyKey(issue({ hardwareId: '0000-0000-0000-0000-0000' }), vendor.publicKey, HW))).toMatch(/another computer/);
    const [body, sig] = issue().split('.');
    const tampered = Buffer.from(Buffer.from(body!, 'base64url').toString().replace('"terminals":2', '"terminals":20')).toString('base64url');
    expect(verifyKey(`${tampered}.${sig}`, vendor.publicKey, HW).ok).toBe(false);
    expect(reason(verifyKey('hello', vendor.publicKey, HW))).toMatch(/not a DinePOS licence key/);
    expect(parseKey(` ${issue().slice(0, 30)}\n${issue().slice(30)} `)).not.toBeNull(); // pasted across lines
  });

  it('ok → warned from 15 days before the end → 7 days of grace → no new business date', () => {
    const v = verifyKey(issue({ expiresAt: at(30).toISOString() }), vendor.publicKey, HW);
    const state = (d: number) => {
      const s = licenceStatus(v, at(d), HW);
      return [s.state, s.canOpenDay];
    };
    expect(state(0)).toEqual(['ok', true]);
    expect(state(16)).toEqual(['expiring', true]);
    expect(licenceStatus(v, at(16), HW).message).toMatch(/14 days left/);
    expect(state(31)).toEqual(['grace', true]);
    expect(state(36.9)).toEqual(['grace', true]);
    expect(state(37.1)).toEqual(['expired', false]);
    expect(licenceStatus(null, at(0), HW)).toMatchObject({ state: 'none', canOpenDay: false });
  });

  it('P7-02: master and cloud keys are trusted; a cloud key is limited to 400 days; an unknown kid is refused', () => {
    const cloud = generateKeyPairSync('ed25519');
    const trusted = [
      { id: 'master', publicKey: vendor.publicKey },
      { id: 'cloud', publicKey: cloud.publicKey, maxDays: 400 },
    ];
    const reason = (r: ReturnType<typeof verifyKey>) => (r.ok ? 'ok' : r.reason);
    // an existing key (no kid) is a master key and still verifies, long or short
    expect(reason(verifyKey(issue({ expiresAt: at(3650).toISOString() }), trusted, HW))).toBe('ok');
    // the cloud's own key: up to 400 days
    expect(reason(verifyKey(issue({ kid: 'cloud', expiresAt: at(14).toISOString() }, cloud.privateKey), trusted, HW))).toBe('ok');
    expect(reason(verifyKey(issue({ kid: 'cloud', expiresAt: at(400).toISOString() }, cloud.privateKey), trusted, HW))).toBe('ok');
    expect(reason(verifyKey(issue({ kid: 'cloud', expiresAt: at(401).toISOString() }, cloud.privateKey), trusted, HW))).toMatch(/at most 400 days/);
    expect(reason(verifyKey(issue({ kid: 'cloud', issuedAt: 'whenever', expiresAt: at(30).toISOString() }, cloud.privateKey), trusted, HW))).toMatch(/at most 400 days/);
    // a key cannot claim to be someone else's: the cloud key signing as master, or an unknown kid
    expect(reason(verifyKey(issue({ expiresAt: at(3650).toISOString() }, cloud.privateKey), trusted, HW))).toMatch(/not genuine/);
    expect(reason(verifyKey(issue({ kid: 'cloud' }, vendor.privateKey), trusted, HW))).toMatch(/not genuine/);
    expect(reason(verifyKey(issue({ kid: 'partner' }, cloud.privateKey), trusted, HW))).toMatch(/not genuine/);
    // an old build trusting only the master key refuses a cloud key
    expect(reason(verifyKey(issue({ kid: 'cloud' }, cloud.privateKey), vendor.publicKey, HW))).toMatch(/not genuine/);
    // the gate and the environment
    const g = createLicenceGate({ keys: trusted, hardwareId: HW });
    expect(g.verify(issue({ kid: 'cloud', expiresAt: at(14).toISOString() }, cloud.privateKey)).ok).toBe(true);
    const cloudPub = cloud.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const envGate = licenceGateFor({ DINEPOS_CLOUD_LICENCE_PUBLIC_KEY: cloudPub, DINEPOS_HARDWARE_ID: HW }, false);
    expect(envGate.verify(issue({ kid: 'cloud', expiresAt: at(14).toISOString() }, cloud.privateKey)).ok).toBe(true);
    expect(envGate.verify(issue({ kid: 'cloud', expiresAt: at(500).toISOString() }, cloud.privateKey)).ok).toBe(false);
  });

  it('P7-03: a trial key (feature "trial") is ok until its last 2 days, then says to choose a plan', () => {
    const v = verifyKey(issue({ expiresAt: at(14).toISOString(), features: ['trial'] }), vendor.publicKey, HW);
    expect(licenceStatus(v, at(0), HW)).toMatchObject({ state: 'ok', message: 'Free trial until 2026-11-16 (14 days left).' });
    expect(licenceStatus(v, at(11.5), HW).state).toBe('ok');
    expect(licenceStatus(v, at(12.5), HW)).toMatchObject({ state: 'expiring', canOpenDay: true });
    expect(licenceStatus(v, at(12.5), HW).message).toMatch(/free trial ends on .* Choose a plan/);
    expect(licenceStatus(v, at(15), HW).state).toBe('grace');
  });

  it('P8-02: DinePOS keys (labelled fine_dine, or unlabelled from before) verify; a Tiffin POS key does not', () => {
    expect(verifyKey(issue({ product: 'fine_dine' }), vendor.publicKey, HW).ok).toBe(true);
    expect(verifyKey(issue({}), vendor.publicKey, HW).ok).toBe(true);
    const tiffin = verifyKey(issue({ product: 'tiffin_qsr' }), vendor.publicKey, HW);
    expect(tiffin).toEqual({ ok: false, reason: 'This licence key is for Tiffin POS, not DinePOS.' });
    expect(licenceStatus(tiffin, at(0), HW)).toMatchObject({ state: 'invalid', canOpenDay: false });
    expect(verifyKey(issue({ product: 'pizza_pos' }), vendor.publicKey, HW)).toMatchObject({ ok: false, reason: expect.stringMatching(/another product/) as unknown });
  });

  it('the hardware id is stable and readable; only the installed server ignores the environment', () => {
    expect(formatHardwareId(['guid-1', 'ABCD-1234'])).toBe(formatHardwareId(['guid-1', 'ABCD-1234']));
    expect(formatHardwareId(['guid-1', 'ABCD-1234'])).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){4}$/);
    expect(formatHardwareId(['guid-2', 'ABCD-1234'])).not.toBe(formatHardwareId(['guid-1', 'ABCD-1234']));
    expect(licenceGateFor({}, false).enforced).toBe(false);
    const pub = vendor.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    expect(licenceGateFor({ DINEPOS_LICENCE_PUBLIC_KEY: pub, DINEPOS_HARDWARE_ID: HW }, false)).toMatchObject({ enforced: true, hardwareId: HW });
    expect(licenceGateFor({}, true).enforced).toBe(true); // installed: always enforced, env or not
  });
});

describe('licence in the server', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  beforeEach(() => seedOutlet(h));
  const install = (key = issue()) => h.run('InstallLicence', { key });

  it('without a key: the day in progress carries on, Day end closes it, and no new day opens until a key is installed', () => {
    h.useLicence(gate());
    const orderId = o.open(S.t1).order!.id; // mid-service is never blocked
    o.run('AddItems', orderId, { items: [line(S.dalMakhani)] });
    h.db.prepare(`UPDATE "order" SET state = 'void' WHERE id = ?`).run(orderId); // nothing left open for Day end
    h.db.prepare('UPDATE dining_table SET open_order_id = NULL').run();
    const end = h.run('DayEnd', { cashCountedPaise: 0 }).result as { nextDate: string | null; licence?: string };
    expect(end.nextDate).toBeNull();
    expect(end.licence).toMatch(/No licence key yet/);
    expect(currentBusinessDate(h.db)).toBeNull();
    const err = h.fail('OpenTable', { tableId: S.t2, covers: 2 }, 'DAY_CLOSED');
    expect(err.details).toEqual({ reason: 'licence', licence: 'none' });

    const res = install().result as { state: string; openedBusinessDate: string | null };
    expect(res.state).toBe('ok');
    expect(res.openedBusinessDate).toBe('2026-11-03'); // the day after the one closed
    expect(o.open(S.t2).order).toBeDefined();
    const audit = h.db.prepare("SELECT after_json FROM audit_event WHERE action = 'licence.install'").pluck().get() as string;
    expect(JSON.parse(audit)).toMatchObject({ licensee: 'Spice Garden, Kolkata', hardwareId: HW });
    expect(audit).not.toContain(issue().slice(0, 40)); // the key itself is not logged
  });

  it('refuses a key for another PC, a forged one or one past its grace; needs the admin right; not in development runs', () => {
    h.useLicence(gate());
    expect(h.fail('InstallLicence', { key: issue({ hardwareId: '0000-0000-0000-0000-0000' }) }, 'VALIDATION').message).toMatch(/another computer/);
    expect(h.fail('InstallLicence', { key: issue({}, stranger.privateKey) }, 'VALIDATION').message).toMatch(/not genuine/);
    expect(h.fail('InstallLicence', { key: issue({ expiresAt: at(-10).toISOString() }) }, 'VALIDATION').message).toMatch(/ended on/);
    expect(h.fail('InstallLicence', { key: issue() }, 'FORBIDDEN', { rights: denyAll }).details).toEqual({ right: 'admin' });
    h.useLicence(unenforcedGate());
    h.fail('InstallLicence', { key: issue() }, 'INVALID_STATE');
    expect(h.count('audit_event', "action = 'licence.install'")).toBe(0);
  });

  it('turning the clock back does not bring an expired licence back', () => {
    h.useLicence(gate());
    install(issue({ expiresAt: at(30).toISOString() }));
    const g = gate();
    expect(g.status(h.db, at(40)).state).toBe('expired');
    expect(g.status(h.db, at(1)).state).toBe('expired'); // the PC clock was set back
  });

  it('seats at pairing: the master PC is one terminal; a revoked device frees its seat', () => {
    h.useLicence(gate());
    install(); // terminals 2 (master + 1), captains 1
    const ask = (kind: 'terminal' | 'captain', code: string) =>
      h.db
        .prepare(`INSERT INTO pairing_request (id, code, secret_hash, device_name, kind, created_at, expires_at, status) VALUES (?, ?, 'x', ?, ?, ?, ?, 'pending')`)
        .run(newId(), code, `${kind} ${code}`, kind, TEST_NOW().toISOString(), at(1).toISOString());
    const pair = (code: string) => h.fail('PairDevice', { code }, 'PIN_REQUIRED'); // seat ok: the manager PIN comes next
    ask('terminal', '111111');
    pair('111111');
    h.db.prepare(`INSERT INTO device (id, name, kind, paired_at) VALUES (?, 'Counter 2', 'terminal', ?)`).run(newId(), TEST_NOW().toISOString());
    ask('terminal', '222222');
    const full = h.fail('PairDevice', { code: '222222' }, 'INVALID_STATE');
    expect(full.message).toMatch(/allows 2 billing terminals \(the master PC included\)/);
    expect(full.details).toMatchObject({ reason: 'seats', kind: 'terminal', allowed: 2, used: 2 });
    h.db.prepare(`UPDATE device SET revoked_at = ? WHERE name = 'Counter 2'`).run(TEST_NOW().toISOString());
    pair('222222');
    ask('captain', '333333');
    pair('333333');
  });

  it('the server opens no new day at start without a licence; health and GET /v1/licence say why', async () => {
    const db = createTestDb();
    expect(ensureBusinessDay(db, 'Asia/Kolkata', TEST_NOW, () => gate().status(db, TEST_NOW()).canOpenDay)).toBeNull();
    const app = buildApp({ db, timeZone: 'Asia/Kolkata', now: TEST_NOW, licence: gate() });
    const health = (await app.inject({ method: 'GET', url: '/v1/health' })).json<{ ok: boolean; licence: { state: string; canOpenDay: boolean } }>();
    expect(health).toMatchObject({ ok: false, licence: { state: 'none', canOpenDay: false } });
    const info = (await app.inject({ method: 'GET', url: '/v1/licence' })).json<{ hardwareId: string; enforced: boolean; used: { terminals: number } }>();
    expect(info).toMatchObject({ hardwareId: HW, enforced: true, used: { terminals: 1, captains: 0, kds: 0 } });
    await app.close();
    db.close();
  });
});
