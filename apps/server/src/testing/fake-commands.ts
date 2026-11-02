// Minimal handlers that exercise every pipeline feature. Test-only; real commands live in src/commands/.
import { ulidSchema } from '@dinepos/shared';
import { z } from 'zod';
import { createRegistry, defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';

export const testOpen = defineCommand({
  type: 'TestOpen',
  schema: z.object({ orderId: ulidSchema }).strict(),
  right: 'order.create',
  needsOrder: false,
  apply(ctx, p) {
    ctx.db
      .prepare(`INSERT INTO "order" (id, business_date, type, state, opened_at, opened_by) VALUES (?, ?, 'takeaway', 'open', ?, ?)`)
      .run(p.orderId, ctx.businessDate, ctx.nowIso, ctx.actor.userId);
    ctx.audit({ entity: 'order', entityId: p.orderId, action: 'order.open', after: { type: 'takeaway' } });
    return { orderId: p.orderId, result: { orderId: p.orderId } };
  },
});

export const testNote = defineCommand({
  type: 'TestNote',
  schema: z.object({ note: z.string().min(1).max(100), printerId: z.string().optional() }).strict(),
  right: 'order.edit',
  needsOrder: true,
  apply(ctx, p, order) {
    ctx.db.prepare('UPDATE "order" SET customer_name = ? WHERE id = ?').run(p.note, order!.id);
    ctx.audit({ entity: 'order', entityId: order!.id, action: 'order.note', after: { note: p.note }, leakage: p.note === 'leak' });
    ctx.emit('station:test', 'kot.created', { note: p.note });
    if (p.printerId) {
      ctx.print({ printerId: p.printerId, docKind: 'kot', refId: order!.id, bytes: new Uint8Array([0x1b, 0x40]), previewText: p.note });
    }
    ctx.outbox('order.note', { orderId: order!.id });
    return { result: { noted: p.note } };
  },
});

/** Writes rows, then fails: the pipeline must leave no trace. */
export const testFail = defineCommand({
  type: 'TestFail',
  schema: z.object({ crash: z.boolean().default(false) }).strict(),
  right: 'order.edit',
  needsOrder: true,
  apply(ctx, p, order) {
    ctx.db.prepare('UPDATE "order" SET customer_name = ? WHERE id = ?').run('half-written', order!.id);
    ctx.audit({ entity: 'order', entityId: order!.id, action: 'should.not.persist' });
    ctx.emit('floor', 'should.not.persist', {});
    if (p.crash) throw new Error('disk on fire');
    throw new PosError('INVALID_STATE', 'Cannot do that now.');
  },
});

export const testRegistry = createRegistry([testOpen, testNote, testFail]);
