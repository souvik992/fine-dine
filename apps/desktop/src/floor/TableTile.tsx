import { initials } from '@dinepos/client';
import { formatINR, type FloorTable } from '@dinepos/shared';
import { Ban, CalendarClock, Circle, Flame, ReceiptText, Users } from 'lucide-react';
import { bookingTime } from './SeatDialog.js';
import { forwardRef, type ComponentType, type CSSProperties } from 'react';
import { formatElapsed, elapsedMinutes, STATE_META, type StateMeta } from './floor-model.js';

const ICONS: Record<StateMeta['icon'], ComponentType<{ className?: string }>> = {
  circle: Circle,
  users: Users,
  flame: Flame,
  receipt: ReceiptText,
  calendar: CalendarClock,
  ban: Ban,
};

interface Props {
  table: FloorTable;
  now: Date;
  focused: boolean;
  onOpen: (t: FloorTable) => void;
  onFocus: () => void;
  /** Position and size in the saved floor layout (layout view). */
  style?: CSSProperties;
}

export const TableTile = forwardRef<HTMLButtonElement, Props>(function TableTile({ table, now, focused, onOpen, onFocus, style }, ref) {
  const meta = STATE_META[table.state];
  const Icon = ICONS[meta.icon];
  const elapsed = formatElapsed(elapsedMinutes(table.since, now));
  const amount = table.amountPaise ? formatINR(table.amountPaise) : '';
  const label = [table.label, meta.label, table.covers ? `${table.covers} covers` : '', elapsed, amount, table.captainName ? `captain ${table.captainName}` : '', table.billRequest ? 'bill asked' : '', table.booking ? `booked ${bookingTime(table.booking.startsAt)} for ${table.booking.guestName}` : ''].filter(Boolean).join(', ');

  return (
    <button
      ref={ref}
      type="button"
      className={`tile ${meta.className}`}
      data-table={table.label}
      data-state={table.state}
      aria-label={label}
      tabIndex={focused ? 0 : -1}
      onFocus={onFocus}
      onClick={() => onOpen(table)}
      style={style}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-display text-2xl font-semibold leading-none">{table.label}</span>
        <span className="flex items-center gap-1">
          {table.captainName ? (
            <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[11px] font-bold" title={`Captain: ${table.captainName}`} data-testid="captain-initials">
              {initials(table.captainName)}
            </span>
          ) : null}
          {table.seats && !table.captainName ? <span className="text-xs opacity-70">{table.seats} seats</span> : null}
        </span>
      </div>
      <div className="mt-2 space-y-1 text-sm">
        <div className="flex items-center gap-1.5 font-semibold">
          <Icon className="h-4 w-4" aria-hidden />
          <span>{meta.label}</span>
        </div>
        {table.booking && !table.orderId ? (
          <div className="flex items-center gap-1 text-xs font-semibold" data-testid="booking">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden /> {bookingTime(table.booking.startsAt)} · {table.booking.guestName} ({table.booking.partySize})
          </div>
        ) : null}
        {table.billRequest ? (
          <div className="flex w-fit items-center gap-1 rounded bg-[var(--bill)] px-1.5 text-xs font-bold text-[var(--bill-ink)]" data-testid="bill-asked">
            <ReceiptText className="h-3.5 w-3.5" aria-hidden /> Bill asked
          </div>
        ) : null}
        {table.orderId ? (
          <div className="flex items-center justify-between gap-2 text-xs opacity-80">
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" aria-hidden /> {table.covers ?? 0}
              {elapsed ? <span className="ml-2">{elapsed}</span> : null}
            </span>
            <span className="font-semibold tabular-nums">{amount}</span>
          </div>
        ) : null}
      </div>
    </button>
  );
});
