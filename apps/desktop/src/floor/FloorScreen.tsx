import type { FloorSnapshot, FloorTable, OutletConfig } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { Banknote, Bike, ChartColumn, LayoutGrid, List, Map as MapIcon, MoonStar, Puzzle, ReceiptText, RefreshCw, Search, Settings, ShoppingBag, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';
import { AccountMenu } from '../components/AccountMenu.js';
import { BrandLogo } from '../components/Brand.js';
import { HealthDots } from '../components/HealthDots.js';
import { Modal } from '../components/Modal.js';
import { useScreen } from '../components/use-screen.js';
import { UserBadge } from '../components/UserBadge.js';
import { canvasSize, hasLayout, TILE_H, TILE_W } from '../settings/layout-model.js';
import { findTable, moveFocus, STATE_META, stateCounts, tablesInArea, type Arrow } from './floor-model.js';
import { BookingsButton } from '../bookings/BookingsButton.js';
import { OnlineButton } from '../online/OnlineButton.js';
import { StockButton } from '../stock/StockButton.js';
import { BillsDialog } from './BillsDialog.js';
import { CounterOrderDialog } from './CounterOrderDialog.js';
import { CounterOrders } from './CounterOrders.js';
import type { CounterType } from './counter-model.js';
import { CashDialog } from './CashDialog.js';
import { DayEndDialog } from './DayEndDialog.js';
import { SeatDialog } from './SeatDialog.js';
import { TableTile } from './TableTile.js';

type FloorView = 'layout' | 'grid' | 'list';
/** The view this terminal used last (Layout when it never chose). */
function readView(): FloorView {
  try {
    const v = localStorage.getItem('dinepos.floorView');
    return v === 'grid' || v === 'list' ? v : 'layout';
  } catch {
    return 'layout';
  }
}

function useClock(intervalMs = 15_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Tiles per row, measured from the rendered grid (it reflows with the window). */
function columnsOf(grid: HTMLElement | null): number {
  const tiles = grid ? Array.from(grid.children) : [];
  const top = (tiles[0] as HTMLElement | undefined)?.offsetTop;
  return Math.max(1, tiles.filter((t) => (t as HTMLElement).offsetTop === top).length);
}

export function FloorScreen({
  onSettings,
  onStock,
  onReports,
  onBookings,
  onOnline,
  addonNav = [],
  onOpenOrder,
}: {
  onSettings: () => void;
  onStock: () => void;
  onReports: () => void;
  onBookings: () => void;
  onOnline: () => void;
  /** P5-01: add-on screens, as buttons in the top bar. */
  addonNav?: Array<{ id: string; label: string; title?: string; open: () => void }>;
  onOpenOrder: (orderId: string) => void;
}) {
  const { api, pinRequest, can } = useApp();
  const now = useClock();
  const floor = useQuery({
    queryKey: ['floor'],
    queryFn: () => api.get<FloorSnapshot>('/v1/floor'),
    refetchInterval: 60_000, // safety net; live updates come from the stream
  });
  const [areaId, setAreaId] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  const [search, setSearch] = useState('');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [seating, setSeating] = useState<FloorTable | null>(null);
  const [starting, setStarting] = useState<CounterType | null>(null);
  const [closingDay, setClosingDay] = useState(false);
  const [panel, setPanel] = useState<'bills' | 'cash' | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const searchBox = useRef<HTMLInputElement>(null);

  const data = floor.data;
  const activeArea = areaId ?? data?.areas[0]?.id ?? null;
  const tables = useMemo(() => (data ? tablesInArea(data, activeArea) : []), [data, activeArea]);
  const counts = stateCounts(tables);
  const [view, setView] = useState<FloorView>(readView);
  const layout = hasLayout(tables.map((t) => ({ id: t.id, layoutX: t.layoutX ?? null, layoutY: t.layoutY ?? null })));
  // the room plan is drawn to fit the width; below 90 % (phones, tablets upright) its tiles are too small to read, so the
  // grid is shown instead (same tables, full-size tiles)
  const { width, compact } = useScreen();
  const config = useQuery({ queryKey: ['config'], queryFn: () => api.get<OutletConfig>('/v1/config'), staleTime: 60_000 });
  const outletName = config.data?.['outlet.name'] || 'DinePOS';
  // phones: the table search opens from an icon, the less used tools from More
  const [searchOpen, setSearchOpen] = useState(false);
  const [more, setMore] = useState(false);
  const layoutFits = width - 40 >= 0.9 * canvasSize(tables.map((t) => ({ id: t.id, layoutX: t.layoutX ?? null, layoutY: t.layoutY ?? null }))).w;
  const showLayout = layout && view === 'layout' && layoutFits;
  const room = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const size = canvasSize(tables.map((t) => ({ id: t.id, layoutX: t.layoutX ?? null, layoutY: t.layoutY ?? null })));
  useEffect(() => {
    const el = room.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1.2, el.clientWidth / size.w));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size.w, showLayout]);
  const switchView = (v: FloorView) => {
    setView(v);
    try {
      localStorage.setItem('dinepos.floorView', v);
    } catch {
      // per-terminal convenience only
    }
  };

  const open = (t: FloorTable) => {
    if (t.state === 'FREE' || t.state === 'RESERVED') setSeating(t);
    else if (t.state !== 'BLOCKED' && t.orderId) onOpenOrder(t.orderId);
  };

  const focusTile = (i: number) => {
    setFocus(i);
    tileRefs.current[i]?.focus();
  };

  const onGridKey = (e: KeyboardEvent) => {
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      focusTile(moveFocus(focus, e.key as Arrow, tables.length, columnsOf(grid.current)));
    }
  };

  // Typing a letter or digit anywhere on the floor jumps to the table search (docs/09: type "T7" + Enter).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (seating || starting || closingDay || panel || more || pinRequest || e.ctrlKey || e.altKey || e.metaKey) return;
      if (document.activeElement === searchBox.current) return;
      if (/^[a-z0-9]$/i.test(e.key)) {
        if (!searchBox.current) setSearchOpen(true); // a phone with a keyboard: the box opens and takes the next keys
        searchBox.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [seating, starting, closingDay, panel, more, pinRequest]);

  const submitSearch = () => {
    if (!data) return;
    const hit = findTable(data, search);
    if (!hit) {
      setSearchError(search.trim() ? `No table "${search.trim()}"` : null);
      return;
    }
    setSearch('');
    setSearchError(null);
    setSearchOpen(false);
    setAreaId(hit.areaId);
    open(hit);
  };

  // the floor's tools: in the top bar on wider screens, in More on phones
  const tools = (
    <>
      {addonNav.map((a) => (
        <button key={a.id} className="btn h-10" onClick={a.open} title={a.title ?? a.label} data-addon-nav={a.id}>
          <Puzzle className="h-4 w-4" /> {a.label}
        </button>
      ))}
      {can('bill.settle') ? (
        <button className="btn h-10" onClick={() => setPanel('bills')} title="Today's bills: reprint or void">
          <ReceiptText className="h-4 w-4" /> Bills
        </button>
      ) : null}
      {can('cash.move', true) || can('drawer.open', true) ? (
        <button className="btn h-10" onClick={() => setPanel('cash')} title="Pay in, pay out, open drawer">
          <Banknote className="h-4 w-4" /> Cash
        </button>
      ) : null}
      {can('stock.manage') ? <StockButton onClick={onStock} /> : null}
      {can('reports.view') ? (
        <button className="btn h-10" onClick={onReports} title="Sales, GST, cash and leakage reports">
          <ChartColumn className="h-4 w-4" /> Reports
        </button>
      ) : null}
      {can('dayend', true) ? (
        <button className="btn h-10" onClick={() => setClosingDay(true)} disabled={!data} title="Close the business day and print the Z-report">
          <MoonStar className="h-4 w-4" /> Day end
        </button>
      ) : null}
    </>
  );

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0">
        <div className="appbar short:min-h-12 sm:px-5">
          <BrandLogo size={32} inverse className="max-[359px]:[&>span]:hidden" />
          {compact ? (
            <AccountMenu outletName={outletName} />
          ) : (
            <span className="ml-2 min-w-0 truncate text-sm font-semibold opacity-90" title="Outlet">
              {outletName}
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
            <HealthDots onBar brief={compact} />
            {!compact ? (
              <>
                <time className="w-12 text-right text-sm font-semibold tabular-nums" dateTime={now.toISOString()}>
                  {now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}
                </time>
                <div className="[&_.text-muted-foreground]:text-primary-foreground/80">
                  <UserBadge />
                </div>
                <button className="btn h-10 w-10 px-0" onClick={onSettings} aria-label="Settings" title="Settings">
                  <Settings className="h-5 w-5" />
                </button>
              </>
            ) : null}
          </div>
        </div>

        {/* one line when it fits (PCs, a phone held sideways); else the areas and search above, the tools below */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2 sm:px-5 short:py-1.5">
          <div className="flex min-w-0 flex-[1_1_17rem] items-center gap-2">
            {compact && searchOpen ? null : (
              <nav role="tablist" aria-label="Areas" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
                {data?.areas.map((a) => (
                  <button
                    key={a.id}
                    role="tab"
                    className="tab shrink-0"
                    aria-selected={a.id === activeArea}
                    onClick={() => {
                      setAreaId(a.id);
                      setFocus(0);
                    }}
                  >
                    {a.name}
                  </button>
                ))}
              </nav>
            )}
            {!compact || searchOpen ? (
              <form
                className={`relative ${compact ? 'flex-1' : 'ml-auto'}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  submitSearch();
                }}
              >
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <input
                  ref={searchBox}
                  className={`input pl-9 ${compact ? 'w-full' : 'w-44'}`}
                  placeholder="Table, e.g. T7"
                  aria-label="Find table"
                  aria-invalid={searchError ? true : undefined}
                  autoFocus={compact}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setSearchError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setSearch('');
                      setSearchOpen(false);
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                />
                {searchError ? (
                  <span role="alert" className="absolute left-0 top-11 z-10 whitespace-nowrap rounded bg-card px-1 text-xs font-semibold text-danger">
                    {searchError}
                  </span>
                ) : null}
              </form>
            ) : null}
            {compact ? (
              <button
                className="btn h-10 w-10 shrink-0 px-0"
                onClick={() => {
                  setSearchOpen((o) => !o);
                  setSearch('');
                  setSearchError(null);
                }}
                aria-label={searchOpen ? 'Close table search' : 'Find a table'}
              >
                {searchOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
              </button>
            ) : null}
            {compact && can('online.orders') ? (
              <div className="icon-only shrink-0">
                <OnlineButton onClick={onOnline} />
              </div>
            ) : null}
          </div>

          {/* may shrink: on a line of its own the tools wrap instead of running off the edge (e.g. 1024-1180 px) */}
          <div className="flex min-w-0 flex-[1_1_auto] flex-wrap items-center justify-end gap-2">
            {compact ? (
              <>
                {can('reservation.manage') || can('order.create') ? (
                  <div className="icon-only [&_.btn]:w-auto [&_.btn]:gap-1 [&_.btn]:px-2.5">
                    <BookingsButton onClick={onBookings} />
                  </div>
                ) : null}
                <button className="btn h-10 w-10 px-0" onClick={() => setMore(true)} aria-label="More" title="Bills, cash, reports, settings…">
                  <SlidersHorizontal className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                {can('reservation.manage') || can('order.create') ? <BookingsButton onClick={onBookings} /> : null}
                {can('online.orders') ? <OnlineButton onClick={onOnline} /> : null}
                {tools}
              </>
            )}
            {can('order.create') ? (
              <div className="ml-auto flex gap-2">
                <button className="btn btn-outline h-10 px-3 sm:px-4" onClick={() => setStarting('takeaway')} title="Start a takeaway order" data-testid="new-takeaway">
                  <ShoppingBag className="h-4 w-4 max-[359px]:hidden" /> Takeaway
                </button>
                <button className="btn btn-primary h-10 px-3 sm:px-4" onClick={() => setStarting('delivery')} title="Start a delivery order" data-testid="new-delivery">
                  <Bike className="h-4 w-4 max-[359px]:hidden" /> Delivery
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5 sm:py-4 short:py-2">
        {floor.isError ? (
          <div role="alert" className="mx-auto mt-16 max-w-md rounded-xl border border-border bg-card p-6 text-center">
            <p className="font-semibold">{floor.error instanceof ApiError ? floor.error.message : 'Could not load the floor.'}</p>
            <div className="mt-4 flex justify-center gap-2">
              <button className="btn" onClick={() => void floor.refetch()}>
                <RefreshCw className="h-4 w-4" /> Try again
              </button>
              <button className="btn" onClick={onSettings}>
                <Settings className="h-4 w-4" /> Server settings
              </button>
            </div>
          </div>
        ) : !data ? (
          <p className="mt-16 text-center text-muted-foreground">Loading floor…</p>
        ) : (
          <>
            <CounterOrders orders={data.counterOrders} now={now} onOpen={onOpenOrder} />
            {tables.length === 0 ? (
              <p className="mt-16 text-center text-muted-foreground">No tables in this area yet. Add them in Settings.</p>
            ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2" aria-label="Table summary">
              {Object.entries(counts).map(([state, n]) => (
                <span key={state} className="pill text-muted-foreground">
                  {STATE_META[state as keyof typeof STATE_META].label}: {n}
                </span>
              ))}
              <span className="ml-auto flex items-center gap-1" role="radiogroup" aria-label="Floor view">
                {(
                  [
                    ['layout', MapIcon, 'Layout'],
                    ['grid', LayoutGrid, 'Grid'],
                    ['list', List, 'List'],
                  ] as const
                )
                  // the floor plan: offered where it fits; a phone never shows it, so no greyed-out button there
                  .filter(([v]) => v !== 'layout' || (layout && (layoutFits || !compact)))
                  .map(([v, Icon, label]) => {
                    const on = v === 'layout' ? showLayout : v === 'grid' ? !showLayout && view !== 'list' : view === 'list';
                    return (
                      <button
                        key={v}
                        role="radio"
                        aria-checked={on}
                        aria-label={label}
                        className={`flex h-8 w-10 items-center justify-center rounded-full border transition-colors disabled:opacity-40 ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:bg-secondary'}`}
                        disabled={v === 'layout' && !layoutFits}
                        title={v === 'layout' ? (layoutFits ? 'Floor plan' : 'The floor plan shows on a wider screen (turn the tablet sideways)') : label}
                        onClick={() => switchView(v)}
                      >
                        <Icon className="h-4 w-4" />
                      </button>
                    );
                  })}
              </span>
            </div>
            {showLayout ? (
              <div ref={room} className="relative w-full" style={{ height: size.h * scale }} aria-label="Tables (floor layout)">
                {tables.map((t, i) => (
                  <TableTile
                    key={t.id}
                    table={t}
                    now={now}
                    focused={i === Math.min(focus, tables.length - 1)}
                    onFocus={() => setFocus(i)}
                    onOpen={open}
                    style={{ position: 'absolute', left: (t.layoutX ?? 0) * scale, top: (t.layoutY ?? 0) * scale, width: TILE_W * scale, height: TILE_H * scale, minHeight: 0 }}
                  />
                ))}
              </div>
            ) : (
              <div
                ref={grid}
                role="grid"
                aria-label="Tables"
                // at least two tiles a row on the narrowest phone; one table a line in the list
                className={view === 'list' ? 'grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(100%,22rem),1fr))]' : 'grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(150px,calc(50%_-_0.375rem)),1fr))]'}
                onKeyDown={onGridKey}
              >
                {tables.map((t, i) => (
                  <TableTile
                    key={t.id}
                    ref={(el) => {
                      tileRefs.current[i] = el;
                    }}
                    table={t}
                    now={now}
                    row={view === 'list'}
                    focused={i === Math.min(focus, tables.length - 1)}
                    onFocus={() => setFocus(i)}
                    onOpen={open}
                  />
                ))}
              </div>
            )}
          </>
            )}
          </>
        )}
      </main>

      {more ? (
        <Modal title="More" onClose={() => setMore(false)}>
          {/* a tool closes this sheet after it has opened its own screen or dialog (bubbling: the tool's click runs first) */}
          <div className="grid grid-cols-2 gap-2 [&_.btn]:h-12 [&_.btn]:w-full [&_.btn]:justify-start" onClick={(e) => (e.target as HTMLElement).closest('button') && setMore(false)}>
            {tools}
            <button className="btn h-10" onClick={onSettings}>
              <Settings className="h-4 w-4" /> Settings
            </button>
          </div>
          <div className="mt-4 border-t border-border pt-3">
            <HealthDots />
          </div>
        </Modal>
      ) : null}
      {closingDay && data ? <DayEndDialog floor={data} onClose={() => setClosingDay(false)} /> : null}
      {panel === 'bills' ? <BillsDialog onClose={() => setPanel(null)} /> : null}
      {panel === 'cash' ? <CashDialog onClose={() => setPanel(null)} /> : null}
      {starting ? <CounterOrderDialog initialType={starting} onClose={() => setStarting(null)} onOpened={onOpenOrder} /> : null}
      {seating ? <SeatDialog table={seating} onClose={() => setSeating(null)} onSeated={onOpenOrder} /> : null}
    </div>
  );
}
