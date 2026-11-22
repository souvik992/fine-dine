import { channelPrice, formatINR, parseRupees, type ChannelSync, type MenuSnapshot, type MenuSync, type OutletConfig, type SalesChannel } from '@dinepos/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';
import { DishPhoto } from '../components/DishPhoto.js';
import { Modal } from '../components/Modal.js';
import { ErrorText } from './common.js';

const NAME: Record<SalesChannel, string> = { website: 'Website', app: 'App', swiggy: 'Swiggy', zomato: 'Zomato' };
const MODES: Array<[ChannelSync['mode'], string, string]> = [
  ['all', 'All dishes', 'The whole menu'],
  ['exclude', 'All except…', 'Pick dishes to leave out'],
  ['include', 'Only…', 'Pick the dishes to list'],
];

/** A row of the price list: a dish, or one size of it (online item id "<itemId>" or "<itemId>:<variantId>"). */
interface Row {
  onlineId: string;
  itemId: string;
  name: string;
  category: string;
  pricePaise: number;
  image: string | null | undefined;
}

const rupeesText = (paise: number) => String(paise / 100);

/**
 * Settings › Online orders › a channel's Menu sync (quickPOS ODS): which dishes the channel lists (all / all except /
 * only) and its prices (the POS price, or a percentage with prices per dish or size). Online bills for the channel use
 * these prices, so the bill is what the customer paid. Saved as `online.menuSync`; the hub gets it within moments.
 */
export function MenuSyncDialog({ channel, hubConnected, onClose }: { channel: SalesChannel; hubConnected: boolean; onClose: () => void }) {
  const { api, can } = useApp();
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ['config'], queryFn: () => api.get<OutletConfig>('/v1/config') });
  const menu = useQuery({ queryKey: ['menu'], queryFn: () => api.get<MenuSnapshot>('/v1/menu') });
  const start = config.data?.['online.menuSync'][channel];
  const [draft, setDraft] = useState<{ mode: ChannelSync['mode']; chosen: Set<string>; pricing: ChannelSync['pricing']; markup: string; own: Record<string, string> } | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<'save' | 'sync' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const readOnly = !can('admin');

  const d =
    draft ??
    (start
      ? {
          mode: start.mode,
          chosen: new Set(start.items),
          pricing: start.pricing,
          markup: start.markupBp ? String(start.markupBp / 100) : '',
          own: Object.fromEntries(Object.entries(start.prices).map(([id, p]) => [id, rupeesText(p)])),
        }
      : null);
  const set = (patch: Partial<NonNullable<typeof d>>) => d && setDraft({ ...d, ...patch });

  const rows = useMemo<Row[]>(() => {
    const m = menu.data;
    if (!m) return [];
    const cat = new Map(m.categories.map((c) => [c.id, c.name]));
    return m.items
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((i) =>
        i.variants.length
          ? i.variants.map((v) => ({ onlineId: `${i.id}:${v.id}`, itemId: i.id, name: `${i.name} (${v.name})`, category: cat.get(i.categoryId) ?? '', pricePaise: v.pricePaise, image: i.image }))
          : [{ onlineId: i.id, itemId: i.id, name: i.name, category: cat.get(i.categoryId) ?? '', pricePaise: i.pricePaise, image: i.image }],
      );
  }, [menu.data]);

  if (!d || !menu.data || !config.data) {
    return (
      <Modal title={`Menu sync: ${NAME[channel]}`} onClose={onClose} wide>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Modal>
    );
  }

  const listed = (itemId: string) => d.mode === 'all' || (d.mode === 'include' ? d.chosen.has(itemId) : !d.chosen.has(itemId));
  const toggle = (itemId: string) => {
    const n = new Set(d.chosen);
    if (n.has(itemId)) n.delete(itemId);
    else n.add(itemId);
    set({ chosen: n });
  };
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.category.toLowerCase().includes(needle));
  const dishes = new Set(rows.map((r) => r.itemId));
  const count = [...dishes].filter(listed).length;

  /** The channel's settings from the form; throws a message for the person when something is not a number. */
  const build = (): ChannelSync => {
    const pct = d.markup.trim() ? Number(d.markup) : 0; // a percentage, e.g. 15 or 12.5 (not money)
    if (!Number.isFinite(pct) || pct < -50 || pct > 100) throw new Error('Enter the price change as a percentage between -50 and 100, like 15.');
    const prices: Record<string, number> = {};
    for (const [id, v] of Object.entries(d.own)) {
      if (!v.trim()) continue;
      let p: number;
      try {
        p = parseRupees(v);
      } catch {
        throw new Error(`The price for ${rows.find((r) => r.onlineId === id)?.name ?? 'a dish'} is not an amount in rupees.`);
      }
      prices[id] = p;
    }
    return {
      mode: d.mode,
      items: d.mode === 'all' ? [] : [...d.chosen].filter((id) => dishes.has(id)),
      pricing: d.pricing,
      markupBp: d.pricing === 'custom' ? Math.round(pct * 100) : 0,
      prices: d.pricing === 'custom' ? prices : {},
    };
  };
  const preview: ChannelSync | null = (() => {
    try {
      return build();
    } catch {
      return null;
    }
  })();

  const save = async (thenSync: boolean) => {
    setError(null);
    setNote(null);
    let mine: ChannelSync;
    try {
      mine = build();
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setBusy(thenSync ? 'sync' : 'save');
    try {
      const all: MenuSync = { ...config.data['online.menuSync'], [channel]: mine };
      await api.command('SetConfig', { values: { 'online.menuSync': all } });
      await qc.invalidateQueries({ queryKey: ['config'] });
      setDraft(null);
      if (thenSync) {
        const r = await api.send<{ menuVersion: number }>('POST', '/v1/online/menu/publish', {});
        setNote(`Menu sent to the order hub (version ${r.menuVersion}).`);
      } else onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save. Try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title={`Menu sync: ${NAME[channel]}`} onClose={onClose} wide>
      <p className="mb-3 text-sm text-muted-foreground">
        {count} of {dishes.size} dishes listed on {NAME[channel]}. Photos, names and the GST rate come from the menu (Settings › Menu).
      </p>

      <div className="mb-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Which dishes">
        {MODES.map(([m, label, hint]) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={d.mode === m}
            disabled={readOnly}
            onClick={() => set({ mode: m })}
            className={`flex flex-col rounded-xl border p-3 text-left text-sm ${d.mode === m ? 'border-primary bg-primary/10' : 'border-border'}`}
          >
            <span className="font-semibold">{label}</span>
            <span className="text-xs text-muted-foreground">{hint}</span>
          </button>
        ))}
      </div>

      <div className="mb-3 rounded-xl border border-border p-3">
        <p className="mb-2 text-sm font-semibold">Prices on {NAME[channel]}</p>
        <div className="flex flex-wrap items-center gap-4 text-sm" role="radiogroup" aria-label="Prices">
          <label className="flex items-center gap-2">
            <input type="radio" name="pricing" disabled={readOnly} checked={d.pricing === 'same'} onChange={() => set({ pricing: 'same' })} />
            Same as the POS
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="pricing" disabled={readOnly} checked={d.pricing === 'custom'} onChange={() => set({ pricing: 'custom' })} />
            Different prices
          </label>
          {d.pricing === 'custom' ? (
            <label className="flex items-center gap-2">
              Change all by
              <input className="input h-9 w-20" inputMode="decimal" disabled={readOnly} placeholder="0" value={d.markup} onChange={(e) => set({ markup: e.target.value })} aria-label="Price change in percent" />%
              <span className="text-xs text-muted-foreground">(to the nearest ₹1; type a price below to set one dish)</span>
            </label>
          ) : null}
        </div>
        {d.pricing === 'custom' ? (
          <p className="mt-2 text-xs text-muted-foreground">Online bills for {NAME[channel]} use these prices, so the bill matches what the customer pays. GST is worked out on them. Your CA should confirm this.</p>
        ) : null}
      </div>

      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input className="input w-full pl-9" placeholder="Search dishes or categories" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search dishes" />
        {q ? (
          <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground" onClick={() => setQ('')} aria-label="Clear search">
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <ul className="max-h-[34vh] overflow-y-auto rounded-xl border border-border" aria-label="Dishes">
        {shown.map((r) => {
          const on = listed(r.itemId);
          const price = preview ? channelPrice(r.onlineId, r.pricePaise, preview) : r.pricePaise;
          return (
            <li key={r.onlineId} className={`flex items-center gap-3 border-b border-border p-2 last:border-0 ${on ? '' : 'opacity-50'}`} data-dish={r.name}>
              <input type="checkbox" className="h-4 w-4" disabled={readOnly || d.mode === 'all'} checked={on} onChange={() => toggle(r.itemId)} aria-label={`List ${r.name}`} />
              <DishPhoto name={r.image} label={r.name} className="h-10 w-10 shrink-0 rounded-lg text-base" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{r.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{r.category}</span>
              </span>
              <span className="shrink-0 text-right text-sm tabular-nums">
                {formatINR(r.pricePaise)}
                {price !== r.pricePaise ? <span className="block text-xs font-semibold text-primary">{formatINR(price)} here</span> : null}
              </span>
              {d.pricing === 'custom' ? (
                <input
                  className="input h-9 w-24 shrink-0"
                  inputMode="decimal"
                  disabled={readOnly || !on}
                  placeholder={d.markup ? `${Number(d.markup) > 0 ? '+' : ''}${d.markup}%` : 'same'}
                  value={d.own[r.onlineId] ?? ''}
                  onChange={(e) => set({ own: { ...d.own, [r.onlineId]: e.target.value } })}
                  aria-label={`${r.name} price on ${NAME[channel]}`}
                />
              ) : null}
            </li>
          );
        })}
        {shown.length === 0 ? <li className="p-4 text-sm text-muted-foreground">No dish matches.</li> : null}
      </ul>

      <ErrorText error={error} />
      {note ? (
        <p className="mt-2 text-sm font-semibold text-ok" role="status">
          {note}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn" onClick={onClose}>
          Close
        </button>
        {!readOnly ? (
          <>
            {hubConnected ? (
              <button className="btn ml-auto" disabled={busy !== null} onClick={() => void save(true)}>
                <RefreshCw className={`h-4 w-4 ${busy === 'sync' ? 'animate-spin' : ''}`} /> Save and sync now
              </button>
            ) : null}
            <button className={`btn btn-primary ${hubConnected ? '' : 'ml-auto'}`} disabled={busy !== null} onClick={() => void save(false)}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
