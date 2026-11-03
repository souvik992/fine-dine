// The walk-in waitlist (P4-04).
import type { CommandContext } from '../core/context.js';
import { PosError } from '../core/errors.js';

export interface WaitlistRow {
  id: string;
  guest_name: string;
  party_size: number;
  status: 'waiting' | 'seated' | 'left' | 'cancelled';
}

/** A waitlist entry that is still waiting. */
export function requireWaiting(ctx: CommandContext, entryId: string): WaitlistRow {
  const e = ctx.db.prepare('SELECT id, guest_name, party_size, status FROM waitlist_entry WHERE id = ?').get(entryId) as WaitlistRow | undefined;
  if (!e) throw new PosError('NOT_FOUND', 'That guest is not on the waitlist.', { entryId });
  if (e.status !== 'waiting') throw new PosError('INVALID_STATE', `${e.guest_name} is no longer waiting (${e.status}).`, { status: e.status });
  return e;
}
