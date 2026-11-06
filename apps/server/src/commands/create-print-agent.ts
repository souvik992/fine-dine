import { createPrintAgentSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';

/**
 * P6-03: a print agent (a program on a PC on the printers' network). The terminal made its key and shows it once; only
 * the key's hash comes here, so the key is in no database row, log or stored command result.
 */
export const createPrintAgent = defineCommand({
  type: 'CreatePrintAgent',
  schema: createPrintAgentSchema,
  right: 'admin',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    if (ctx.db.prepare('SELECT 1 FROM print_agent WHERE id = ? OR key_hash = ?').get(p.id, p.keyHash)) {
      throw new PosError('INVALID_STATE', 'This print agent already exists.', { agentId: p.id });
    }
    ctx.db.prepare('INSERT INTO print_agent (id, name, key_hash, created_at) VALUES (?, ?, ?, ?)').run(p.id, p.name, p.keyHash, ctx.nowIso);
    ctx.audit({ entity: 'print_agent', entityId: p.id, action: 'print_agent.create', after: { name: p.name } });
    ctx.emit('printers', 'print_agent.changed', { agentId: p.id });
    return { result: { id: p.id } };
  },
});
