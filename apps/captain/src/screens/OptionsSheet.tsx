import { groupsOf, selectionProblems, sheetOptions, toggle, type Selection, type SheetOption } from '@dinepos/client';
import { formatINR, type MenuItem, type MenuSnapshot } from '@dinepos/shared';
import { Minus, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Sheet } from '../components/Sheet.js';
import { COURSES } from '../order-model.js';

export interface OptionsResult {
  variantId: string | null;
  addonIds: string[];
  qty: number;
  note: string | null;
  course: number;
}

const QUICK_NOTES = ['Less spicy', 'No onion', 'No garlic', 'Jain', 'Extra hot'];

/** Item options on the phone (docs/09 modifier sheet): size, add-ons within their limits, a note, course, quantity. */
export function OptionsSheet({ menu, item, course: initialCourse, onAdd, onClose }: { menu: MenuSnapshot; item: MenuItem; course: number; onAdd: (r: OptionsResult) => void; onClose: () => void }) {
  const options = useMemo(() => sheetOptions(menu, item), [menu, item]);
  const groups = useMemo(() => groupsOf(menu, item), [menu, item]);
  const [sel, setSel] = useState<Selection>({ variantId: null, addonIds: [] });
  const [qty, setQty] = useState(1);
  const [course, setCourse] = useState(initialCourse);
  const [note, setNote] = useState('');
  const problems = selectionProblems(menu, item, sel);

  const section = (title: string, rule: string, list: SheetOption[]) => (
    <fieldset className="mb-5" key={title}>
      <legend className="mb-2 flex w-full justify-between font-semibold">
        <span>{title}</span>
        <span className="text-sm font-medium text-muted-foreground">{rule}</span>
      </legend>
      <div className="grid grid-cols-1 gap-2">
        {list.map((o) => {
          const on = o.kind === 'variant' ? sel.variantId === o.id : sel.addonIds.includes(o.id);
          return (
            <button
              type="button"
              key={o.id}
              role={o.single ? 'radio' : 'checkbox'}
              aria-checked={on}
              onClick={() => setSel((s) => toggle(menu, item, s, o))}
              className={`flex min-h-12 items-center justify-between gap-2 rounded-lg border-2 px-4 text-left font-semibold ${on ? 'border-primary bg-primary/10' : 'border-border bg-card'}`}
            >
              <span>{o.name}</span>
              {o.pricePaise ? (
                <span className="text-sm tabular-nums text-muted-foreground">
                  {o.kind === 'addon' ? '+' : ''}
                  {formatINR(o.pricePaise)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );

  return (
    <Sheet
      title={item.name}
      onClose={onClose}
      footer={
        <>
          {problems.length ? (
            <p className="mb-2 text-sm font-semibold text-danger" role="status">
              {problems.join(' · ')}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button type="button" className="btn flex-1" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary flex-[2]" disabled={problems.length > 0} onClick={() => onAdd({ ...sel, qty, course, note: note.trim() || null })}>
              Add {qty} to course {course}
            </button>
          </div>
        </>
      }
    >
      {item.variants.length > 0 ? section('Option', 'Required', options.filter((o) => o.kind === 'variant')) : null}
      {groups.map((g) =>
        section(
          g.name,
          g.minSelect > 0 ? (g.minSelect === g.maxSelect ? `Choose ${g.minSelect}` : `Choose ${g.minSelect}–${g.maxSelect}`) : `Optional, up to ${g.maxSelect}`,
          options.filter((o) => o.groupId === g.id),
        ),
      )}

      <p className="mb-2 font-semibold">Note for the kitchen</p>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {QUICK_NOTES.map((n) => (
          <button key={n} type="button" className="h-9 rounded-full border border-border px-3 text-sm font-semibold active:bg-secondary" onClick={() => setNote((v) => (v ? `${v}, ${n}` : n))}>
            {n}
          </button>
        ))}
      </div>
      <input className="input mb-5" placeholder="Type a note" maxLength={140} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note for the kitchen" />

      <p className="mb-2 font-semibold">Course</p>
      <div className="mb-5 flex gap-2" role="radiogroup" aria-label="Course">
        {COURSES.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={course === c} className={`btn h-12 flex-1 px-0 ${course === c ? 'btn-primary' : ''}`} onClick={() => setCourse(c)}>
            {c}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-center gap-6" aria-label="Quantity">
        <button type="button" className="btn h-14 w-14 px-0" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Fewer" disabled={qty <= 1}>
          <Minus className="h-6 w-6" />
        </button>
        <span className="w-12 text-center text-4xl font-bold tabular-nums">{qty}</span>
        <button type="button" className="btn h-14 w-14 px-0" onClick={() => setQty((q) => Math.min(99, q + 1))} aria-label="More">
          <Plus className="h-6 w-6" />
        </button>
      </div>
    </Sheet>
  );
}
