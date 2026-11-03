import { addToWaitlistSchema, newId } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { bookingsChanged } from './reservation-support.js';

/** A walk-in waiting for a table (P4-04), with the wait they were told. */
export const addToWaitlist = defineCommand({
  type: 'AddToWaitlist',
  schema: addToWaitlistSchema,
  right: 'reservation.manage',
  needsOrder: false,
  apply(ctx, p) {
    const id = p.id ?? newId();
    if (ctx.db.prepare('SELECT 1 FROM waitlist_entry WHERE id = ?').get(id)) throw new PosError('INVALID_STATE', 'That waitlist id is already in use.', { id });
    ctx.db
      .prepare(
        `INSERT INTO waitlist_entry (id, guest_name, phone, party_size, quoted_min, note, status, joined_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, ?)`,
      )
      .run(id, p.guestName, p.phone, p.partySize, p.quotedMin, p.note, ctx.nowIso, ctx.actor.userId);
    ctx.audit({ entity: 'waitlist_entry', entityId: id, action: 'waitlist.add', after: { guestName: p.guestName, partySize: p.partySize, quotedMin: p.quotedMin } });
    bookingsChanged(ctx, { waitlistEntryId: id });
    return { result: { entryId: id } };
  },
});
