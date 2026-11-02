import { formatINR, formatQty, newId, parseQty, STOCK_UNITS, UNIT_LABELS, type StockItemView, type StockMovementView, type StockUnit } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { History, Pencil, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useApp } from '../app-context.js';
import { rupeesToPaise } from '../billing/money-input.js';
import { Modal } from '../components/Modal.js';
import { DialogButtons, Empty, ErrorText, Field, Toggle } from '../settings/common.js';
import { KIND_LABEL, qtyText, StatusPill, useStock, useStockCommand, when } from './common.js';

/** Raw materials with balances (from TiffinPOS Stock): add, adjust (wastage, count, correction), history, edit. */
export function MaterialsTab() {
  const stock = useStock();
  const [filter, setFilter] = useState<'all' | 'attention'>('all');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [adjusting, setAdjusting] = useState<StockItemView | null>(null);
  const [history, setHistory] = useState<StockItemView | null>(null);
  const [editing, setEditing] = useState<StockItemView | null>(null);
  const items = useMemo(() => stock.data?.items ?? [], [stock.data]);
  const attention = items.filter((i) => i.active && (i.low || i.negative)).length;
  const shown = items.filter((i) => (filter === 'all' || (i.active && (i.low || i.negative))) && (!q.trim() || i.name.toLowerCase().includes(q.trim().toLowerCase())));
  const totalValue = items.reduce((s, i) => s + i.valuePaise, 0);

  if (!stock.data) return <p className="text-muted-foreground">Loading…</p>;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Filter" className="flex gap-1">
          <button role="tab" className="tab" aria-selected={filter === 'all'} onClick={() => setFilter('all')}>
            All ({items.length})
          </button>
          <button role="tab" className="tab" aria-selected={filter === 'attention'} onClick={() => setFilter('attention')}>
            Needs attention ({attention})
          </button>
        </div>
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input className="input pl-9" placeholder="Search materials" aria-label="Search materials" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="text-sm text-muted-foreground">
          Stock value <span className="font-semibold tabular-nums text-foreground">{formatINR(totalValue)}</span>
        </span>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> Add material
        </button>
      </div>

      {items.length === 0 ? (
        <Empty>No materials yet. Add what the kitchen buys: paneer, chicken, oil, flour…</Empty>
      ) : (
        <table className="w-full rounded-xl border border-border bg-card text-sm" aria-label="Materials">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2">Material</th>
              <th className="px-3 py-2 text-right">In stock</th>
              <th className="px-3 py-2 text-right">Reorder at</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Last cost</th>
              <th className="px-3 py-2 text-right">Value</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.id} className={`border-b border-border last:border-0 ${i.active ? '' : 'text-muted-foreground'}`}>
                <td className="px-3 py-2 font-semibold">
                  <span>{i.name}</span>
                  {i.usedIn ? <span className="ml-2 text-xs font-normal text-muted-foreground">in {i.usedIn} recipe{i.usedIn === 1 ? '' : 's'}</span> : null}
                </td>
                <td className={`px-3 py-2 text-right tabular-nums ${i.negative ? 'font-semibold text-danger' : ''}`}>{qtyText(i.onHandMilli, i)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{i.reorderLevelMilli ? qtyText(i.reorderLevelMilli, i) : '—'}</td>
                <td className="px-3 py-2">
                  <StatusPill item={i} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{i.lastUnitCostPaise !== null ? `${formatINR(i.lastUnitCostPaise)} / ${UNIT_LABELS[i.unit]}` : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{i.lastUnitCostPaise !== null ? formatINR(i.valuePaise) : '—'}</td>
                <td className="px-2 py-1">
                  <div className="flex justify-end gap-1">
                    {i.active ? (
                      <button className="btn h-8 px-2" aria-label={`Adjust ${i.name}`} title="Wastage, count or correction" onClick={() => setAdjusting(i)}>
                        <SlidersHorizontal className="h-4 w-4" />
                      </button>
                    ) : null}
                    <button className="btn h-8 px-2" aria-label={`History of ${i.name}`} title="History" onClick={() => setHistory(i)}>
                      <History className="h-4 w-4" />
                    </button>
                    <button className="btn h-8 px-2" aria-label={`Edit ${i.name}`} title="Edit" onClick={() => setEditing(i)}>
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted-foreground">
                  {filter === 'attention' ? 'Nothing is low. Good.' : 'No materials match.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      )}

      {adding ? <MaterialDialog onClose={() => setAdding(false)} /> : null}
      {editing ? <MaterialDialog item={editing} onClose={() => setEditing(null)} /> : null}
      {adjusting ? <AdjustDialog item={adjusting} onClose={() => setAdjusting(null)} /> : null}
      {history ? <HistoryDialog item={history} onClose={() => setHistory(null)} /> : null}
    </>
  );
}

function MaterialDialog({ item, onClose }: { item?: StockItemView; onClose: () => void }) {
  const { send, busy, error, setError } = useStockCommand();
  const [name, setName] = useState(item?.name ?? '');
  const [unit, setUnit] = useState<StockUnit>(item?.unit ?? 'kg');
  const [reorder, setReorder] = useState(item?.reorderLevelMilli ? formatQty(item.reorderLevelMilli) : '');
  const [opening, setOpening] = useState('');
  const [cost, setCost] = useState('');
  const [active, setActive] = useState(item?.active ?? true);
  const u = UNIT_LABELS[unit];

  const submit = () => {
    const reorderMilli = reorder.trim() ? parseQty(reorder) : 0;
    const openingMilli = opening.trim() ? parseQty(opening) : 0;
    const costPaise = cost.trim() ? rupeesToPaise(cost) : null;
    if (reorderMilli === null || openingMilli === null) return setError(`Quantities are in ${u}, like 5 or 2.5.`);
    if (cost.trim() && costPaise === null) return setError('Cost is in rupees, like 56 or 56.50.');
    void send('UpsertStockItem', {
      id: item?.id ?? newId(),
      name: name.trim(),
      unit,
      reorderLevelMilli: reorderMilli,
      active,
      opening: !item && openingMilli > 0 ? { qtyMilli: openingMilli, unitCostPaise: costPaise } : null,
    }).then((ok) => ok && onClose());
  };

  return (
    <Modal title={item ? `Edit ${item.name}` : 'Add a material'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label="Name">
                <input data-autofocus className="input" maxLength={80} placeholder="Paneer" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
            </div>
            <Field label="Unit" hint={item ? 'Fixed once added.' : undefined}>
              <select className="input" value={unit} disabled={!!item} onChange={(e) => setUnit(e.target.value as StockUnit)}>
                {STOCK_UNITS.map((x) => (
                  <option key={x} value={x}>
                    {UNIT_LABELS[x]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={`Reorder at (${u})`} hint="Shown as Low below this level. Leave empty for no alert.">
            <input className="input" inputMode="decimal" value={reorder} onChange={(e) => setReorder(e.target.value)} />
          </Field>
          {!item ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label={`Opening stock (${u})`} hint="What is on the shelf now.">
                <input className="input" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} />
              </Field>
              <Field label={`Cost ₹ per ${u}`} hint="Optional; purchases update it.">
                <input className="input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
              </Field>
            </div>
          ) : (
            <Toggle checked={active} onChange={setActive} label="In use" hint="Switch off a material you no longer buy. Its history is kept." />
          )}
        </div>
        <ErrorText error={error} />
        <DialogButtons busy={busy} onCancel={onClose} disabled={!name.trim()} />
      </form>
    </Modal>
  );
}

type AdjustKind = 'wastage' | 'count' | 'adjust';

function AdjustDialog({ item, onClose }: { item: StockItemView; onClose: () => void }) {
  const { send, busy, error, setError } = useStockCommand();
  const [kind, setKind] = useState<AdjustKind>('wastage');
  const [sign, setSign] = useState<1 | -1>(-1);
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const u = UNIT_LABELS[item.unit];
  const tabs: Array<[AdjustKind, string]> = [
    ['wastage', 'Wastage'],
    ['count', 'Physical count'],
    ['adjust', 'Correction'],
  ];

  const submit = () => {
    const milli = parseQty(qty);
    if (milli === null || (kind !== 'count' && milli === 0)) return setError(`Enter a quantity in ${u}, like 2 or 0.5.`);
    if (kind !== 'count' && !reason.trim()) return setError('Give a short reason.');
    const payload = { kind, stockItemId: item.id, qtyMilli: kind === 'adjust' ? sign * milli : milli, reason: reason.trim() || null };
    void send('AdjustStock', payload).then((ok) => ok && onClose());
  };

  return (
    <Modal title={`Adjust ${item.name}`} onClose={onClose}>
      <p className="mb-3 text-sm text-muted-foreground">
        In stock now: <span className="font-semibold text-foreground">{qtyText(item.onHandMilli, item)}</span>
      </p>
      <div className="mb-3 flex gap-1" role="tablist" aria-label="Kind of change">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            role="tab"
            type="button"
            className="tab"
            aria-selected={kind === k}
            onClick={() => {
              setKind(k);
              setError(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="mb-2 text-sm">
          {kind === 'wastage' ? 'How much was spoiled, spilled or thrown away?' : kind === 'count' ? 'How much is actually on the shelf? Stock is set to this amount.' : 'Fix a mistake, for example a wrong quantity in an earlier entry.'}
        </p>
        <div className="flex gap-2">
          {kind === 'adjust' ? (
            <div className="flex gap-1" role="radiogroup" aria-label="Add or remove">
              <button type="button" role="radio" aria-checked={sign === 1} className={`btn w-10 px-0 ${sign === 1 ? 'btn-primary' : ''}`} aria-label="Add to stock" onClick={() => setSign(1)}>
                +
              </button>
              <button type="button" role="radio" aria-checked={sign === -1} className={`btn w-10 px-0 ${sign === -1 ? 'btn-primary' : ''}`} aria-label="Remove from stock" onClick={() => setSign(-1)}>
                −
              </button>
            </div>
          ) : null}
          <input data-autofocus className="input flex-1" inputMode="decimal" placeholder={`Quantity in ${u}`} aria-label={`Quantity in ${u}`} value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <input className="input mt-2" maxLength={200} placeholder={kind === 'count' ? 'Note (optional)' : 'Reason'} aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <ErrorText error={error} />
        <DialogButtons busy={busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function HistoryDialog({ item, onClose }: { item: StockItemView; onClose: () => void }) {
  const { api } = useApp();
  const moves = useQuery({ queryKey: ['stock-moves', item.id], queryFn: () => api.get<{ movements: StockMovementView[] }>(`/v1/stock/${item.id}/movements?limit=200`) });
  return (
    <Modal title={`${item.name}: history`} onClose={onClose} wide>
      <div className="max-h-[60vh] overflow-y-auto">
        <table className="w-full text-sm" aria-label="History">
          <thead className="sticky top-0 bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="py-2">When</th>
              <th>What</th>
              <th className="text-right">Change</th>
              <th className="pl-4">Details</th>
            </tr>
          </thead>
          <tbody>
            {moves.data?.movements.map((m) => (
              <tr key={m.id} className="border-t border-border">
                <td className="whitespace-nowrap py-2 pr-3">{when(m.at)}</td>
                <td>{KIND_LABEL[m.kind]}</td>
                <td className={`text-right tabular-nums ${m.deltaMilli < 0 ? 'text-danger' : 'text-ok'}`}>
                  {m.deltaMilli > 0 ? '+' : ''}
                  {qtyText(m.deltaMilli, item)}
                </td>
                <td className="pl-4 text-muted-foreground">{[m.refText, m.reason, m.userName].filter(Boolean).join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {moves.data?.movements.length === 0 ? <p className="py-4 text-center text-muted-foreground">No movements yet.</p> : null}
        {!moves.data ? <p className="py-4 text-center text-muted-foreground">Loading…</p> : null}
      </div>
    </Modal>
  );
}
