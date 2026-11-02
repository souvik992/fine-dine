import { formatINR, type MenuItem, type MenuSnapshot } from '@dinepos/shared';
import { Minus, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../components/Modal.js';
import { groupsOf, selectionProblems, sheetOptions, toggle, type Selection, type SheetOption } from './menu-model.js';

export interface SheetResult {
  variantId: string | null;
  addonIds: string[];
  qty: number;
  note: string | null;
  course: number;
}

const QUICK_NOTES = ['Less spicy', 'No onion', 'No garlic', 'Jain', 'Extra hot'];

/**
 * Item options (docs/09 modifier sheet). Keyboard: 1–9/0 toggle options, Enter adds, Esc cancels,
 * [ and ] change the course, + and − the quantity. The note box takes typing when focused.
 */
export function ModifierSheet({
  menu,
  item,
  initialQty,
  onAdd,
  onClose,
}: {
  menu: MenuSnapshot;
  item: MenuItem;
  initialQty: number;
  onAdd: (r: SheetResult) => void;
  onClose: () => void;
}) {
  const options = useMemo(() => sheetOptions(menu, item), [menu, item]);
  const groups = useMemo(() => groupsOf(menu, item), [menu, item]);
  const [sel, setSel] = useState<Selection>({ variantId: null, addonIds: [] });
  const [qty, setQty] = useState(initialQty);
  const [course, setCourse] = useState(1);
  const [note, setNote] = useState('');
  const problems = selectionProblems(menu, item, sel);

  const pick = (o: SheetOption) => setSel((s) => toggle(menu, item, s, o));
  const submit = () => {
    if (problems.length === 0) onAdd({ ...sel, qty, course, note: note.trim() || null });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inNote = (e.target as HTMLElement | null)?.id === 'sheet-note';
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
        return;
      }
      if (inNote || e.ctrlKey || e.altKey || e.metaKey) return;
      const o = options.find((x) => x.hotkey === e.key);
      if (o) {
        e.preventDefault();
        pick(o);
      } else if (e.key === '+' || e.key === '=') setQty((q) => Math.min(999, q + 1));
      else if (e.key === '-') setQty((q) => Math.max(1, q - 1));
      else if (e.key === ']') setCourse((c) => Math.min(9, c + 1));
      else if (e.key === '[') setCourse((c) => Math.max(1, c - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const section = (title: string, rule: string, list: SheetOption[]) => (
    <fieldset className="mb-4" key={title}>
      <legend className="mb-2 flex w-full justify-between text-sm font-semibold">
        <span>{title}</span>
        <span className="text-xs font-medium text-muted-foreground">{rule}</span>
      </legend>
      <div className="grid grid-cols-2 gap-2">
        {list.map((o) => {
          const on = o.kind === 'variant' ? sel.variantId === o.id : sel.addonIds.includes(o.id);
          return (
            <button
              type="button"
              key={o.id}
              role={o.single ? 'radio' : 'checkbox'}
              aria-checked={on}
              onClick={() => pick(o)}
              className={`flex h-11 items-center justify-between gap-2 rounded-lg border-2 px-3 text-left text-sm font-semibold ${on ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-secondary'}`}
            >
              <span className="flex items-center gap-2">
                {o.hotkey ? <kbd className="rounded border border-border bg-background px-1.5 text-xs">{o.hotkey}</kbd> : null}
                {o.name}
              </span>
              {o.pricePaise ? <span className="text-xs tabular-nums text-muted-foreground">{o.kind === 'addon' ? '+' : ''}{formatINR(o.pricePaise)}</span> : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );

  return (
    <Modal title={item.name} onClose={onClose}>
      {item.variants.length > 0 ? section('Option', 'Required', options.filter((o) => o.kind === 'variant')) : null}
      {groups.map((g) =>
        section(
          g.name,
          g.minSelect > 0 ? (g.minSelect === g.maxSelect ? `Choose ${g.minSelect}` : `Choose ${g.minSelect}–${g.maxSelect}`) : `Optional, up to ${g.maxSelect}`,
          options.filter((o) => o.groupId === g.id),
        ),
      )}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {QUICK_NOTES.map((n) => (
          <button key={n} type="button" className="rounded-full border border-border px-3 py-1 text-xs font-semibold hover:bg-secondary" onClick={() => setNote((v) => (v ? `${v}, ${n}` : n))}>
            {n}
          </button>
        ))}
      </div>
      <input id="sheet-note" className="input mb-4" placeholder="Note for the kitchen" maxLength={140} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note for the kitchen" />

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2" aria-label="Quantity">
          <button type="button" className="btn h-10 w-10 px-0" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Less">
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-8 text-center text-lg font-bold tabular-nums" data-testid="sheet-qty">{qty}</span>
          <button type="button" className="btn h-10 w-10 px-0" onClick={() => setQty((q) => Math.min(999, q + 1))} aria-label="More">
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          Course
          <select className="input h-10 w-16" value={course} onChange={(e) => setCourse(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      {problems.length ? (
        <p className="mt-3 text-sm font-semibold text-danger" role="status">
          {problems.join(' · ')}
        </p>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn" onClick={onClose}>
          Cancel <kbd className="text-xs text-muted-foreground">Esc</kbd>
        </button>
        <button type="button" className="btn btn-primary" disabled={problems.length > 0} onClick={submit}>
          Add <kbd className="text-xs opacity-80">Enter</kbd>
        </button>
      </div>
    </Modal>
  );
}
