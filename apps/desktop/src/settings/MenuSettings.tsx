import { formatINR, newId } from '@dinepos/shared';
import { Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { bpToPercentText, paiseToInput, rupeesToPaise } from '../billing/money-input.js';
import { Modal } from '../components/Modal.js';
import { DishPhoto } from '../components/DishPhoto.js';
import { VegMark } from '../components/VegMark.js';
import { BulkPhotos } from './BulkPhotos.js';
import { ItemPhoto } from './ItemPhoto.js';
import { MenuImport } from './MenuImport.js';
import { DialogButtons, Empty, ErrorText, Field, GST_RATES, SectionHeader, Toggle, useCatalog, useSave, type AdminCatalog } from './common.js';

type Item = AdminCatalog['items'][number];
type Category = AdminCatalog['categories'][number];
type Group = AdminCatalog['addonGroups'][number];
type Tab = 'items' | 'categories' | 'addons' | 'import' | 'photos';

/** Menu: categories, items with options and add-ons (docs/02 menu model). */
export function MenuSettings() {
  const catalog = useCatalog();
  const [tab, setTab] = useState<Tab>('items');
  if (!catalog.data) return <p className="text-muted-foreground">Loading…</p>;
  return (
    <div className="max-w-5xl">
      <SectionHeader title="Menu" subtitle="Changes reach every terminal at once. Prices on orders already taken do not change." />
      <div className="mb-4 flex gap-1" role="tablist" aria-label="Menu parts">
        {(
          [
            ['items', `Items (${catalog.data.items.length})`],
            ['categories', `Categories (${catalog.data.categories.length})`],
            ['addons', `Add-on groups (${catalog.data.addonGroups.length})`],
            ['import', 'Bulk upload'],
            ['photos', `Bulk photos (${catalog.data.items.filter((i) => i.image).length} with photo)`],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="tab" className="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'items' ? <Items catalog={catalog.data} /> : null}
      {tab === 'categories' ? <Categories catalog={catalog.data} /> : null}
      {tab === 'addons' ? <AddonGroups catalog={catalog.data} /> : null}
      {tab === 'import' ? <MenuImport catalog={catalog.data} /> : null}
      {tab === 'photos' ? <BulkPhotos catalog={catalog.data} /> : null}
    </div>
  );
}

const gstText = (bp: number) => `${bpToPercentText(bp)}%`;

function Items({ catalog }: { catalog: AdminCatalog }) {
  const [categoryId, setCategoryId] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const station = (id: string | null) => catalog.stations.find((s) => s.id === id)?.name;
  const catName = (id: string) => catalog.categories.find((c) => c.id === id)?.name ?? '?';
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return catalog.items.filter((i) => (!categoryId || i.categoryId === categoryId) && (!term || i.name.toLowerCase().includes(term) || i.shortCode?.toLowerCase().startsWith(term)));
  }, [catalog.items, categoryId, q]);

  if (catalog.categories.length === 0) return <Empty>Add a category first (Categories tab), then its items, or add many at once with Bulk upload.</Empty>;
  return (
    <>
      <div className="mb-3 flex gap-2">
        <select className="input w-56" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Category filter">
          <option value="">All categories</option>
          {catalog.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input className="input pl-9" placeholder="Search name or code" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" />
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" /> Add item
        </button>
      </div>
      <table className="w-full rounded-xl border border-border bg-card text-sm" aria-label="Items">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2">Item</th>
            <th className="px-3 py-2">Code</th>
            <th className="px-3 py-2">Category</th>
            <th className="px-3 py-2 text-right">Price</th>
            <th className="px-3 py-2">GST</th>
            <th className="px-3 py-2">Kitchen</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {shown.map((i) => (
            <tr key={i.id} className={i.active ? '' : 'opacity-50'}>
              <td className="px-3 py-2">
                <span className="flex items-center gap-2 font-semibold">
                  <DishPhoto name={i.image} label={i.name} className="h-9 w-9 shrink-0 rounded-md text-base" />
                  <VegMark veg={i.veg} />
                  {i.name}
                  {!i.active ? <span className="text-xs font-normal">(off the menu)</span> : !i.available ? <span className="rounded bg-secondary px-1.5 text-xs font-normal">out today</span> : null}
                </span>
                {i.variants.length ? <span className="ml-[4.25rem] text-xs text-muted-foreground">{i.variants.map((v) => v.name).join(' / ')}</span> : null}
              </td>
              <td className="px-3 py-2 font-mono text-xs">{i.shortCode}</td>
              <td className="px-3 py-2">{catName(i.categoryId)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{i.variants.length ? `from ${formatINR(Math.min(...i.variants.map((v) => v.pricePaise)))}` : formatINR(i.basePricePaise)}</td>
              <td className="px-3 py-2">{gstText(i.taxRateBp)}</td>
              <td className="px-3 py-2 text-muted-foreground">{station(i.stationId) ?? `${station(catalog.categories.find((c) => c.id === i.categoryId)?.stationId ?? null) ?? '—'} (category)`}</td>
              <td className="px-3 py-2 text-right">
                <button className="btn h-8" onClick={() => setEditing(i)}>
                  Edit
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No items match.</p> : null}
      {editing ? <ItemDialog item={editing === 'new' ? null : editing} catalog={catalog} defaultCategoryId={categoryId || catalog.categories[0]!.id} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

interface VariantRow {
  id: string;
  name: string;
  price: string;
  saved: boolean;
}

function ItemDialog({ item, catalog, defaultCategoryId, onClose }: { item: Item | null; catalog: AdminCatalog; defaultCategoryId: string; onClose: () => void }) {
  const { save, busy, error, setError } = useSave();
  const [f, setF] = useState({
    name: item?.name ?? '',
    shortCode: item?.shortCode ?? '',
    categoryId: item?.categoryId ?? defaultCategoryId,
    veg: item?.veg ?? true,
    price: item ? paiseToInput(item.basePricePaise) : '',
    gst: String(item?.taxRateBp ?? 500),
    hsn: item?.hsnSac ?? '',
    stationId: item?.stationId ?? '',
    available: item?.available ?? true,
    active: item?.active ?? true,
  });
  const [variants, setVariants] = useState<VariantRow[]>((item?.variants ?? []).map((v) => ({ id: v.id, name: v.name, price: paiseToInput(v.pricePaise), saved: true })));
  const [groups, setGroups] = useState<Set<string>>(new Set(item?.addonGroupIds ?? []));
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const pricePaise = rupeesToPaise(f.price);

  const submit = () => {
    if (!f.name.trim()) return setError('Give the item a name.');
    if (pricePaise === null) return setError('The price is in rupees, e.g. 280 or 249.50.');
    const v = variants.filter((r) => r.name.trim()).map((r, idx) => ({ id: r.id, name: r.name.trim(), pricePaise: rupeesToPaise(r.price), sort: idx }));
    if (v.some((x) => x.pricePaise === null)) return setError('Every option needs a price in rupees.');
    void save('UpsertMenuItem', {
      id: item?.id ?? newId(),
      categoryId: f.categoryId,
      name: f.name.trim(),
      shortCode: f.shortCode.trim() || null,
      veg: f.veg,
      basePricePaise: pricePaise,
      taxRateBp: Number(f.gst),
      hsnSac: f.hsn.trim() || null,
      stationId: f.stationId || null,
      available: f.available,
      active: f.active,
      sort: item?.sort ?? catalog.items.length,
      variants: v,
      addonGroupIds: [...groups],
    }).then((ok) => ok && onClose());
  };

  return (
    <Modal title={item ? `Edit ${item.name}` : 'Add an item'} onClose={onClose} wide>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {item ? (
          <div className="mb-4 border-b border-border pb-4">
            <ItemPhoto itemId={item.id} name={item.name} image={catalog.items.find((x) => x.id === item.id)?.image ?? null} />
          </div>
        ) : null}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label="Name (printed on KOTs and bills)">
              <input data-autofocus className="input" value={f.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} />
            </Field>
          </div>
          <Field label="Short code" hint="Typed on the billing screen: PT, DM, C65.">
            <input className="input uppercase" value={f.shortCode} maxLength={8} onChange={(e) => set({ shortCode: e.target.value.replace(/[^A-Za-z0-9]/g, '') })} />
          </Field>
          <Field label="Category">
            <select className="input" value={f.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
              {catalog.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Price (₹)" hint={variants.length ? 'Used when no option is chosen.' : undefined}>
            <input className="input text-right tabular-nums" inputMode="decimal" value={f.price} onChange={(e) => set({ price: e.target.value })} />
          </Field>
          <Field label="GST rate">
            <select className="input" value={f.gst} onChange={(e) => set({ gst: e.target.value })}>
              {[...new Set([...GST_RATES, Number(f.gst)])].map((bp) => (
                <option key={bp} value={bp}>
                  {gstText(bp)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Food type">
            <div className="flex gap-2" role="radiogroup">
              {[true, false].map((veg) => (
                <button key={String(veg)} type="button" role="radio" aria-checked={f.veg === veg} onClick={() => set({ veg })} className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-md text-sm font-semibold ${f.veg === veg ? 'bg-foreground text-background' : 'bg-secondary'}`}>
                  <VegMark veg={veg} /> {veg ? 'Veg' : 'Non-veg'}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Kitchen station" hint="Empty: use the category's station.">
            <select className="input" value={f.stationId} onChange={(e) => set({ stationId: e.target.value })}>
              <option value="">From the category</option>
              {catalog.stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="HSN / SAC" hint="Restaurant service: 996331.">
            <input className="input" inputMode="numeric" value={f.hsn} maxLength={8} onChange={(e) => set({ hsn: e.target.value.replace(/\D/g, '') })} />
          </Field>
        </div>

        <fieldset className="mt-4 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-semibold">Options (e.g. Half / Full) — the cashier must pick one</legend>
          {variants.map((v, idx) => (
            <div key={v.id} className="mb-2 flex gap-2">
              <input className="input flex-1" placeholder="Name" aria-label={`Option ${idx + 1} name`} value={v.name} onChange={(e) => setVariants(variants.map((x) => (x.id === v.id ? { ...x, name: e.target.value } : x)))} />
              <input className="input w-32 text-right" placeholder="₹" inputMode="decimal" aria-label={`Option ${idx + 1} price`} value={v.price} onChange={(e) => setVariants(variants.map((x) => (x.id === v.id ? { ...x, price: e.target.value } : x)))} />
              <button type="button" className="btn h-10 w-10 px-0" disabled={v.saved} title={v.saved ? 'Saved options stay (bills refer to them). Turn the item off instead.' : 'Remove'} aria-label={`Remove option ${idx + 1}`} onClick={() => setVariants(variants.filter((x) => x.id !== v.id))}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button type="button" className="btn h-8" onClick={() => setVariants([...variants, { id: newId(), name: '', price: '', saved: false }])}>
            <Plus className="h-4 w-4" /> Add option
          </button>
        </fieldset>

        <fieldset className="mt-3 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-semibold">Add-on groups offered with this item</legend>
          {catalog.addonGroups.length === 0 ? <p className="text-xs text-muted-foreground">No add-on groups yet (Add-on groups tab).</p> : null}
          <div className="grid grid-cols-2 gap-1">
            {catalog.addonGroups.map((g) => (
              <Toggle key={g.id} checked={groups.has(g.id)} onChange={(on) => setGroups((s) => { const n = new Set(s); if (on) n.add(g.id); else n.delete(g.id); return n; })} label={g.name} hint={g.addons.map((a) => a.name).join(', ')} />
            ))}
          </div>
        </fieldset>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Toggle checked={f.available} onChange={(available) => set({ available })} label="Available today" hint="Untick when it runs out; it stays on the menu greyed out." />
          <Toggle checked={f.active} onChange={(active) => set({ active })} label="On the menu" hint="Untick to remove it from the menu (history is kept)." />
        </div>
        <ErrorText error={error} />
        <DialogButtons busy={busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function Categories({ catalog }: { catalog: AdminCatalog }) {
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const count = (id: string) => catalog.items.filter((i) => i.categoryId === id).length;
  return (
    <>
      <div className="mb-3 flex justify-end">
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" /> Add category
        </button>
      </div>
      {catalog.categories.length === 0 ? <Empty>No categories yet: Starters, Main course, Breads, Beverages…</Empty> : null}
      <ul className="divide-y divide-border rounded-xl border border-border bg-card" aria-label="Categories">
        {catalog.categories.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-4 py-3">
            <span className="flex-1">
              <span className="font-semibold">{c.name}</span>
              <span className="ml-2 text-sm text-muted-foreground">
                {count(c.id)} items · kitchen: {catalog.stations.find((s) => s.id === c.stationId)?.name ?? 'not set'}
              </span>
            </span>
            <button className="btn h-8" onClick={() => setEditing(c)}>
              Edit
            </button>
          </li>
        ))}
      </ul>
      {editing ? <CategoryDialog category={editing === 'new' ? null : editing} catalog={catalog} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function CategoryDialog({ category, catalog, onClose }: { category: Category | null; catalog: AdminCatalog; onClose: () => void }) {
  const { save, busy, error } = useSave();
  const [name, setName] = useState(category?.name ?? '');
  const [stationId, setStationId] = useState(category?.stationId ?? catalog.stations[0]?.id ?? '');
  const [sort, setSort] = useState(String(category?.sort ?? catalog.categories.length));
  return (
    <Modal title={category ? `Category: ${category.name}` : 'Add a category'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save('UpsertCategory', { id: category?.id ?? newId(), name: name.trim(), parentId: category?.parentId ?? null, stationId: stationId || null, sort: Number(sort) || 0 }).then((ok) => ok && onClose());
        }}
      >
        <div className="space-y-3">
          <Field label="Name">
            <input data-autofocus className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Kitchen station" hint="Where its KOTs print, unless an item says otherwise.">
            <select className="input" value={stationId} onChange={(e) => setStationId(e.target.value)}>
              <option value="">Not set</option>
              {catalog.stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Order on the billing screen">
            <input className="input" inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
        <ErrorText error={error} />
        <DialogButtons busy={busy} onCancel={onClose} disabled={!name.trim()} />
      </form>
    </Modal>
  );
}

function AddonGroups({ catalog }: { catalog: AdminCatalog }) {
  const [editing, setEditing] = useState<Group | 'new' | null>(null);
  return (
    <>
      <div className="mb-3 flex justify-end">
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" /> Add group
        </button>
      </div>
      {catalog.addonGroups.length === 0 ? <Empty>No add-on groups yet: Spice level, Extras, Mixers…</Empty> : null}
      <ul className="grid grid-cols-2 gap-3" aria-label="Add-on groups">
        {catalog.addonGroups.map((g) => (
          <li key={g.id}>
            <button className="w-full rounded-xl border border-border bg-card p-4 text-left hover:border-ring" onClick={() => setEditing(g)}>
              <span className="block font-semibold">{g.name}</span>
              <span className="block text-xs text-muted-foreground">
                {g.minSelect > 0 ? `Choose ${g.minSelect === g.maxSelect ? g.minSelect : `${g.minSelect}–${g.maxSelect}`}` : `Optional, up to ${g.maxSelect}`} · {g.addons.map((a) => `${a.name}${a.pricePaise ? ` +${formatINR(a.pricePaise)}` : ''}`).join(', ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {editing ? <GroupDialog group={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function GroupDialog({ group, onClose }: { group: Group | null; onClose: () => void }) {
  const { save, busy, error, setError } = useSave();
  const [name, setName] = useState(group?.name ?? '');
  const [min, setMin] = useState(String(group?.minSelect ?? 0));
  const [max, setMax] = useState(String(group?.maxSelect ?? 1));
  const [rows, setRows] = useState((group?.addons ?? []).map((a) => ({ id: a.id, name: a.name, price: paiseToInput(a.pricePaise), saved: true })));
  return (
    <Modal title={group ? `Add-on group: ${group.name}` : 'Add an add-on group'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const addons = rows.filter((r) => r.name.trim()).map((r) => ({ id: r.id, name: r.name.trim(), pricePaise: rupeesToPaise(r.price || '0') }));
          if (addons.some((a) => a.pricePaise === null)) return setError('Add-on prices are in rupees (0 for free).');
          if (Number(min) > Number(max)) return setError('"At least" cannot be more than "at most".');
          void save('UpsertAddonGroup', { id: group?.id ?? newId(), name: name.trim(), minSelect: Number(min) || 0, maxSelect: Math.max(1, Number(max) || 1), addons }).then((ok) => ok && onClose());
        }}
      >
        <div className="grid grid-cols-3 gap-3">
          <Field label="Group name">
            <input data-autofocus className="input" value={name} maxLength={80} placeholder="Spice level" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Choose at least" hint="1 = the cashier must pick.">
            <input className="input" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="Choose at most">
            <input className="input" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
        <p className="mb-2 mt-3 text-sm font-semibold">Add-ons (in the order the cashier sees them, keys 1, 2, 3…)</p>
        {rows.map((r, idx) => (
          <div key={r.id} className="mb-2 flex gap-2">
            <input className="input flex-1" placeholder="Name" aria-label={`Add-on ${idx + 1} name`} value={r.name} onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, name: e.target.value } : x)))} />
            <input className="input w-28 text-right" placeholder="₹ 0" inputMode="decimal" aria-label={`Add-on ${idx + 1} price`} value={r.price} onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, price: e.target.value } : x)))} />
            <button type="button" className="btn h-10 w-10 px-0" disabled={r.saved} title={r.saved ? 'Saved add-ons stay (bills refer to them).' : 'Remove'} aria-label={`Remove add-on ${idx + 1}`} onClick={() => setRows(rows.filter((x) => x.id !== r.id))}>
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button type="button" className="btn h-8" onClick={() => setRows([...rows, { id: newId(), name: '', price: '', saved: false }])}>
          <Plus className="h-4 w-4" /> Add add-on
        </button>
        <ErrorText error={error} />
        <DialogButtons busy={busy} onCancel={onClose} disabled={!name.trim()} />
      </form>
    </Modal>
  );
}

