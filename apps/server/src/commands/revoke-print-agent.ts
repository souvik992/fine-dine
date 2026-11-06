import { revokePrintAgentSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';

/** P6-03: the agent's key stops working at once; its printers go back to being printed by the server itself. */
export const revokePrintAgent = defineCommand({
  type: 'RevokePrintAgent',
  schema: revokePrintAgentSchema,
  right: 'admin',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    const a = ctx.db.prepare('SELECT name, revoked_at FROM print_agent WHERE id = ?').get(p.agentId) as { name: string; revoked_at: string | null } | undefined;
    if (!a) throw new PosError('NOT_FOUND', 'Print agent not found.', { agentId: p.agentId });
    if (a.revoked_at) throw new PosError('INVALID_STATE', 'This print agent was already removed.');
    const printers = ctx.db.prepare('SELECT printer_id FROM printer_agent WHERE agent_id = ?').pluck().all(p.agentId) as string[];
    ctx.db.prepare('DELETE FROM printer_agent WHERE agent_id = ?').run(p.agentId);
    ctx.db.prepare('UPDATE print_agent SET revoked_at = ? WHERE id = ?').run(ctx.nowIso, p.agentId);
    ctx.audit({ entity: 'print_agent', entityId: p.agentId, action: 'print_agent.revoke', before: { name: a.name, printers } });
    ctx.emit('printers', 'print_agent.changed', { agentId: p.agentId });
    return { result: { printers } };
  },
});
