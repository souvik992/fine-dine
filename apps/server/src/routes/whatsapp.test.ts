import { DEFAULT_BILL_DISPLAY, newId } from '@dinepos/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { ensureBusinessDay } from '../core/business-day.js';
import { setConfigValue } from '../core/outlet-config.js';
import type { Db } from '../db/connection.js';
import { resetApprovalLimiter } from '../auth/approval.js';
import { DEV_OWNER, devSeedCommands, devSetupCommand, seedId } from '../seed/dev-seed.js';
import { createTestDb } from '../testing/test-db.js';
import { type hubBill, shareCode } from '../cloud/whatsapp-bill.js';
import { indianMobile } from './whatsapp.js';

// Bills on WhatsApp: the QR printed on the bill (and the bill sent up with bill.printed), and "Send on WhatsApp".

const now = () => new Date('2026-11-02T08:00:00Z');
const ids = { owner: DEV_OWNER.id, cashier: seedId('user:cashier'), captain: seedId('user:captain'), t1: seedId('table:main:1'), dal: seedId('item:DM') };
let db: Db;
let app: FastifyInstance;
let hubAnswer: { status: number; body: unknown };
let hubCalls: Array<{ url: string; method: string; auth: string | null; body: Record<string, unknown> | null }>;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fakeHub = ((input: string | URL | Request, init?: RequestInit) =>
  Promise.resolve().then(() => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!url.pathname.startsWith('/v1/pos/bills') && url.pathname !== '/v1/pos/whatsapp') return json(404, { error: { code: 'NOT_FOUND', message: 'Not in this test.' } });
    hubCalls.push({ url: url.toString(), method: init?.method ?? 'GET', auth: new Headers(init?.headers).get('authorization'), body: init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null });
    if (url.pathname === '/v1/pos/whatsapp') return json(200, { bills: true, qr: true, number: '919845012345' });
    return json(hubAnswer.status, hubAnswer.body);
  })) as typeof fetch;

beforeEach(() => {
  resetApprovalLimiter();
  db = createTestDb();
  ensureBusinessDay(db, 'Asia/Kolkata', now);
  app = buildApp({ db, timeZone: 'Asia/Kolkata', now, onlineFetch: fakeHub });
  hubCalls = [];
  hubAnswer = { status: 200, body: { sent: true, to: '98******10', page: 'https://hub.test/b/X' } };
});
afterEach(async () => {
  await app.close();
  db.close();
});

async function send(type: string, payload: unknown, opts: { token?: string; orderId?: string; expectedVersion?: number } = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/commands',
    headers: opts.token ? { 'x-user-session': opts.token } : {},
    payload: { commandId: newId(), type, payload, createdAt: '2026-11-02T13:30:00+05:30', ...(opts.orderId ? { orderId: opts.orderId, expectedVersion: opts.expectedVersion } : {}) },
  });
  return res.json<{ ok: boolean; error?: { code: string }; order?: { id: string }; result?: Record<string, unknown> }>();
}
const login = async (userId: string, pin: string) => (await app.inject({ method: 'POST', url: '/v1/sessions', payload: { userId, pin } })).json<{ token: string }>().token;
const link = () => db.prepare("UPDATE online_link SET hub_url = 'https://hub.test/', device_key = 'tpk_device', store_slug = 'spice', store_name = 'Spice' WHERE id = 1").run();
const qrOn = (on: boolean) => setConfigValue(db, 'bill.display', { ...DEFAULT_BILL_DISPLAY, whatsappQr: on });

/** The demo outlet; a dine-in bill for one Dal Makhani. */
async function billed(): Promise<{ owner: string; billId: string; orderId: string }> {
  await send(devSetupCommand().type, devSetupCommand().payload);
  const owner = await login(ids.owner, '1234');
  for (const c of devSeedCommands()) expect((await send(c.type, c.payload, { token: owner })).ok).toBe(true);
  const orderId = (await send('OpenTable', { tableId: ids.t1, covers: 2 }, { token: owner })).order!.id;
  await send('AddItems', { items: [{ id: newId(), itemId: ids.dal, qty: 2 }] }, { token: owner, orderId, expectedVersion: 1 });
  await send('FireKOT', { all: true }, { token: owner, orderId, expectedVersion: 2 });
  const printed = await send('PrintBill', {}, { token: owner, orderId, expectedVersion: 3 });
  expect(printed.ok).toBe(true);
  return { owner, billId: printed.result!.billId as string, orderId };
}
const lastDoc = (billId: string) => JSON.parse((db.prepare('SELECT doc_json FROM bill_document WHERE bill_id = ? ORDER BY revision DESC LIMIT 1').get(billId) as { doc_json: string }).doc_json) as Record<string, unknown>;
const printedEvent = () => JSON.parse((db.prepare("SELECT payload_json FROM outbox WHERE kind = 'bill.printed' ORDER BY seq DESC LIMIT 1").get() as { payload_json: string }).payload_json) as Record<string, unknown>;

describe('bills on WhatsApp', () => {
  it('the QR: printed only when switched on and linked; the bill goes up with bill.printed under the same code', async () => {
    link();
    qrOn(true);
    const { billId } = await billed();
    const code = shareCode(db, billId);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
    expect(shareCode(db, billId)).toBe(code); // the same every time (reprints, "Send")
    expect(shareCode(db, newId())).not.toBe(code);
    expect(lastDoc(billId).whatsappQr).toEqual({ url: `https://hub.test/wa/bill/${code}` });
    const ev = printedEvent();
    const share = ev.share as { code: string; receipt: ReturnType<typeof hubBill> };
    expect(share.code).toBe(code);
    expect(share.receipt).toMatchObject({ billNo: ev.billNo, totalPaise: ev.totalPaise, title: 'Tax invoice', orderLabel: 'Table T1', issuedAt: '2026-11-02T08:00:00.000Z' });
    expect(share.receipt.lines[0]).toMatchObject({ name: 'Dal Makhani', qty: '2' });
    expect(share.receipt.summary.map((s) => s.label)).toEqual(expect.arrayContaining(['Subtotal', 'CGST @2.5%', 'SGST @2.5%']));
    // the figures add up to the total, as printed
    expect(share.receipt.summary.slice(1).reduce((s, x) => s + x.amountPaise, share.receipt.summary[0]!.amountPaise)).toBe(share.receipt.totalPaise);
  }, 20_000);

  it('the QR: off by default, and never without the cloud link', async () => {
    qrOn(true); // switched on, but not linked
    const { billId } = await billed();
    expect(lastDoc(billId).whatsappQr).toBeUndefined();
    expect(printedEvent().share).toBeUndefined();
  }, 20_000);

  it('Send on WhatsApp: posts the bill with its payments to the cloud; checks the number, the right, the bill and the link', async () => {
    const { owner, billId, orderId } = await billed();
    const cashier = await login(ids.cashier, '1111');
    const captain = await login(ids.captain, '3333');
    const post = (token: string, mobile: string, id = billId) => app.inject({ method: 'POST', url: `/v1/bills/${id}/whatsapp`, headers: { 'x-user-session': token }, payload: { mobile } });

    // not linked yet
    expect((await app.inject({ method: 'GET', url: '/v1/whatsapp', headers: { 'x-user-session': cashier } })).json()).toEqual({ linked: false, bills: false });
    expect((await post(cashier, '9876543210')).statusCode).toBe(422);
    link();
    expect((await app.inject({ method: 'GET', url: '/v1/whatsapp', headers: { 'x-user-session': cashier } })).json()).toEqual({ linked: true, bills: true });

    expect((await post(captain, '9876543210')).statusCode).toBe(403);
    expect((await post(cashier, '12345')).statusCode).toBe(400);
    expect((await post(cashier, '9876543210', newId())).statusCode).toBe(404);

    const total = (await send('PrintBill', {}, { token: owner, orderId, expectedVersion: 4 })).ok; // already printed: refused, nothing changes
    expect(total).toBe(false);
    await send('Settle', { billId, tenders: [{ mode: 'upi', amountPaise: printedEvent().totalPaise as number }] }, { token: owner, orderId, expectedVersion: 4 });

    hubCalls = [];
    const r = await post(cashier, '+91 98765 43210');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ sent: true, to: '98******10' });
    expect(hubCalls).toHaveLength(1);
    const c = hubCalls[0]!;
    expect(c.url).toBe(`https://hub.test/v1/pos/bills/${shareCode(db, billId)}/whatsapp`);
    expect(c.auth).toBe('Bearer tpk_device');
    expect(c.body).toMatchObject({ mobile: '9876543210', billId, bill: { billNo: printedEvent().billNo, payments: [{ mode: 'UPI', amountPaise: printedEvent().totalPaise }] } });

    // the cloud refuses (not set up there): its message comes back
    hubAnswer = { status: 409, body: { error: { code: 'WHATSAPP_NOT_SET_UP', message: 'Sending bills on WhatsApp is not set up on PosiNext Cloud yet.' } } };
    const refused = await post(cashier, '9876543210');
    expect(refused.statusCode).toBe(422);
    expect(refused.json<{ error: { message: string } }>().error.message).toMatch(/not set up on PosiNext Cloud/);

    // a void bill is never sent
    await send('VoidBill', { billId, reason: 'Wrong table' }, { token: owner, orderId, expectedVersion: 5 });
    expect((await post(cashier, '9876543210')).statusCode).toBe(422);
  }, 30_000);

  it('mobile numbers', () => {
    expect(indianMobile('+91 98765 43210')).toBe('9876543210');
    expect(indianMobile('09876543210')).toBe('9876543210');
    expect(indianMobile('5876543210')).toBeNull();
    expect(indianMobile('98765')).toBeNull();
  });
});
