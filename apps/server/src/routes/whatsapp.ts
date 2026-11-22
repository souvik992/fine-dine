// Bills on WhatsApp (Today's bills › "Send on WhatsApp"): the server posts the printed bill to PosiNext Cloud, which
// sends it to the guest's mobile with an approved WhatsApp template (posinext-cloud hub/src/whatsapp-bills.ts).
// Nothing is written here: the cloud keeps the record of what was sent.
import type { BillDocument } from '@dinepos/printing';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRight } from '../auth/require-right.js';
import { PosError } from '../core/errors.js';
import type { Db } from '../db/connection.js';
import { cloudLink, hubBill, shareCode } from '../cloud/whatsapp-bill.js';

const sendBody = z.object({ mobile: z.string().trim().min(1).max(20) }).strict();

/** 10 digits for an Indian mobile (+91 / 0 in front taken off), else null. */
export function indianMobile(s: string): string | null {
  let d = s.replace(/\D/g, '');
  if (d.length > 10) d = d.replace(/^(0091|91|0)/, '');
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

export function whatsappRoutes(app: FastifyInstance, deps: { db: Db; now: () => Date; fetch?: typeof fetch }): void {
  const { db, now } = deps;
  const hubFetch = deps.fetch ?? ((input, init) => fetch(input, init));
  /** Calls the cloud; its refusal comes back as a PosError with the cloud's message. */
  const callHub = async <T>(path: string, init: RequestInit): Promise<T> => {
    const link = cloudLink(db);
    if (!link) throw new PosError('INVALID_STATE', 'Link this outlet with PosiNext Cloud first (Settings › Online orders).');
    let res: Response;
    try {
      res = await hubFetch(`${link.url}${path}`, { ...init, headers: { authorization: `Bearer ${link.key}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new PosError('INTERNAL', 'Could not reach PosiNext Cloud. Check the internet and try again.', undefined, 503);
    }
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    if (!res.ok) {
      const msg = body?.error?.message ?? `PosiNext Cloud answered ${res.status}.`;
      if (res.status === 401) throw new PosError('INVALID_STATE', 'This outlet is no longer linked with PosiNext Cloud. Link it again in Settings › Online orders.');
      if (res.status === 400) throw new PosError('VALIDATION', msg);
      if (res.status === 409 || res.status === 404) throw new PosError('INVALID_STATE', msg);
      if (res.status === 429) throw new PosError('RATE_LIMITED', msg);
      throw new PosError('INTERNAL', msg, undefined, 502);
    }
    return body as T;
  };

  /** Whether the cloud can send bills to a number now (the button shows only then). Never fails: false when unsure. */
  app.get('/v1/whatsapp', async (req, reply) => {
    requireRight(db, req, 'bill.settle', now());
    let bills = false;
    if (cloudLink(db)) bills = (await callHub<{ bills?: boolean }>('/v1/pos/whatsapp', { method: 'GET' }).catch(() => null))?.bills === true;
    return reply.header('cache-control', 'no-store').send({ linked: cloudLink(db) !== null, bills });
  });

  app.post<{ Params: { billId: string } }>('/v1/bills/:billId/whatsapp', async (req) => {
    requireRight(db, req, 'bill.settle', now());
    const p = sendBody.safeParse(req.body);
    const mobile = p.success ? indianMobile(p.data.mobile) : null;
    if (!mobile) throw new PosError('VALIDATION', "Enter the guest's 10-digit mobile number.");
    const bill = db.prepare('SELECT id, state, printed_at FROM bill WHERE id = ?').get(req.params.billId) as { id: string; state: string; printed_at: string | null } | undefined;
    if (!bill) throw new PosError('NOT_FOUND', 'That bill was not found.');
    if (bill.state === 'void' || bill.state === 'superseded') throw new PosError('INVALID_STATE', 'This bill is void: it cannot be sent.');
    const row = db.prepare('SELECT doc_json FROM bill_document WHERE bill_id = ? ORDER BY revision DESC LIMIT 1').get(bill.id) as { doc_json: string } | undefined;
    if (!row) throw new PosError('INVALID_STATE', 'This bill has not been printed yet.');
    const doc = JSON.parse(row.doc_json) as BillDocument;
    const payments = db.prepare('SELECT mode, sum(amount_paise) AS amountPaise FROM payment WHERE bill_id = ? GROUP BY mode HAVING sum(amount_paise) <> 0 ORDER BY mode').all(bill.id) as Array<{ mode: string; amountPaise: number }>;
    const sent = await callHub<{ sent: boolean; to: string }>(`/v1/pos/bills/${shareCode(db, bill.id)}/whatsapp`, {
      method: 'POST',
      body: JSON.stringify({ mobile, billId: bill.id, bill: hubBill(doc, bill.printed_at ?? now().toISOString(), payments) }),
    });
    return { sent: true, to: sent.to, billNo: doc.billNo };
  });
}
