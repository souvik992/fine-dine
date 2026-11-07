import type { ReservationDay, Waitlist } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';
import { useApp } from '../app-context.js';

/** Floor header: Reservation, with how many table reservations are still to come today and guests waiting (P4-04). */
export function BookingsButton({ onClick }: { onClick: () => void }) {
  const { api } = useApp();
  const waitlist = useQuery({ queryKey: ['waitlist'], queryFn: () => api.get<Waitlist>('/v1/waitlist'), refetchInterval: 60_000 });
  const today = useQuery({ queryKey: ['reservations', 'today'], queryFn: () => api.get<ReservationDay>('/v1/reservations'), refetchInterval: 60_000 });
  const waiting = waitlist.data?.entries.length ?? 0;
  const toCome = today.data?.reservations.filter((r) => r.status === 'booked').length ?? 0;
  return (
    <button className="btn relative h-10" onClick={onClick} title={`Table reservations today: ${toCome} to come · waitlist: ${waiting}`}>
      <CalendarClock className="h-4 w-4" /> Reservation
      <span className="rounded-full bg-muted px-1.5 text-xs font-bold tabular-nums" aria-label={`${toCome} reservations to come`} data-reservations-count>
        {toCome}
      </span>
      {waiting ? (
        <span className="absolute -right-1.5 -top-1.5 rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground" aria-label={`${waiting} waiting`}>
          {waiting}
        </span>
      ) : null}
    </button>
  );
}
