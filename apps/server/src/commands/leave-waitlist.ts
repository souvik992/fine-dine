import { leaveWaitlistSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { bookingsChanged } from './reservation-support.js';
import { requireWaiting } from './waitlist-support.js';

/** The guest left, or the entry was a mistake: off the waitlist (kept for the record). */
export const leaveWaitlist = defineCommand({
  type: 'LeaveWaitlist',
  schema: leaveWaitlistSchema,
  right: 'reservation.manage',
  needsOrder: false,
  apply(ctx, p) {
    const e = requireWaiting(ctx, p.entryId);
    ctx.db.prepare('UPDATE waitlist_entry SET status = ?, closed_at = ? WHERE id = ?').run(p.outcome, ctx.nowIso, e.id);
    ctx.audit({
      entity: 'waitlist_entry',
      entityId: e.id,
      action: p.outcome === 'left' ? 'waitlist.left' : 'waitlist.cancel',
      before: { status: 'waiting' },
      after: { status: p.outcome },
    });
    bookingsChanged(ctx, { waitlistEntryId: e.id });
    return { result: { entryId: e.id, status: p.outcome } };
  },
});
