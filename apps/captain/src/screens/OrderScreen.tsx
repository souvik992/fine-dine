import { addOrMerge, ApiError, changeBy, firedByKot, hasChoices, needsChoices, visibleItems } from '@dinepos/client';
import { formatINR, newId, type MenuItem, type MenuSnapshot, type OrderItemSnapshot, type OrderSnapshot } from '@dinepos/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Minus, Plus, Search, Send, ShoppingBasket, Trash2, Users, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../app-context.js';
import { Sheet } from '../components/Sheet.js';
import { COURSES, fireChoices, firedMessage, heldByCourse, heldSummary, kotText } from '../order-model.js';
import { useOrderSession } from '../use-order-session.js';
import { OptionsSheet, type OptionsResult } from './OptionsSheet.js';

type Toast = { kind: 'ok' | 'error'; text: string } | null;

/**
 * Taking an order on the phone (docs/09 Captain): category chips and an item list with + buttons; a held basket
 * with course tags; Fire all / Fire course N; guests. Every change is a command on the order's latest version,
 * through the same OrderSession the billing terminal uses.
 */
export function OrderScreen({ orderId, areaId, onBack }: { orderId: string; areaId: string | null; onBack: () => void }) {
  const { api, can, stream } = useApp();
  const qc = useQueryClient();
  const { session, order, error, changedElsewhere, conflict, dismissConflict } = useOrderSession(orderId);
  const menu = useQuery({ queryKey: ['menu', areaId ?? 'default'], queryFn: () => api.get<MenuSnapshot>(`/v1/menu${areaId ? `?areaId=${areaId}` : ''}`) });
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [course, setCourse] = useState(1);
  const [options, setOptions] = useState<MenuItem | null>(null);
  const [sheet, setSheet] = useState<'basket' | 'guests' | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === 'ok' ? 2_500 : 5_000);
    return () => clearTimeout(t);
  }, [toast]);

  const fail = (e: unknown, what: string) => setToast({ kind: 'error', text: e instanceof ApiError ? e.message : `${what} did not go through. Check the Wi-Fi and try again.` });
  const editable = order?.state === 'open' || order?.state === 'billed';
  const canEdit = editable && can('order.edit');
  const canFire = editable && can('kot.fire');

  const m = menu.data;
  const category = categoryId ?? m?.categories[0]?.id ?? null;
  const items = useMemo(() => (m ? visibleItems(m, category, query) : []), [m, category, query]);
  const inBasket = useMemo(() => {
    const n = new Map<string, number>();
    for (const i of order?.items ?? []) if (i.status === 'held') n.set(i.itemId, (n.get(i.itemId) ?? 0) + i.qty);
    return n;
  }, [order]);

  const add = (item: MenuItem, r: OptionsResult) => {
    const line = { id: newId(), itemId: item.id, variantId: r.variantId, qty: r.qty, addons: r.addonIds.map((addonId) => ({ addonId, qty: 1 })), note: r.note, course: r.course };
    session.runLatest((s) => addOrMerge(s, line)).catch((e: unknown) => fail(e, 'Adding the item'));
  };
  const tapItem = (item: MenuItem, viaPlus: boolean) => {
    if (!canEdit || !m) return;
    if (!item.available) return setToast({ kind: 'error', text: `${item.name} is sold out.` });
    if (needsChoices(m, item) || (!viaPlus && hasChoices(m, item))) return setOptions(item);
    add(item, { variantId: null, addonIds: [], qty: 1, note: null, course });
  };
  const fire = async (payload: { all: true } | { course: number }) => {
    setBusy(true);
    try {
      const res = await session.run<{ kots?: Array<{ kotNo: number }> }>('FireKOT', payload);
      setToast({ kind: 'ok', text: firedMessage(res.result) });
      void qc.invalidateQueries({ queryKey: ['floor'] });
      if (order && heldByCourse(res.order?.items ?? []).length === 0) setSheet(null);
    } catch (e) {
      fail(e, 'Sending to the kitchen');
    } finally {
      setBusy(false);
    }
  };

  const held = heldSummary(order?.items ?? []);
  const choices = canFire ? fireChoices(order?.items ?? []) : [];
  const label = order?.table?.label ?? '';

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

      {stream !== 'live' ? (
        <p role="status" className="flex items-center gap-2 bg-warn/30 px-4 py-2 text-sm font-semibold">
          <WifiOff className="h-4 w-4" /> {stream === 'offline' ? 'Offline: changes may not reach the kitchen until Wi-Fi is back.' : 'Connecting…'}
        </p>
      ) : null}
      {changedElsewhere ? (
        <p role="status" className="bg-secondary px-4 py-2 text-sm font-semibold">
          This order was just changed on another device. You are seeing the latest.
        </p>
      ) : null}
      {conflict ? (
        <p role="alert" className="flex items-start gap-2 bg-warn/30 px-4 py-2 text-sm font-semibold" onClick={dismissConflict}>
          {conflict.message}
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
      {error && !order ? <p className="p-4 font-semibold text-danger">Could not load this order.</p> : null}

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
      </ul>

      <footer className="fixed inset-x-0 bottom-0 z-10 flex gap-2 border-t border-border bg-card p-3 pb-5">
        <button className="btn flex-1 justify-between" onClick={() => setSheet('basket')} disabled={!order} aria-label="Basket">
          <span className="flex items-center gap-2">
            <ShoppingBasket className="h-5 w-5" />
            {held.qty ? `${held.qty} to send` : 'Order'}
          </span>
          {held.qty ? <span className="tabular-nums">{formatINR(held.amountPaise)}</span> : null}
        </button>
        {choices[0] ? (
          <button className="btn btn-primary" onClick={() => void fire(choices[0]!.payload)} disabled={busy}>
            <Send className="h-5 w-5" /> Fire all
          </button>
        ) : null}
      </footer>

      {toast ? (
        <p role={toast.kind === 'error' ? 'alert' : 'status'} className={`fixed inset-x-3 top-3 z-40 rounded-lg p-3 font-semibold shadow-lg ${toast.kind === 'error' ? 'bg-danger text-white' : 'bg-foreground text-background'}`} onClick={() => setToast(null)}>
          {toast.text}
        </p>
      ) : null}

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
      {sheet === 'basket' && order ? (
        <BasketSheet order={order} canEdit={canEdit} choices={choices} busy={busy} onFire={(p) => void fire(p)} onClose={() => setSheet(null)} onError={fail} session={session} />
      ) : null}
      {sheet === 'guests' && order ? (
        <GuestsSheet
          covers={order.covers}
          locked={order.state !== 'open' || !can('order.edit')}
          onClose={() => setSheet(null)}
          onSave={(covers) => {
            setSheet(null);
            session
              .run('SetCovers', { covers })
              .then(() => qc.invalidateQueries({ queryKey: ['floor'] }))
              .catch((e: unknown) => fail(e, 'Changing the guests'));
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

function lineDetail(i: OrderItemSnapshot): string {
  return [...i.addons.map((a) => a.name), i.note].filter(Boolean).join(' · ');
}

/** What is waiting by course (change quantity, remove) and what was sent, by KOT; the fire buttons at the bottom. */
function BasketSheet({
  order,
  canEdit,
  choices,
  busy,
  onFire,
  onClose,
  onError,
  session,
}: {
  order: OrderSnapshot;
  canEdit: boolean;
  choices: ReturnType<typeof fireChoices>;
  busy: boolean;
  onFire: (p: { all: true } | { course: number }) => void;
  onClose: () => void;
  onError: (e: unknown, what: string) => void;
  session: ReturnType<typeof useOrderSession>['session'];
}) {
  const groups = heldByCourse(order.items);
  const sent = firedByKot(order.items);
  const step = (i: OrderItemSnapshot, delta: number) => {
    if (i.qty + delta < 1) {
      session.run('RemoveHeldItem', { orderItemId: i.id }).catch((e: unknown) => onError(e, 'Removing the item'));
      return;
    }
    session.runLatest((s) => changeBy(s, i.id, delta)).catch((e: unknown) => onError(e, 'Changing the quantity'));
  };
  const moveCourse = (i: OrderItemSnapshot, course: number) => {
    session.run('UpdateHeldItem', { orderItemId: i.id, course }).catch((e: unknown) => onError(e, 'Changing the course'));
  };

  return (
    <Sheet
      title={`Table ${order.table?.label ?? ''} order`}
      onClose={onClose}
      footer={
        choices.length ? (
          <div className="flex flex-wrap gap-2">
            {choices.map((c, n) => (
              <button key={c.label} className={`btn whitespace-nowrap ${n === 0 ? 'btn-primary w-full' : 'flex-1 px-2 text-sm'}`} onClick={() => onFire(c.payload)} disabled={busy}>
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
            {g.items.map((i) => (
              <li key={i.id} className="flex items-center gap-2 p-2" data-line={i.name}>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{i.name}</span>
                  {lineDetail(i) ? <span className="block text-sm text-muted-foreground">{lineDetail(i)}</span> : null}
                  {canEdit ? (
                    <select className="mt-1 h-8 rounded border border-border bg-card px-1 text-sm" value={i.course} onChange={(e) => moveCourse(i, Number(e.target.value))} aria-label={`Course for ${i.name}`}>
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
                    <button className="btn h-10 w-10 px-0" onClick={() => step(i, -1)} aria-label={i.qty === 1 ? `Remove ${i.name}` : `One less ${i.name}`}>
                      {i.qty === 1 ? <Trash2 className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                    </button>
                    <span className="w-7 text-center font-bold tabular-nums">{i.qty}</span>
                    <button className="btn h-10 w-10 px-0" onClick={() => step(i, 1)} aria-label={`One more ${i.name}`}>
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

function GuestsSheet({ covers: initial, locked, onSave, onClose }: { covers: number; locked: boolean; onSave: (covers: number) => void; onClose: () => void }) {
  const [covers, setCovers] = useState(Math.max(1, initial));
  return (
    <Sheet title="Guests" onClose={onClose}>
      {locked ? (
        <p className="mb-4">Guests cannot change once the bill is printed.</p>
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
