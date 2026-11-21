import { formatINR, type CounterOrder } from '@dinepos/shared';
import { Bike, Phone, Plus, ShoppingBag } from 'lucide-react';
import { useState } from 'react';
import { counterOrdersOf, COUNTER_TYPE_LABEL, STAGE_META, type CounterType } from './counter-model.js';
import { elapsedMinutes, formatElapsed } from './floor-model.js';

/**
 * The floor's strip for orders without a table: "New takeaway" / "New delivery", then one card per open order, oldest
 * first. A card opens the order to punch, bill or settle it, like a table tile.
 */
export function CounterOrders({
  orders,
  now,
  canCreate,
  onNew,
  onOpen,
}: {
  orders: CounterOrder[] | undefined;
  now: Date;
  canCreate: boolean;
  onNew: (type: CounterType) => void;
  onOpen: (orderId: string) => void;
}) {
  const [filter, setFilter] = useState<CounterType | 'all'>('all');
  const all = orders ?? [];
  const shown = counterOrdersOf(all, filter);
  const count = (t: CounterType) => all.filter((o) => o.type === t).length;

  return (
    <section className="mb-4 rounded-xl border border-border bg-card p-3" aria-label="Takeaway and delivery orders" data-testid="counter-orders">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-1 font-display text-base font-semibold">Takeaway &amp; delivery</h2>
        {all.length ? (
          <span className="flex gap-1" role="radiogroup" aria-label="Show">
            {(['all', 'takeaway', 'delivery'] as const).map((f) => (
              <button key={f} role="radio" aria-checked={filter === f} aria-selected={filter === f} className="tab h-7" onClick={() => setFilter(f)}>
                {f === 'all' ? `All ${all.length}` : `${COUNTER_TYPE_LABEL[f]} ${count(f)}`}
              </button>
            ))}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">No open takeaway or delivery orders.</span>
        )}
        {canCreate ? (
          <span className="ml-auto flex gap-2">
            <button className="btn btn-primary h-10" onClick={() => onNew('takeaway')} data-testid="new-takeaway">
              <ShoppingBag className="h-4 w-4" /> <Plus className="-ml-1 h-3.5 w-3.5" /> Takeaway
            </button>
            <button className="btn btn-primary h-10" onClick={() => onNew('delivery')} data-testid="new-delivery">
              <Bike className="h-4 w-4" /> <Plus className="-ml-1 h-3.5 w-3.5" /> Delivery
            </button>
          </span>
        ) : null}
      </div>

      {shown.length ? (
        <div className="mt-3 flex gap-3 overflow-x-auto pb-1" role="list">
          {shown.map((o) => (
            <CounterCard key={o.orderId} order={o} now={now} onOpen={onOpen} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function CounterCard({ order: o, now, onOpen }: { order: CounterOrder; now: Date; onOpen: (orderId: string) => void }) {
  const stage = STAGE_META[o.stage];
  const Icon = o.type === 'delivery' ? Bike : ShoppingBag;
  const title = `${COUNTER_TYPE_LABEL[o.type]}${o.ticketNo ? ` #${o.ticketNo}` : ''}`;
  const elapsed = formatElapsed(elapsedMinutes(o.since, now));
  const items = `${o.itemCount} item${o.itemCount === 1 ? '' : 's'}`;
  const label = [title, stage.label, o.customerName, o.customerPhone, o.address, items, elapsed, o.amountPaise ? formatINR(o.amountPaise) : ''].filter(Boolean).join(', ');

  return (
    <div role="listitem" className="shrink-0">
      <button type="button" className={`tile ${stage.className} w-56 min-h-0 text-left`} aria-label={label} onClick={() => onOpen(o.orderId)} data-counter={title} data-stage={o.stage}>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 font-display text-lg font-semibold leading-none">
            <Icon className="h-4 w-4" aria-hidden /> {title}
          </span>
          <span className="text-xs font-semibold tabular-nums opacity-80">{elapsed}</span>
        </div>
        <div className="mt-1.5 truncate text-sm font-semibold">{stage.label}</div>
        {o.customerName || o.customerPhone ? (
          <div className="mt-1 flex items-center gap-1 truncate text-xs">
            {o.customerName ? <span className="truncate font-semibold">{o.customerName}</span> : null}
            {o.customerPhone ? (
              <span className="flex items-center gap-0.5 opacity-80">
                <Phone className="h-3 w-3" aria-hidden /> {o.customerPhone}
              </span>
            ) : null}
          </div>
        ) : null}
        {o.address ? (
          <div className="mt-0.5 truncate text-xs opacity-80" title={o.address}>
            {o.address}
          </div>
        ) : null}
        <div className="mt-1.5 flex items-center justify-between text-xs opacity-80">
          <span>{items}</span>
          <span className="font-semibold tabular-nums">{o.amountPaise ? formatINR(o.amountPaise) : ''}</span>
        </div>
      </button>
    </div>
  );
}
