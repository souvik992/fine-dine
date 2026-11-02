import { formatINR, newId, type MenuItem, type MenuSnapshot, type OrderItemSnapshot } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Flame, Printer, Search, Wallet } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';
import { HealthDots } from '../components/HealthDots.js';
import { VegMark } from '../components/VegMark.js';
import { elapsedMinutes, formatElapsed } from '../floor/floor-model.js';
import { Cart } from './Cart.js';
import { hasChoices, needsChoices, resolveQuickEntry, visibleItems } from './menu-model.js';
import { ModifierSheet, type SheetResult } from './ModifierSheet.js';
import { useOrderSession } from './useOrderSession.js';

interface Toast {
  kind: 'ok' | 'error';
  text: string;
}

/**
 * Order / billing screen (docs/09 §2). Keyboard: type a code + Enter (Shift+Enter for options), F8 fire,
 * Alt+↑/↓ pick a held line, + / − its quantity, Delete removes it, Esc clears the search or goes back.
 */
export function BillingScreen({ orderId, onBack }: { orderId: string; onBack: () => void }) {
  const { api } = useApp();
  const { session, order, error, changedElsewhere, dismissChange } = useOrderSession(orderId);
  const areaId = order?.table?.areaId;
  const menuQuery = useQuery({
    queryKey: ['menu', areaId ?? 'default'],
    queryFn: () => api.get<MenuSnapshot>(`/v1/menu${areaId ? `?areaId=${areaId}` : ''}`),
    enabled: order !== null,
    staleTime: 60_000,
  });
  const menu = menuQuery.data && 'items' in menuQuery.data ? menuQuery.data : null;

  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState<{ item: MenuItem; qty: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  const searchBox = useRef<HTMLInputElement>(null);

  const activeCategory = categoryId ?? menu?.categories[0]?.id ?? null;
  const items = useMemo(() => (menu ? visibleItems(menu, activeCategory, query) : []), [menu, activeCategory, query]);
  const held = useMemo(() => order?.items.filter((i) => i.status === 'held') ?? [], [order]);
  const selected = held.find((i) => i.id === selectedId) ?? held.at(-1);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === 'error' ? 6_000 : 3_000);
    return () => clearTimeout(t);
  }, [toast]);

  const run = async (type: string, payload: unknown, done?: string): Promise<boolean> => {
    setPending((n) => n + 1);
    try {
      await session.run(type, payload);
      if (done) setToast({ kind: 'ok', text: done });
      return true;
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof ApiError ? e.message : 'Something went wrong. Try again.' });
      return false;
    } finally {
      setPending((n) => n - 1);
    }
  };

  const addLine = (item: MenuItem, r: Omit<SheetResult, 'addonIds'> & { addonIds?: string[] }) => {
    const id = newId();
    setSelectedId(id);
    void run('AddItems', {
      items: [{ id, itemId: item.id, variantId: r.variantId, qty: r.qty, addons: (r.addonIds ?? []).map((addonId) => ({ addonId, qty: 1 })), note: r.note, course: r.course }],
    });
  };

  const choose = (item: MenuItem, qty: number, forceSheet: boolean) => {
    if (!menu) return;
    if (!item.available) {
      setToast({ kind: 'error', text: `${item.name} is not available right now.` });
      return;
    }
    if (needsChoices(menu, item) || (forceSheet && hasChoices(menu, item))) setSheet({ item, qty });
    else addLine(item, { variantId: null, qty, note: null, course: 1 });
  };

  const submitSearch = (shift: boolean) => {
    if (!menu) return;
    const quick = resolveQuickEntry(menu, query);
    const target = quick ?? (items.length === 1 ? { item: items[0]!, qty: 1 } : null);
    if (!target) {
      if (query.trim()) setToast({ kind: 'error', text: `No item for "${query.trim()}"` });
      return;
    }
    setQuery('');
    choose(target.item, target.qty, shift);
  };

  const fire = () => {
    if (held.length === 0) {
      setToast({ kind: 'error', text: 'Nothing new to send to the kitchen.' });
      return;
    }
    void session.run<{ kots: Array<{ kotNo: number }> }>('FireKOT', { all: true }).then(
      (r) => setToast({ kind: 'ok', text: `Sent to kitchen: KOT ${r.result.kots.map((k) => String(k.kotNo).padStart(4, '0')).join(', ')}` }),
      (e: unknown) => setToast({ kind: 'error', text: e instanceof ApiError ? e.message : 'Could not send the KOT.' }),
    );
  };

  const changeQty = (i: OrderItemSnapshot, qty: number) => {
    if (qty < 1) return;
    void run('UpdateHeldItem', { orderItemId: i.id, qty });
  };
  const remove = (i: OrderItemSnapshot) => void run('RemoveHeldItem', { orderItemId: i.id });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheet) return; // the sheet owns the keyboard
      const inSearch = document.activeElement === searchBox.current;
      if (e.key === 'F8') {
        e.preventDefault();
        fire();
      } else if (e.key === 'F9' || e.key === 'F10') {
        e.preventDefault();
        setToast({ kind: 'error', text: 'Print bill and Settle arrive with the next update (roadmap P1-10).' });
      } else if (e.key === 'Escape') {
        if (query) setQuery('');
        else onBack();
      } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && held.length) {
        e.preventDefault();
        const idx = Math.max(0, held.findIndex((h) => h.id === selected?.id));
        const next = e.key === 'ArrowUp' ? Math.max(0, idx - 1) : Math.min(held.length - 1, idx + 1);
        setSelectedId(held[next]!.id);
      } else if (selected && (!inSearch || query === '') && (e.key === '+' || e.key === '-' || e.key === 'Delete')) {
        e.preventDefault();
        if (e.key === 'Delete') remove(selected);
        else changeQty(selected, selected.qty + (e.key === '+' ? 1 : -1));
      } else if (!inSearch && !e.ctrlKey && !e.altKey && !e.metaKey && /^[a-z0-9* ]$/i.test(e.key)) {
        searchBox.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Put the cursor in the search box once, when the order and menu have loaded.
  const ready = order !== null && menu !== null;
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (ready && !focusedOnce.current) {
      focusedOnce.current = true;
      searchBox.current?.focus();
    }
  }, [ready]);

  if (error && !order) {
    return (
      <div className="mx-auto mt-24 max-w-md text-center">
        <p role="alert" className="font-semibold">
          {error instanceof ApiError ? error.message : 'Could not open this order.'}
        </p>
        <button className="btn mt-4" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back to floor
        </button>
      </div>
    );
  }
  if (!order || !menu) return <p className="mt-24 text-center text-muted-foreground">Opening order…</p>;

  const elapsed = formatElapsed(elapsedMinutes(order.openedAt, new Date()));
  const tableTitle = order.table ? `Table ${order.table.label}` : 'Takeaway';

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2.5">
        <button className="btn" onClick={onBack} title="Back to floor (Esc)">
          <ArrowLeft className="h-4 w-4" /> Floor
        </button>
        <h1 className="font-display text-xl font-semibold" data-testid="order-title">
          {tableTitle}
        </h1>
        <span className="text-sm text-muted-foreground">
          {order.covers} covers{elapsed ? ` · ${elapsed}` : ''} · v{order.version}
        </span>
        {changedElsewhere ? (
          <button role="status" onClick={dismissChange} className="rounded-full bg-[var(--kot)] px-3 py-1 text-xs font-bold text-[var(--kot-ink)]">
            Updated on another terminal
          </button>
        ) : null}
        <div className="ml-auto">
          <HealthDots />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="w-44 shrink-0 overflow-y-auto border-r border-border bg-card p-2" aria-label="Categories">
          {menu.categories.map((c) => (
            <button
              key={c.id}
              className={`mb-1 block w-full rounded-lg px-3 py-2.5 text-left text-sm font-semibold ${!query && c.id === activeCategory ? 'bg-foreground text-background' : 'hover:bg-secondary'}`}
              onClick={() => {
                setCategoryId(c.id);
                setQuery('');
              }}
            >
              {c.name}
            </button>
          ))}
        </nav>

        <main className="flex min-w-0 flex-1 flex-col">
          <form
            className="relative border-b border-border px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault();
            }}
          >
            <Search className="pointer-events-none absolute left-7 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              ref={searchBox}
              className="input h-11 pl-10 text-base"
              placeholder="Short code or name — e.g. pt2 then Enter (Shift+Enter for options)"
              aria-label="Add item"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitSearch(e.shiftKey);
                }
              }}
            />
          </form>
          <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto p-4 [grid-template-columns:repeat(auto-fill,minmax(170px,1fr))]" aria-label="Items">
            {items.map((it) => (
              <button
                key={it.id}
                disabled={!it.available}
                onClick={() => choose(it, 1, true)}
                className="flex min-h-20 flex-col justify-between rounded-xl border border-border bg-card p-3 text-left hover:border-ring disabled:opacity-40"
                title={it.available ? undefined : 'Not available right now'}
              >
                <span className="flex items-start gap-2 text-sm font-semibold">
                  <VegMark veg={it.veg} />
                  {it.name}
                </span>
                <span className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-mono">{it.shortCode}</span>
                  <span className="font-semibold tabular-nums text-foreground">{it.variants.length ? `from ${formatINR(Math.min(...it.variants.map((v) => v.pricePaise)))}` : formatINR(it.pricePaise)}</span>
                </span>
              </button>
            ))}
            {items.length === 0 ? <p className="text-sm text-muted-foreground">No matching items.</p> : null}
          </div>
        </main>

        <div className="flex min-h-0 flex-col">
          <Cart order={order} selectedId={selected?.id ?? null} busy={pending > 0} onSelect={setSelectedId} onQty={changeQty} onRemove={remove} />
          <div className="grid w-[380px] grid-cols-3 gap-2 border-l border-t border-border bg-card p-3">
            <button className="btn btn-primary h-12" onClick={fire} disabled={held.length === 0}>
              <Flame className="h-4 w-4" /> Fire <kbd className="text-xs opacity-80">F8</kbd>
            </button>
            <button className="btn h-12" disabled title="Arrives in P1-10">
              <Printer className="h-4 w-4" /> Bill <kbd className="text-xs">F9</kbd>
            </button>
            <button className="btn h-12" disabled title="Arrives in P1-10">
              <Wallet className="h-4 w-4" /> Settle <kbd className="text-xs">F10</kbd>
            </button>
          </div>
        </div>
      </div>

      {toast ? (
        <div role={toast.kind === 'error' ? 'alert' : 'status'} className={`fixed bottom-24 left-1/2 -translate-x-1/2 rounded-full px-5 py-2.5 text-sm font-semibold shadow-lg ${toast.kind === 'error' ? 'bg-danger text-white' : 'bg-foreground text-background'}`}>
          {toast.text}
        </div>
      ) : null}

      {sheet ? (
        <ModifierSheet
          menu={menu}
          item={sheet.item}
          initialQty={sheet.qty}
          onClose={() => {
            setSheet(null);
            searchBox.current?.focus();
          }}
          onAdd={(r) => {
            addLine(sheet.item, r);
            setSheet(null);
            searchBox.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}
