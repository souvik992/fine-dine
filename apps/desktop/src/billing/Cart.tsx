import { formatINR, type OrderItemSnapshot, type OrderSnapshot } from '@dinepos/shared';
import { Minus, Pencil, Plus, Printer, Trash2 } from 'lucide-react';
import { cartLineAmount, firedByKot } from './menu-model.js';

interface Props {
  order: OrderSnapshot;
  selectedId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onQty: (item: OrderItemSnapshot, qty: number) => void;
  onRemove: (item: OrderItemSnapshot) => void;
  /** Reduce or cancel a sent line (P2-04); absent when the order can no longer change. */
  onChangeSent?: (item: OrderItemSnapshot) => void;
  onReprintKot?: (kotId: string, kotNo: number) => void;
}

function LineMeta({ item }: { item: OrderItemSnapshot }) {
  return (
    <>
      {item.addons.map((a) => (
        <div key={a.addonId} className="text-xs text-muted-foreground">
          + {a.qty > 1 ? `${a.qty} × ` : ''}
          {a.name}
        </div>
      ))}
      {item.note ? <div className="text-xs italic text-muted-foreground">“{item.note}”</div> : null}
    </>
  );
}

/** Held lines (editable) then fired lines grouped by KOT (read-only, docs/09). Totals come from the server. */
export function Cart({ order, selectedId, busy, onSelect, onQty, onRemove, onChangeSent, onReprintKot }: Props) {
  const held = order.items.filter((i) => i.status === 'held');
  const kots = firedByKot(order.items);
  const courses = new Set(held.map((i) => i.course));

  return (
    <aside className="flex min-h-0 w-[380px] flex-1 shrink-0 flex-col border-l border-border bg-card" aria-label="Order">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <h2 className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wide text-muted-foreground">
          <span>Not sent yet</span>
          <span>{held.length} line{held.length === 1 ? '' : 's'}</span>
        </h2>
        {held.length === 0 ? <p className="mb-4 text-sm text-muted-foreground">Type a short code (e.g. pt2) and press Enter.</p> : null}
        <ul className="mb-4 space-y-1" aria-label="Held items" data-testid="held-items">
          {held.map((i) => (
            <li
              key={i.id}
              data-line={i.name}
              aria-selected={i.id === selectedId}
              onClick={() => onSelect(i.id)}
              className={`rounded-lg border p-2 ${i.id === selectedId ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-secondary'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">
                    {i.name}
                    {courses.size > 1 || i.course > 1 ? <span className="ml-2 rounded bg-secondary px-1.5 text-xs">C{i.course}</span> : null}
                  </div>
                  <LineMeta item={i} />
                </div>
                <span className="text-sm font-semibold tabular-nums">{formatINR(cartLineAmount(i))}</span>
              </div>
              <div className="mt-1 flex items-center gap-1">
                <button className="btn h-7 w-7 px-0" disabled={busy || i.qty <= 1} onClick={() => onQty(i, i.qty - 1)} aria-label={`One less ${i.name}`}>
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="w-8 text-center text-sm font-bold tabular-nums">{i.qty}</span>
                <button className="btn h-7 w-7 px-0" disabled={busy} onClick={() => onQty(i, i.qty + 1)} aria-label={`One more ${i.name}`}>
                  <Plus className="h-3.5 w-3.5" />
                </button>
                <button className="btn ml-auto h-7 w-7 px-0 text-danger" disabled={busy} onClick={() => onRemove(i)} aria-label={`Remove ${i.name}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>

        {kots.map((k) => (
          <section key={k.kotNo} className="mb-3" aria-label={`KOT ${k.kotNo}`} data-testid="kot-group">
            <h3 className="mb-1 flex items-center text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Sent · KOT {String(k.kotNo).padStart(4, '0')}
              {onReprintKot && k.kotId ? (
                <button className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 normal-case tracking-normal hover:bg-secondary" disabled={busy} onClick={() => onReprintKot(k.kotId!, k.kotNo)} aria-label={`Reprint KOT ${k.kotNo}`}>
                  <Printer className="h-3.5 w-3.5" /> Reprint
                </button>
              ) : null}
            </h3>
            <ul className="space-y-1">
              {k.items.map((i) =>
                i.status === 'cancelled' ? (
                  <li key={i.id} className="flex items-start justify-between gap-2 px-2 text-sm text-muted-foreground" aria-label={`${i.name} cancelled`}>
                    <span className="min-w-0 line-through">
                      <span className="tabular-nums">{i.qty} ×</span> {i.name}
                    </span>
                    <span className="text-xs font-semibold uppercase">Cancelled</span>
                  </li>
                ) : (
                  <li key={i.id} className="group flex items-start justify-between gap-2 px-2 text-sm">
                    <div className="min-w-0">
                      <span className="font-semibold tabular-nums">{i.qty} ×</span> {i.name}
                      <LineMeta item={i} />
                    </div>
                    <span className="flex items-center gap-1">
                      {onChangeSent ? (
                        <button className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground" disabled={busy} onClick={() => onChangeSent(i)} aria-label={`Change sent ${i.name}`} title="Reduce or cancel">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      <span className="tabular-nums text-muted-foreground">{formatINR(cartLineAmount(i))}</span>
                    </span>
                  </li>
                ),
              )}
            </ul>
          </section>
        ))}
      </div>

      <dl className="border-t border-border px-4 py-3 text-sm" aria-label="Totals">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd className="tabular-nums">{formatINR(order.totals.subtotalPaise)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">GST</dt>
          <dd className="tabular-nums">{formatINR(order.totals.taxPaise)}</dd>
        </div>
        <div className="mt-1 flex justify-between text-lg font-bold">
          <dt>Total</dt>
          <dd className="tabular-nums" data-testid="order-total">
            {formatINR(order.totals.totalPaise)}
          </dd>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Before discount, service charge and round-off (shown on the bill).</p>
      </dl>
    </aside>
  );
}
