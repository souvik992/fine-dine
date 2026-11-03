// Pure helpers for the Bookings screen (P4-04, tested).
import type { ReservationStatus, WaitlistEntry } from '@dinepos/shared';

/** The terminal's own time zone: it sits in the outlet. */
export const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

export const STATUS_LABEL: Record<ReservationStatus, string> = { booked: 'Booked', seated: 'Seated', cancelled: 'Cancelled', no_show: 'No-show' };

/** "2026-11-03" + "19:30" on this terminal's clock → an instant the server stores as UTC. */
export function toInstant(date: string, time: string): string {
  return new Date(`${date}T${time.length === 5 ? `${time}:00` : time}`).toISOString();
}

/** Red once the guest has waited longer than they were told, amber in the last 5 minutes of it. */
export function waitClass(e: Pick<WaitlistEntry, 'waitedMin' | 'quotedMin'>): string {
  if (e.quotedMin === undefined) return '';
  if (e.waitedMin > e.quotedMin) return 'text-danger';
  return e.quotedMin - e.waitedMin <= 5 ? 'text-warn' : '';
}
