import { addOrMerge, changeBy, firedByKot, hasChoices, needsChoices, orderView, visibleItems, type OrderView, type ViewItem } from '@dinepos/client';
import { formatINR, newId, type MenuItem, type MenuSnapshot } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Clock, DoorOpen, Minus, Plus, ReceiptText, Search, Send, ShoppingBasket, Trash2, TriangleAlert, Users, WifiOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useApp } from '../app-context.js';
import { Sheet } from '../components/Sheet.js';
import { fireItemIds } from '../offline/pending-model.js';
import { useSync, type Change } from '../offline/sync-context.js';
import { COURSES, fireChoices, heldByCourse, heldSummary, kotText } from '../order-model.js';
import { OptionsSheet, type OptionsResult } from './OptionsSheet.js';

type FireChoice = { all: true } | { course: number };

/**
 * Taking an order on the phone (docs/09 Captain): category chips and an item list with + buttons; a held basket
 * with course tags; Fire all / Fire course N; guests. Every change goes through the outbox (P3-03): shown at once,
 * sent now when the outlet server is reachable, or when it is back.
 */
export function OrderScreen({ orderId, areaId, onBack, onAttention }: { orderId: string; areaId: string | null; onBack: () => void; onAttention: () => void }) {
  const { can } = useApp();
  const sync = useSync();
  const base = useQuery({ queryKey: ['order', orderId], queryFn: () => sync.getOrder(orderId) });
  const menu = useQuery({ queryKey: ['menu', areaId ?? 'default'], queryFn: () => sync.cachedGet<MenuSnapshot>(`/v1/menu${areaId ? `?areaId=${areaId}` : ''}`) });
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [course, setCourse] = useState(1);
  const [options, setOptions] = useState<MenuItem | null>(null);
  const [sheet, setSheet] = useState<'basket' | 'guests' | null>(null);

  const m = menu.data;
  const order = useMemo(() => orderView(orderId, base.data, sync.entries, m), [orderId, base.data, sync.entries, m]);
  const editable = order?.state === 'open' || order?.state === 'billed';
  const canEdit = editable && can('order.edit');
  const canFire = editable && can('kot.fire');

  const category = categoryId ?? m?.categories[0]?.id ?? null;
  const items = useMemo(() => (m ? visibleItems(m, category, query) : []), [m, category, query]);
  const inBasket = useMemo(() => {
    const n = new Map<string, number>();
    for (const i of order?.items ?? []) if (i.status === 'held') n.set(i.itemId, (n.get(i.itemId) ?? 0) + i.qty);
    return n;
  }, [order]);

  const change = (decide: (v: OrderView) => Change | null) => sync.change(orderId, m, decide);
  const add = (item: MenuItem, r: OptionsResult) => {
    const line = { id: newId(), itemId: item.id, variantId: r.variantId, qty: r.qty, addons: r.addonIds.map((addonId) => ({ addonId, qty: 1 })), note: r.note, course: r.course };
    change((v) => {
      const c = addOrMerge(v, line);
      if (c.type === 'AddItems') return { ...c, label: `Add ${r.qty} × ${item.name}` };
      return { ...c, label: `${item.name}: make it ${c.payload.qty}`, qtyFrom: v.items.find((i) => i.id === c.payload.orderItemId)?.qty };
    });
  };
  const tapItem = (item: MenuItem, viaPlus: boolean) => {
    if (!canEdit || !m) return;
    if (!item.available) return sync.notify('error', `${item.name} is sold out.`);
    if (needsChoices(m, item) || (!viaPlus && hasChoices(m, item))) return setOptions(item);
    add(item, { variantId: null, addonIds: [], qty: 1, note: null, course });
  };
  const step = (i: ViewItem, delta: number) =>
    change((v) => {
      const line = v.items.find((x) => x.id === i.id && x.status === 'held');
      if (!line) return null;
      if (line.qty + delta < 1) return { type: 'RemoveHeldItem', payload: { orderItemId: i.id }, label: `Remove ${i.name}` };
      const c = changeBy(v, i.id, delta);
      return c?.type === 'UpdateHeldItem' ? { ...c, label: `${i.name}: make it ${c.payload.qty}`, qtyFrom: line.qty } : null;
    });
  const moveCourse = (i: ViewItem, to: number) => change(() => ({ type: 'UpdateHeldItem', payload: { orderItemId: i.id, course: to }, label: `${i.name}: course ${to}` }));
  const fire = (choice: FireChoice) => {
    change((v) => {
      const itemIds = fireItemIds(v, choice);
      return itemIds.length ? { type: 'FireKOT', payload: { itemIds }, label: 'all' in choice ? 'Send all to the kitchen' : `Send course ${choice.course} to the kitchen` } : null;
    });
    if (!sync.online) sync.notify('ok', 'Queued: it goes to the kitchen as soon as the phone reaches the outlet server.');
    if (order && ('all' in choice || heldByCourse(order.items).length <= 1)) setSheet(null);
  };

  // Request bill (P3-04): once something was sent and nothing waits; needs the server (the counter must hear now).
  const canAskBill = order?.state === 'open' && can('order.edit') && order.items.some((i) => i.status === 'fired' && !i.queuedFire);
  const askBill = () => {
    if (!sync.online) return sync.notify('error', 'Asking for the bill needs the outlet server. Try again when the phone is back on the Wi-Fi.');
    change(() => ({ type: 'RequestBill', payload: {}, label: 'Ask for the bill' }));
    sync.notify('ok', `The counter has been asked for Table ${order?.table?.label ?? ''}’s bill.`);
  };

  // Release table: nothing sent to the kitchen and no bill, so nothing to bill. Needs the server (the table is freed now).
  const canRelease = order?.state === 'open' && order.bills.length === 0 && order.items.every((i) => i.status !== 'fired' && !i.queuedFire) && can('order.create');
  const release = () => {
    if (!sync.online) return sync.notify('error', 'Releasing a table needs the outlet server. Try again when the phone is back on the Wi-Fi.');
    if (!window.confirm(`Release Table ${order?.table?.label ?? ''}? Nothing was sent to the kitchen, so the table becomes free.`)) return;
    change(() => ({ type: 'ReleaseTable', payload: {}, label: 'Release the table' }));
    sync.notify('ok', `Table ${order?.table?.label ?? ''} is free.`);
    onBack();
  };

  const held = heldSummary(order?.items ?? []);
  const choices = canFire ? fireChoices(order?.items ?? []) : [];
  const label = order?.table?.label ?? '';

  if (!order && !base.isPending) {
    return (
      <main className="flex min-h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="font-semibold">{base.error ? 'Could not load this order.' : 'This table is not seated any more.'}</p>
        <button className="btn" onClick={onBack}>
          Back to tables
        </button>
      </main>
    );
  }

  return (
    <div className="flex min-h-full flex-col pb-28">
      <header className="sticky top-0 z-10 border-b border-border bg-card px-3 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <button className="btn h-11 w-11 px-0" onClick={onBack} aria-label="Back to tables">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <h1 className="font-display text-2xl font-semibold">{label ? `Table ${label}` : 'Order'}</h1>
          <button className="btn ml-auto h-11 px-3" onClick={() => setSheet('guests')} disabled={!order} aria-label={`Guests: ${order?.covers ?? 0}`}>
            <Users className="h-5 w-5" /> {order?.covers ?? '–'}
          </button>
          <span className="min-w-20 text-right text-lg font-bold tabular-nums" data-testid="order-total">
            {order ? formatINR(order.totals.totalPaise) : ''}
          </span>
        </div>
        <label className="relative mt-2 block">
          <Search className="pointer-events-none absolute left-3 top-3.5 h-5 w-5 text-muted-foreground" />
          <input className="input pl-10" placeholder="Search dish or code" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the menu" />
        </label>
        {!query ? (
          <nav role="tablist" aria-label="Categories" className="no-scrollbar -mx-1 mt-2 flex gap-1 overflow-x-auto px-1">
            {m?.categories.map((c) => (
              <button key={c.id} role="tab" className="tab" aria-selected={c.id === category} onClick={() => setCategoryId(c.id)}>
                {c.name}
              </button>
            ))}
          </nav>
        ) : null}
        <div className="mt-2 flex items-center gap-1.5" role="radiogroup" aria-label="Add to course">
          <span className="mr-1 text-sm font-semibold text-muted-foreground">Course</span>
          {COURSES.map((c) => (
            <button key={c} role="radio" aria-checked={course === c} className={`h-9 w-9 rounded-full text-sm font-bold ${course === c ? 'bg-primary text-primary-foreground' : 'border border-border bg-card'}`} onClick={() => setCourse(c)}>
              {c}
            </button>
          ))}
        </div>
      </header>

      {!sync.online ? (
        <p role="status" className="flex items-center gap-2 bg-warn/30 px-4 py-2 text-sm font-semibold">
          <WifiOff className="h-4 w-4 shrink-0" /> Offline: keep taking the order. It is kept on this phone and sent when the connection is back.
        </p>
      ) : null}
      {order?.attention ? (
        <button className="flex items-center gap-2 bg-danger px-4 py-2 text-left text-sm font-semibold text-white" onClick={onAttention}>
          <TriangleAlert className="h-4 w-4 shrink-0" /> A change to this table was refused. Open Needs attention.
        </button>
      ) : order?.waiting ? (
        <p role="status" className="flex items-center gap-2 bg-secondary px-4 py-2 text-sm font-semibold" data-testid="order-waiting">
          <Clock className="h-4 w-4 shrink-0" /> {order.waiting} change{order.waiting === 1 ? '' : 's'} waiting to send
        </p>
      ) : null}
      {order?.billRequest && order.state === 'open' ? (
        <p role="status" className="flex items-center gap-2 bg-[var(--bill)] px-4 py-2 text-sm font-semibold" data-testid="bill-requested">
          <ReceiptText className="h-4 w-4 shrink-0" /> Bill asked at {new Date(order.billRequest.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          {order.billRequest.byName ? ` by ${order.billRequest.byName}` : ''}. The counter has been told.
        </p>
      ) : null}
      {order && !editable ? (
        <p role="status" className="bg-secondary px-4 py-3 font-semibold">
          This order is {order.state === 'merged' ? 'merged into another table' : order.state}. It can no longer be changed here.
        </p>
      ) : order?.state === 'billed' ? (
        <p role="status" className="bg-secondary px-4 py-2 text-sm font-semibold">
          The bill is printed. Anything you send now needs a fresh bill at the counter.
        </p>
      ) : null}

      <ul className="flex-1 divide-y divide-border" aria-label="Menu">
        {items.map((it) => (
          <li key={it.id} className={`flex items-center gap-3 px-4 py-2.5 ${it.available ? '' : 'opacity-50'}`} data-item={it.name}>
            <button className="min-w-0 flex-1 text-left" onClick={() => tapItem(it, false)} disabled={!canEdit}>
              <span className="flex items-center gap-2 font-semibold">
                <VegMark veg={it.veg} />
                <span className="truncate">{it.name}</span>
              </span>
              <span className="flex gap-2 text-sm text-muted-foreground">
                <span className="tabular-nums">{it.variants.length ? `from ${formatINR(Math.min(...it.variants.map((v) => v.pricePaise)))}` : formatINR(it.pricePaise)}</span>
                {!it.available ? <span className="font-bold uppercase text-danger">Sold out</span> : m && hasChoices(m, it) ? <span>· options</span> : null}
                {inBasket.get(it.id) ? <span className="font-semibold text-primary">· {inBasket.get(it.id)} in basket</span> : null}
              </span>
            </button>
            <button className="btn h-12 w-12 shrink-0 px-0" onClick={() => tapItem(it, true)} disabled={!canEdit || !it.available} aria-label={`Add ${it.name}`}>
              <Plus className="h-6 w-6" />
            </button>
          </li>
        ))}
        {m && items.length === 0 ? <li className="p-6 text-center text-muted-foreground">{query ? 'No dish matches.' : 'No dishes in this category.'}</li> : null}
        {!m && !menu.error ? <li className="p-6 text-center text-muted-foreground">Loading the menu…</li> : null}
        {menu.error && !m ? <li className="p-6 text-center text-muted-foreground">The menu is not on this phone yet. Connect to the outlet Wi-Fi once.</li> : null}
      </ul>

      <footer className="fixed inset-x-0 bottom-0 z-10 flex gap-2 border-t border-border bg-card p-3 pb-5">
        {canRelease ? (
          <button className="btn" onClick={release} aria-label="Release table" title="Nothing to bill: free the table">
            <DoorOpen className="h-5 w-5" />
          </button>
        ) : null}
        <button className="btn flex-1 justify-between" onClick={() => setSheet('basket')} disabled={!order} aria-label="Basket">
          <span className="flex items-center gap-2">
            <ShoppingBasket className="h-5 w-5" />
            {held.qty ? `${held.qty} to send` : 'Order'}
          </span>
          {held.qty ? <span className="tabular-nums">{formatINR(held.amountPaise)}</span> : null}
        </button>
        {choices[0] ? (
          <button className="btn btn-primary" onClick={() => fire(choices[0]!.payload)}>
            <Send className="h-5 w-5" /> Fire all
          </button>
        ) : canAskBill ? (
          <button className="btn btn-primary" onClick={askBill}>
            <ReceiptText className="h-5 w-5" /> {order?.billRequest ? 'Ask again' : 'Request bill'}
          </button>
        ) : null}
      </footer>

      {options && m ? (
        <OptionsSheet
          menu={m}
          item={options}
          course={course}
          onClose={() => setOptions(null)}
          onAdd={(r) => {
            add(options, r);
            setOptions(null);
          }}
        />
      ) : null}
      {sheet === 'basket' && order ? <BasketSheet order={order} canEdit={canEdit} choices={choices} onFire={fire} onStep={step} onMoveCourse={moveCourse} onClose={() => setSheet(null)} /> : null}
      {sheet === 'guests' && order ? (
        <GuestsSheet
          covers={order.covers}
          locked={!sync.online ? 'Guests can change only while the phone reaches the outlet server.' : order.state !== 'open' ? 'Guests cannot change once the bill is printed.' : !can('order.edit') ? 'Your role cannot change guests.' : null}
          onClose={() => setSheet(null)}
          onSave={(covers) => {
            setSheet(null);
            change(() => ({ type: 'SetCovers', payload: { covers }, label: `Guests: ${covers}` }));
          }}
        />
      ) : null}
    </div>
  );
}

function VegMark({ veg }: { veg: boolean }) {
  return (
    <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border-2 ${veg ? 'border-ok' : 'border-danger'}`} aria-label={veg ? 'Veg' : 'Non-veg'}>
      <span className={`h-1.5 w-1.5 rounded-full ${veg ? 'bg-ok' : 'bg-danger'}`} />
    </span>
  );
}

function lineDetail(i: ViewItem): string {
  return [...i.addons.map((a) => a.name), i.note].filter(Boolean).join(' · ');
}

/** What is waiting by course (change quantity, remove), what is queued for the kitchen, and what was sent, by KOT. */
function BasketSheet({
  order,
  canEdit,
  choices,
  onFire,
  onStep,
  onMoveCourse,
  onClose,
}: {
  order: OrderView;
  canEdit: boolean;
  choices: ReturnType<typeof fireChoices>;
  onFire: (p: FireChoice) => void;
  onStep: (i: ViewItem, delta: number) => void;
  onMoveCourse: (i: ViewItem, course: number) => void;
  onClose: () => void;
}) {
  const groups = heldByCourse(order.items);
  const queued = order.items.filter((i) => i.queuedFire);
  const sent = firedByKot(order.items);

  return (
    <Sheet
      title={`Table ${order.table?.label ?? ''} order`}
      onClose={onClose}
      footer={
        choices.length ? (
          <div className="flex flex-wrap gap-2">
            {choices.map((c, n) => (
              <button key={c.label} className={`btn whitespace-nowrap ${n === 0 ? 'btn-primary w-full' : 'flex-1 px-2 text-sm'}`} onClick={() => onFire(c.payload)}>
                <Send className="h-4 w-4" /> {c.label} ({c.qty})
              </button>
            ))}
          </div>
        ) : undefined
      }
    >
      {groups.length === 0 ? <p className="mb-4 text-muted-foreground">Nothing waiting to be sent.</p> : null}
      {groups.map((g) => (
        <section key={g.course} className="mb-4" aria-label={`Course ${g.course}`}>
          <h3 className="mb-1 flex justify-between text-sm font-bold uppercase tracking-wide text-muted-foreground">
            <span>Course {g.course}</span>
            <span className="tabular-nums">{formatINR(g.amountPaise)}</span>
          </h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {(g.items as ViewItem[]).map((i) => (
              <li key={i.id} className="flex items-center gap-2 p-2" data-line={i.name}>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{i.name}</span>
                  {lineDetail(i) ? <span className="block text-sm text-muted-foreground">{lineDetail(i)}</span> : null}
                  {i.waiting ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                      <Clock className="h-3 w-3" /> on this phone, not sent yet
                    </span>
                  ) : null}
                  {canEdit ? (
                    <select className="mt-1 h-8 rounded border border-border bg-card px-1 text-sm" value={i.course} onChange={(e) => onMoveCourse(i, Number(e.target.value))} aria-label={`Course for ${i.name}`}>
                      {COURSES.map((c) => (
                        <option key={c} value={c}>
                          Course {c}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </span>
                {canEdit ? (
                  <span className="flex items-center gap-1">
                    <button className="btn h-10 w-10 px-0" onClick={() => onStep(i, -1)} aria-label={i.qty === 1 ? `Remove ${i.name}` : `One less ${i.name}`}>
                      {i.qty === 1 ? <Trash2 className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                    </button>
                    <span className="w-7 text-center font-bold tabular-nums">{i.qty}</span>
                    <button className="btn h-10 w-10 px-0" onClick={() => onStep(i, 1)} aria-label={`One more ${i.name}`}>
                      <Plus className="h-4 w-4" />
                    </button>
                  </span>
                ) : (
                  <span className="font-bold tabular-nums">× {i.qty}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {queued.length ? (
        <section aria-label="Queued for the kitchen" className="mb-3">
          <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-muted-foreground">Queued — not in the kitchen yet</h3>
          <ul className="rounded-lg border-2 border-dashed border-border p-2">
            {queued.map((i) => (
              <li key={i.id} className="text-sm">
                {i.qty} × {i.name} <span className="text-muted-foreground">· course {i.course}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {sent.length ? (
        <section aria-label="Sent to the kitchen">
          <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-muted-foreground">Sent to the kitchen</h3>
          {sent.map((k) => (
            <div key={k.kotNo} className="mb-2 rounded-lg bg-secondary p-2">
              <p className="text-xs font-bold">{kotText(k.kotNo)}</p>
              <ul>
                {k.items.map((i) => (
                  <li key={i.id} className={`flex justify-between text-sm ${i.status === 'cancelled' ? 'text-muted-foreground line-through' : ''}`}>
                    <span>
                      {i.qty} × {i.name} <span className="text-muted-foreground">· course {i.course}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}
      <p className="mt-2 flex justify-between text-lg font-bold">
        <span>Running total</span>
        <span className="tabular-nums">{formatINR(order.totals.totalPaise)}</span>
      </p>
    </Sheet>
  );
}

function GuestsSheet({ covers: initial, locked, onSave, onClose }: { covers: number; locked: string | null; onSave: (covers: number) => void; onClose: () => void }) {
  const [covers, setCovers] = useState(Math.max(1, initial));
  return (
    <Sheet title="Guests" onClose={onClose}>
      {locked ? (
        <p className="mb-4">{locked}</p>
      ) : (
        <>
          <div className="mb-5 flex items-center justify-center gap-6">
            <button className="btn h-16 w-16 px-0" onClick={() => setCovers(Math.max(1, covers - 1))} aria-label="One guest fewer" disabled={covers <= 1}>
              <Minus className="h-6 w-6" />
            </button>
            <span className="w-16 text-center text-5xl font-bold tabular-nums">{covers}</span>
            <button className="btn h-16 w-16 px-0" onClick={() => setCovers(Math.min(99, covers + 1))} aria-label="One more guest">
              <Plus className="h-6 w-6" />
            </button>
          </div>
          <button className="btn btn-primary w-full" onClick={() => onSave(covers)} disabled={covers === initial}>
            Save {covers} guest{covers === 1 ? '' : 's'}
          </button>
        </>
      )}
    </Sheet>
  );
}
