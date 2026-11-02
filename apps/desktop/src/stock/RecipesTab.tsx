import { formatINR, formatQty, parseQty, stockAmount, sumPaise, UNIT_LABELS, type RecipeLineView, type StockItemView } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { CookingPot, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useApp } from '../app-context.js';
import { Modal } from '../components/Modal.js';
import { VegMark } from '../components/VegMark.js';
import { DialogButtons, Empty, ErrorText } from '../settings/common.js';
import { useMenu, useStock, useStockCommand } from './common.js';

type OwnerKind = RecipeLineView['ownerKind'];
interface Owner {
  kind: OwnerKind;
  id: string;
  label: string;
}

/** What each dish uses (from TiffinPOS recipes): ingredients are taken from stock when its KOT is fired. */
export function RecipesTab() {
  const { api } = useApp();
  const menu = useMenu();
  const stock = useStock();
  const recipes = useQuery({ queryKey: ['recipes'], queryFn: () => api.get<{ lines: RecipeLineView[] }>('/v1/recipes') });
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ title: string; owners: Owner[] } | null>(null);
  const byOwner = useMemo(() => {
    const m = new Map<string, RecipeLineView[]>();
    for (const l of recipes.data?.lines ?? []) m.set(`${l.ownerKind}:${l.ownerId}`, [...(m.get(`${l.ownerKind}:${l.ownerId}`) ?? []), l]);
    return m;
  }, [recipes.data]);
  const costs = new Map((stock.data?.items ?? []).map((s) => [s.id, s.lastUnitCostPaise]));
  const costOf = (lines: RecipeLineView[] = []) => sumPaise(lines.map((l) => stockAmount(l.qtyMilli, costs.get(l.stockItemId) ?? 0)));

  if (!menu.data || !stock.data || !recipes.data) return <p className="text-muted-foreground">Loading…</p>;
  const term = q.trim().toLowerCase();
  const items = menu.data.items.filter((i) => !term || i.name.toLowerCase().includes(term) || i.shortCode?.toLowerCase().startsWith(term));
  const addons = menu.data.addonGroups.flatMap((g) => g.addons.map((a) => ({ ...a, group: g.name }))).filter((a) => !term || a.name.toLowerCase().includes(term));
  const withRecipe = menu.data.items.filter((i) => byOwner.has(`item:${i.id}`) || i.variants.some((v) => byOwner.has(`variant:${v.id}`))).length;

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input className="input pl-9" placeholder="Search dishes or add-ons" aria-label="Search recipes" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="text-sm text-muted-foreground">
          {withRecipe} of {menu.data.items.length} dishes have a recipe
        </span>
      </div>
      {stock.data.items.length === 0 ? <Empty>Add materials first (Materials tab), then say what each dish uses.</Empty> : null}
      <table className="w-full rounded-xl border border-border bg-card text-sm" aria-label="Recipes">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2">Dish</th>
            <th className="px-3 py-2">Uses</th>
            <th className="px-3 py-2 text-right">Food cost</th>
            <th className="px-3 py-2 text-right">Price</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const own = byOwner.get(`item:${i.id}`);
            const variantLines = i.variants.filter((v) => byOwner.has(`variant:${v.id}`));
            const owners: Owner[] = [{ kind: 'item', id: i.id, label: i.variants.length ? `${i.name} (any size)` : i.name }, ...i.variants.map((v) => ({ kind: 'variant' as const, id: v.id, label: `${i.name} (${v.name})` }))];
            // Food cost of what is sold: the first size if the dish has sizes (its own recipe, else the dish recipe).
            const first = i.variants[0];
            const shown = first ? (byOwner.get(`variant:${first.id}`) ?? own) : own;
            const cost = shown ? costOf(shown) : null;
            const price = first ? first.pricePaise : i.pricePaise;
            return (
              <tr key={i.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-secondary" onClick={() => setEditing({ title: i.name, owners })}>
                <td className="px-3 py-2 font-semibold">
                  <span className="flex items-center gap-2">
                    <VegMark veg={i.veg} />
                    {i.name}
                    {i.shortCode ? <span className="font-mono text-xs font-normal text-muted-foreground">{i.shortCode}</span> : null}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {own || variantLines.length ? (
                    <span className="flex items-center gap-1.5">
                      <CookingPot className="h-4 w-4 text-muted-foreground" />
                      {own ? `${own.length} ingredient${own.length === 1 ? '' : 's'}` : ''}
                      {variantLines.length ? <span className="text-xs text-muted-foreground">{own ? ' · ' : ''}own recipe for {variantLines.map((v) => v.name).join(', ')}</span> : null}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Add</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{cost !== null ? formatINR(cost) : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {first ? <span className="mr-1 text-xs">{first.name}</span> : null}
                  {formatINR(price)}
                  {cost !== null && price > 0 ? <span className="ml-2 text-xs">({Math.round((cost * 100) / price)}%)</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {addons.length ? (
        <>
          <h3 className="mb-2 mt-6 font-semibold">Add-ons</h3>
          <ul className="grid grid-cols-3 gap-2" aria-label="Add-on recipes">
            {addons.map((a) => {
              const lines = byOwner.get(`addon:${a.id}`);
              return (
                <li key={a.id}>
                  <button className="w-full rounded-xl border border-border bg-card p-3 text-left text-sm hover:border-ring" onClick={() => setEditing({ title: a.name, owners: [{ kind: 'addon', id: a.id, label: a.name }] })}>
                    <span className="block font-semibold">{a.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {a.group} · {lines ? `${lines.length} ingredient${lines.length === 1 ? '' : 's'}, ${formatINR(costOf(lines))}` : 'no recipe'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {editing ? <RecipeDialog title={editing.title} owners={editing.owners} byOwner={byOwner} materials={stock.data.items} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

interface Draft {
  stockItemId: string;
  qty: string;
}

function RecipeDialog({ title, owners, byOwner, materials, onClose }: { title: string; owners: Owner[]; byOwner: Map<string, RecipeLineView[]>; materials: StockItemView[]; onClose: () => void }) {
  const { send, busy, error, setError } = useStockCommand();
  const [ownerIdx, setOwnerIdx] = useState(0);
  const owner = owners[ownerIdx]!;
  const load = (o: Owner): Draft[] => (byOwner.get(`${o.kind}:${o.id}`) ?? []).map((l) => ({ stockItemId: l.stockItemId, qty: formatQty(l.qtyMilli) }));
  const [lines, setLines] = useState<Draft[]>(() => load(owners[0]!));
  const active = materials.filter((m) => m.active);
  const byId = new Map(materials.map((m) => [m.id, m]));
  const cost = sumPaise(lines.map((l) => stockAmount(parseQty(l.qty) ?? 0, byId.get(l.stockItemId)?.lastUnitCostPaise ?? 0)));

  const pick = (i: number) => {
    setOwnerIdx(i);
    setLines(load(owners[i]!));
    setError(null);
  };
  const submit = () => {
    const used = lines.filter((l) => l.stockItemId || l.qty);
    const out: Array<{ stockItemId: string; qtyMilli: number }> = [];
    for (const [i, l] of used.entries()) {
      const m = byId.get(l.stockItemId);
      const qtyMilli = parseQty(l.qty);
      if (!m) return setError(`Line ${i + 1}: choose a material.`);
      if (!qtyMilli) return setError(`Line ${i + 1}: enter how much one portion uses, in ${UNIT_LABELS[m.unit]} (0.2 = 200 g of a kg).`);
      out.push({ stockItemId: m.id, qtyMilli });
    }
    if (new Set(out.map((l) => l.stockItemId)).size !== out.length) return setError('A material appears twice. Combine the lines.');
    void send('SetRecipe', { ownerKind: owner.kind, ownerId: owner.id, lines: out }).then((ok) => ok && onClose());
  };

  return (
    <Modal title={`Recipe: ${title}`} onClose={onClose} wide>
      {owners.length > 1 ? (
        <div className="mb-3 flex flex-wrap gap-1" role="tablist" aria-label="Recipe for">
          {owners.map((o, i) => (
            <button key={o.id} type="button" role="tab" className="tab" aria-selected={i === ownerIdx} onClick={() => pick(i)}>
              {o.label}
              {byOwner.has(`${o.kind}:${o.id}`) ? ' •' : ''}
            </button>
          ))}
        </div>
      ) : null}
      <p className="mb-3 text-sm text-muted-foreground">
        {owner.kind === 'variant'
          ? 'Used for this size only. Leave it empty to use the dish recipe.'
          : owner.kind === 'addon'
            ? 'Used once per add-on taken.'
            : 'Quantities for one portion. Taken from stock when the KOT is sent to the kitchen.'}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <table className="w-full text-sm" aria-label="Ingredients">
          <tbody>
            {lines.map((l, i) => {
              const m = byId.get(l.stockItemId);
              return (
                <tr key={i}>
                  <td className="py-1 pr-2">
                    <select className="input" aria-label={`Ingredient ${i + 1}`} value={l.stockItemId} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, stockItemId: e.target.value } : x)))}>
                      <option value="">Choose…</option>
                      {active.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name} ({UNIT_LABELS[x.unit]})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="w-40 py-1 pr-2">
                    <input
                      className="input"
                      inputMode="decimal"
                      aria-label={`Ingredient ${i + 1} quantity`}
                      placeholder={m ? `${UNIT_LABELS[m.unit]} per portion` : ''}
                      value={l.qty}
                      onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                    />
                  </td>
                  <td className="w-10 py-1">
                    <button type="button" className="btn h-9 w-9 px-0" aria-label={`Remove ingredient ${i + 1}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-2 flex items-center justify-between">
          <button type="button" className="btn h-9" onClick={() => setLines((ls) => [...ls, { stockItemId: '', qty: '' }])}>
            <Plus className="h-4 w-4" /> Add ingredient
          </button>
          <span className="text-sm text-muted-foreground">
            Food cost at last purchase prices: <span className="font-semibold tabular-nums text-foreground">{formatINR(cost)}</span>
          </span>
        </div>
        <ErrorText error={error} />
        <DialogButtons busy={busy} onCancel={onClose} label={lines.length ? 'Save recipe' : 'Remove recipe'} />
      </form>
    </Modal>
  );
}
