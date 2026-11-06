import { setPrinterAgentSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';

/** P6-03: which print agent prints this printer's tickets (null: the server prints them itself). */
export const setPrinterAgent = defineCommand({
  type: 'SetPrinterAgent',
  schema: setPrinterAgentSchema,
  right: 'admin',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    if (!ctx.db.prepare('SELECT 1 FROM printer WHERE id = ?').get(p.printerId)) throw new PosError('NOT_FOUND', 'Printer not found.', { printerId: p.printerId });
    if (p.agentId) {
      const a = ctx.db.prepare('SELECT revoked_at FROM print_agent WHERE id = ?').get(p.agentId) as { revoked_at: string | null } | undefined;
      if (!a) throw new PosError('NOT_FOUND', 'Print agent not found.', { agentId: p.agentId });
      if (a.revoked_at) throw new PosError('INVALID_STATE', 'This print agent was removed. Add a new one.');
    }
    const before = (ctx.db.prepare('SELECT agent_id FROM printer_agent WHERE printer_id = ?').pluck().get(p.printerId) as string | undefined) ?? null;
    if (p.agentId) ctx.db.prepare('INSERT INTO printer_agent (printer_id, agent_id) VALUES (?, ?) ON CONFLICT(printer_id) DO UPDATE SET agent_id = excluded.agent_id').run(p.printerId, p.agentId);
    else ctx.db.prepare('DELETE FROM printer_agent WHERE printer_id = ?').run(p.printerId);
    ctx.audit({ entity: 'printer', entityId: p.printerId, action: 'printer.agent', before: { agentId: before }, after: { agentId: p.agentId } });
    ctx.emit('printers', 'printer.changed', { printerId: p.printerId });
    return { result: { agentId: p.agentId } };
  },
});
