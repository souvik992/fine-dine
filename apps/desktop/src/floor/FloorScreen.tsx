import type { FloorSnapshot, FloorTable } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { MoonStar, RefreshCw, Search, Settings } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';
import { HealthDots } from '../components/HealthDots.js';
import { findTable, moveFocus, STATE_META, stateCounts, tablesInArea, type Arrow } from './floor-model.js';
import { DayEndDialog } from './DayEndDialog.js';
import { SeatDialog } from './SeatDialog.js';
import { TableTile } from './TableTile.js';

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

export function FloorScreen({ onSettings, onOpenOrder }: { onSettings: () => void; onOpenOrder: (orderId: string) => void }) {
  const { api } = useApp();
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
  const [closingDay, setClosingDay] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const searchBox = useRef<HTMLInputElement>(null);

  const data = floor.data;
  const activeArea = areaId ?? data?.areas[0]?.id ?? null;
  const tables = useMemo(() => (data ? tablesInArea(data, activeArea) : []), [data, activeArea]);
  const counts = stateCounts(tables);

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
      if (seating || closingDay || e.ctrlKey || e.altKey || e.metaKey) return;
      if (document.activeElement === searchBox.current) return;
      if (/^[a-z0-9]$/i.test(e.key)) {
        searchBox.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [seating, closingDay]);

  const submitSearch = () => {
    if (!data) return;
    const hit = findTable(data, search);
    if (!hit) {
      setSearchError(search.trim() ? `No table "${search.trim()}"` : null);
      return;
    }
    setSearch('');
    setSearchError(null);
    setAreaId(hit.areaId);
    open(hit);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-5 py-3">
        <div className="mr-2 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary font-display text-lg text-primary-foreground">D</div>
          <span className="font-display text-xl font-semibold">Floor</span>
        </div>
        <nav role="tablist" aria-label="Areas" className="flex gap-1">
          {data?.areas.map((a) => (
            <button
              key={a.id}
              role="tab"
              className="tab"
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
        <form
          className="relative ml-auto"
          onSubmit={(e) => {
            e.preventDefault();
            submitSearch();
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            ref={searchBox}
            className="input w-44 pl-9"
            placeholder="Table, e.g. T7"
            aria-label="Find table"
            aria-invalid={searchError ? true : undefined}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSearchError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearch('');
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          {searchError ? (
            <span role="alert" className="absolute left-0 top-11 whitespace-nowrap text-xs font-semibold text-danger">
              {searchError}
            </span>
          ) : null}
        </form>
        <HealthDots />
        <time className="w-14 text-right text-sm font-semibold tabular-nums" dateTime={now.toISOString()}>
          {now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}
        </time>
        <button className="btn h-10" onClick={() => setClosingDay(true)} disabled={!data} title="Close the business day and print the Z-report">
          <MoonStar className="h-4 w-4" /> Day end
        </button>
        <button className="btn h-10 w-10 px-0" onClick={onSettings} aria-label="Settings" title="Settings">
          <Settings className="h-5 w-5" />
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
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
        ) : tables.length === 0 ? (
          <p className="mt-16 text-center text-muted-foreground">No tables in this area yet. Add them in Settings.</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-2 text-xs font-semibold text-muted-foreground" aria-label="Table summary">
              {Object.entries(counts).map(([state, n]) => (
                <span key={state} className="rounded-full border border-border bg-card px-3 py-1">
                  {STATE_META[state as keyof typeof STATE_META].label}: {n}
                </span>
              ))}
            </div>
            <div ref={grid} role="grid" aria-label="Tables" className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]" onKeyDown={onGridKey}>
              {tables.map((t, i) => (
                <TableTile
                  key={t.id}
                  ref={(el) => {
                    tileRefs.current[i] = el;
                  }}
                  table={t}
                  now={now}
                  focused={i === Math.min(focus, tables.length - 1)}
                  onFocus={() => setFocus(i)}
                  onOpen={open}
                />
              ))}
            </div>
          </>
        )}
      </main>

      {closingDay && data ? <DayEndDialog floor={data} onClose={() => setClosingDay(false)} /> : null}
      {seating ? <SeatDialog table={seating} onClose={() => setSeating(null)} onSeated={onOpenOrder} /> : null}
    </div>
  );
}
