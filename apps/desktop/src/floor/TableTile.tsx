import { formatINR, type FloorTable } from '@dinepos/shared';
import { Ban, CalendarClock, Circle, Flame, ReceiptText, Users } from 'lucide-react';
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
  const label = [table.label, meta.label, table.covers ? `${table.covers} covers` : '', elapsed, amount].filter(Boolean).join(', ');

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
        {table.seats ? <span className="text-xs opacity-70">{table.seats} seats</span> : null}
      </div>
      <div className="mt-2 space-y-1 text-sm">
        <div className="flex items-center gap-1.5 font-semibold">
          <Icon className="h-4 w-4" aria-hidden />
          <span>{meta.label}</span>
        </div>
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
