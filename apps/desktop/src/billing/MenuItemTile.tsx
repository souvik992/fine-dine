import { formatINR, type MenuItem } from '@dinepos/shared';
import { Image, List } from 'lucide-react';
import { useState } from 'react';
import { DishPhoto } from '../components/DishPhoto.js';
import { VegMark } from '../components/VegMark.js';

export type MenuView = 'list' | 'photos';
const KEY = 'dinepos.menuView';

/** How the billing screen shows dishes, remembered on this terminal: the compact list (default) or with photos. */
export function useMenuView(): [MenuView, (v: MenuView) => void] {
  const [view, setView] = useState<MenuView>(() => {
    try {
      return localStorage.getItem(KEY) === 'photos' ? 'photos' : 'list';
    } catch {
      return 'list';
    }
  });
  const set = (v: MenuView) => {
    setView(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      // not remembered (private profile): the choice still applies until the screen closes
    }
  };
  return [view, set];
}

export function MenuViewSwitch({ view, onChange }: { view: MenuView; onChange: (v: MenuView) => void }) {
  return (
    <div className="flex shrink-0 rounded-lg border border-border bg-card p-0.5" role="radiogroup" aria-label="Menu view">
      {(
        [
          ['list', List, 'List'],
          ['photos', Image, 'Photos'],
        ] as const
      ).map(([v, Icon, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={view === v}
          onClick={() => onChange(v)}
          className={`flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold ${view === v ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-secondary'}`}
        >
          <Icon className="h-4 w-4" /> {label}
        </button>
      ))}
    </div>
  );
}

const priceText = (it: MenuItem) => (it.variants.length ? `from ${formatINR(Math.min(...it.variants.map((v) => v.pricePaise)))}` : formatINR(it.pricePaise));

/** One dish on the billing screen: click adds it; right-click marks it sold out (when allowed). */
export function MenuItemTile({ item: it, view, onChoose, onToggleSoldOut, canMarkSoldOut }: { item: MenuItem; view: MenuView; onChoose: () => void; onToggleSoldOut: () => void; canMarkSoldOut: boolean }) {
  const common = {
    onClick: onChoose,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      onToggleSoldOut();
    },
    title: it.available ? (canMarkSoldOut ? 'Right-click: mark sold out' : undefined) : 'Sold out',
  };
  const soldOut = <span className="rounded bg-danger px-1.5 font-bold uppercase text-white">Sold out</span>;
  if (view === 'photos') {
    return (
      <button {...common} className={`flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left hover:border-ring ${it.available ? '' : 'opacity-50'}`}>
        <span className="relative block aspect-[4/3] w-full">
          <DishPhoto name={it.image} label={it.name} className="absolute inset-0 h-full w-full text-4xl" />
          {!it.available ? <span className="absolute left-2 top-2 text-xs">{soldOut}</span> : null}
        </span>
        <span className="flex flex-1 flex-col justify-between gap-1 p-2.5">
          <span className="flex items-start gap-2 text-sm font-semibold leading-snug">
            <VegMark veg={it.veg} />
            {it.name}
          </span>
          <span className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-mono">{it.shortCode}</span>
            <span className="font-semibold tabular-nums text-foreground">{priceText(it)}</span>
          </span>
        </span>
      </button>
    );
  }
  return (
    <button {...common} className={`flex min-h-20 flex-col justify-between rounded-xl border border-border bg-card p-3 text-left hover:border-ring ${it.available ? '' : 'opacity-50'}`}>
      <span className="flex items-start gap-2 text-sm font-semibold">
        <VegMark veg={it.veg} />
        {it.name}
      </span>
      <span className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        {it.available ? <span className="font-mono">{it.shortCode}</span> : soldOut}
        <span className="font-semibold tabular-nums text-foreground">{priceText(it)}</span>
      </span>
    </button>
  );
}
