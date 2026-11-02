import type { OrderItemSnapshot, OrderSnapshot } from '@dinepos/shared';
import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '../components/Modal.js';

type Mode = 'equal' | 'items' | 'proportion';

/**
 * Split the printed bill (P2-05, docs/09 §4): equal parts, by item (quantities can be shared: 2 naan here, 1
 * there), or by proportion. Each part becomes its own numbered bill; the parts add up to the bill exactly and each
 * is rounded. Amounts come from the server after the split.
 */
export function SplitDialog({ order, onClose, run }: { order: OrderSnapshot; onClose: () => void; run: (type: string, payload: unknown, done?: string) => Promise<boolean> }) {
  const lines = order.items.filter((i) => i.status === 'fired');
  const [mode, setMode] = useState<Mode>('equal');
  const [n, setN] = useState(2);
  const [weights, setWeights] = useState<number[]>([1, 1]);
  // By item: qty of each line in each part; everything starts in part 1.
  const [alloc, setAlloc] = useState<number[][]>(() => lines.map((l) => [l.qty, 0]));
  const [busy, setBusy] = useState(false);

  const partsCount = mode === 'equal' ? n : mode === 'proportion' ? weights.length : (alloc[0]?.length ?? 2);
  const setParts = (k: number) => {
    const c = Math.min(10, Math.max(2, k));
    if (mode === 'equal') setN(c);
    else if (mode === 'proportion') setWeights((w) => Array.from({ length: c }, (_, i) => w[i] ?? 1));
    else {
      // New parts start empty; items in a removed part go back to part 1.
      setAlloc((a) =>
        a.map((row) => {
          const next = Array.from({ length: c }, (_, i) => row[i] ?? 0);
          next[0]! += row.slice(c).reduce((s, x) => s + x, 0);
          return next;
        }),
      );
    }
  };
  const move = (li: number, from: number, to: number) =>
    setAlloc((a) => a.map((row, i) => (i !== li || row[from]! === 0 ? row : row.map((q, p) => (p === from ? q - 1 : p === to ? q + 1 : q)))));
  const emptyPart = mode === 'items' && Array.from({ length: partsCount }, (_, p) => alloc.every((row) => row[p] === 0)).some(Boolean);

  const submit = async () => {
    setBusy(true);
    const payload =
      mode === 'equal'
        ? { mode, parts: n }
        : mode === 'proportion'
          ? { mode, parts: weights.map((weight) => ({ weight })) }
          : { mode, parts: Array.from({ length: partsCount }, (_, p) => ({ items: lines.map((l, i) => ({ orderItemId: l.id, qty: alloc[i]![p]! })).filter((x) => x.qty > 0) })) };
    const ok = await run('SplitBill', payload, `Bill split into ${partsCount} parts. Each part prints with its own bill number.`);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal title="Split bill" onClose={onClose} wide>
      <div className="mb-4 flex items-center gap-2">
        <div role="tablist" aria-label="How to split" className="flex gap-1">
          {(
            [
              ['equal', 'Equally'],
              ['items', 'By item'],
              ['proportion', 'By share'],
            ] as const
          ).map(([m, label]) => (
            <button key={m} role="tab" className="tab" aria-selected={mode === m} onClick={() => setMode(m)}>
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm font-semibold">Parts</span>
          <button className="btn h-9 w-9 px-0" aria-label="Fewer parts" disabled={partsCount <= 2} onClick={() => setParts(partsCount - 1)}>
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-6 text-center text-lg font-bold tabular-nums" data-testid="split-parts">
            {partsCount}
          </span>
          <button className="btn h-9 w-9 px-0" aria-label="More parts" disabled={partsCount >= 10} onClick={() => setParts(partsCount + 1)}>
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {mode === 'equal' ? <p className="text-sm text-muted-foreground">Every item is shared equally; each part pays about 1/{n} of the bill, rounded to whole rupees.</p> : null}

      {mode === 'proportion' ? (
        <div className="flex flex-wrap gap-3">
          {weights.map((w, i) => (
            <label key={i} className="text-sm font-semibold">
              Part {i + 1} share
              <input
                className="input mt-1 w-24"
                inputMode="numeric"
                aria-label={`Part ${i + 1} share`}
                value={w}
                onChange={(e) => setWeights((ws) => ws.map((x, j) => (j === i ? Math.min(100, Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1)) : x)))}
              />
            </label>
          ))}
          <p className="w-full text-xs text-muted-foreground">E.g. 2 and 1: the first part pays two thirds.</p>
        </div>
      ) : null}

      {mode === 'items' ? (
        <table className="w-full text-sm" aria-label="Items by part">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-1">Item</th>
              {Array.from({ length: partsCount }, (_, p) => (
                <th key={p} className="py-1 text-center">
                  Part {p + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l: OrderItemSnapshot, i) => (
              <tr key={l.id} className="border-t border-border">
                <td className="py-1.5 pr-2">
                  <span className="font-semibold tabular-nums">{l.qty} ×</span> {l.name}
                </td>
                {alloc[i]!.map((q, p) => (
                  <td key={p} className="py-1 text-center">
                    <span className="inline-flex items-center gap-1">
                      <button className="btn h-7 w-7 px-0" aria-label={`Move one ${l.name} out of part ${p + 1}`} disabled={q === 0} onClick={() => move(i, p, (p + 1) % partsCount)} title="Move one to the next part">
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-5 font-bold tabular-nums" data-testid={`alloc-${i}-${p}`}>
                        {q}
                      </span>
                      <button
                        className="btn h-7 w-7 px-0"
                        aria-label={`Move one ${l.name} into part ${p + 1}`}
                        disabled={q === l.qty}
                        onClick={() => {
                          const from = alloc[i]!.findIndex((x, j) => j !== p && x > 0);
                          if (from >= 0) move(i, from, p);
                        }}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {emptyPart ? <p className="mt-2 text-sm font-semibold text-danger">Every part needs at least one item.</p> : null}
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy || emptyPart} onClick={() => void submit()}>
          {busy ? 'Splitting…' : `Split into ${partsCount} bills`}
        </button>
      </div>
    </Modal>
  );
}
