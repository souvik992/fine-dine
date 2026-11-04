import { formatQty, newId, parseRecipeCsv, recipesToCsv, UNIT_LABELS, type RecipeCsvContext, type RecipeCsvResult, type RecipeLineView } from '@dinepos/shared';
import { Download, FileUp } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Modal } from '../components/Modal.js';
import { ErrorText } from '../settings/common.js';
import { useMenu, useStock, useStockCommand } from './common.js';

const MAX_FILE_BYTES = 2_000_000;

function saveText(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([String.fromCharCode(0xfeff) + text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * Stock › Recipes › Bulk upload: download the recipes as a CSV (or a template), edit them in Excel, upload. Every line
 * is checked against the menu and the materials first; then all recipes in the file are saved in one go, or none.
 */
export function RecipeImport({ recipes, onClose }: { recipes: readonly RecipeLineView[]; onClose: () => void }) {
  const menu = useMenu();
  const stock = useStock();
  const { send, busy, error, setError } = useStockCommand();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<string | null>(null);
  const [parsed, setParsed] = useState<RecipeCsvResult | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [importId, setImportId] = useState(newId);

  const ctx = useMemo<RecipeCsvContext | null>(
    () =>
      menu.data && stock.data
        ? { items: menu.data.items, addonGroups: menu.data.addonGroups, materials: stock.data.items.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name, unit: m.unit })) }
        : null,
    [menu.data, stock.data],
  );
  if (!ctx) return null;

  const read = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setDone(null);
    setParsed(null);
    if (f.size > MAX_FILE_BYTES) return setError('That file is too large. Split it into smaller files.');
    setFile(f.name);
    setImportId(newId());
    setParsed(parseRecipeCsv(await f.text(), ctx));
    if (input.current) input.current.value = '';
  };

  const save = async () => {
    if (!parsed || parsed.errors.length || parsed.recipes.length === 0) return;
    const payload = { importId, recipes: parsed.recipes.map((r) => ({ ownerKind: r.ownerKind, ownerId: r.ownerId, lines: r.lines.map((l) => ({ stockItemId: l.stockItemId, qtyMilli: l.qtyMilli })) })) };
    if (JSON.stringify(payload).length > 900_000) return setError('That file is too large to send at once. Split it into two files.');
    if (await send('ImportRecipes', payload)) {
      setDone(`${parsed.recipes.length} recipe${parsed.recipes.length === 1 ? '' : 's'} saved. The next KOTs take these amounts from stock.`);
      setParsed(null);
      setFile(null);
    }
  };

  const ok = parsed && parsed.errors.length === 0;
  return (
    <Modal title="Recipes: bulk upload" onClose={onClose} wide>
      <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm">
        <li>
          Download the recipes (or a template) and open it in Excel. One line per ingredient: <span className="font-mono">dish, size, addon, material, quantity</span>.
        </li>
        <li>
          Quantity is for <b>one</b> portion, in the material’s own unit (kg, litre, pcs): 150 g of paneer in kg is <span className="font-mono">0.15</span>. Leave the size empty for the whole dish; for an add-on fill in
          the add-on and leave the dish empty.
        </li>
        <li>Upload it. Every dish, size or add-on in the file gets exactly the recipe in the file; recipes not in the file stay as they are.</li>
      </ol>
      <div className="mb-4 flex flex-wrap gap-2">
        <button className="btn" onClick={() => saveText(`recipes-${new Date().toISOString().slice(0, 10)}.csv`, recipesToCsv(recipes, ctx))}>
          <Download className="h-4 w-4" /> {recipes.length ? 'Download current recipes' : 'Download a template'}
        </button>
        <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void read(e.target.files?.[0])} aria-label="Choose a recipe file" />
        <button className="btn btn-primary" onClick={() => input.current?.click()} disabled={busy}>
          <FileUp className="h-4 w-4" /> Choose a CSV file
        </button>
        {file ? <span className="self-center text-sm text-muted-foreground">{file}</span> : null}
      </div>

      {done ? (
        <p role="status" className="mb-3 text-sm font-semibold text-ok">
          {done}
        </p>
      ) : null}
      {parsed && parsed.errors.length ? (
        <div className="mb-3 rounded-xl border border-danger p-3" role="alert">
          <p className="mb-1 font-semibold text-danger">
            {parsed.errors.length} problem{parsed.errors.length === 1 ? '' : 's'} to fix in the file (nothing was saved):
          </p>
          <ul className="max-h-56 space-y-0.5 overflow-y-auto text-sm" aria-label="Problems">
            {parsed.errors.slice(0, 200).map((e, i) => (
              <li key={i}>
                <span className="font-mono text-muted-foreground">line {e.row}:</span> {e.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {ok ? (
        <>
          <p className="mb-2 text-sm">
            <b>{parsed.recipes.length}</b> recipe{parsed.recipes.length === 1 ? '' : 's'} from {parsed.rows} line{parsed.rows === 1 ? '' : 's'}, all checked:
          </p>
          <ul className="mb-3 max-h-72 divide-y divide-border overflow-y-auto rounded-xl border border-border text-sm" aria-label="Recipes to save">
            {parsed.recipes.map((r) => (
              <li key={`${r.ownerKind}:${r.ownerId}`} className="flex gap-3 px-3 py-1.5">
                <span className="w-56 shrink-0 font-semibold">{r.label}</span>
                <span className="text-muted-foreground">{r.lines.map((l) => `${l.material} ${formatQty(l.qtyMilli)} ${UNIT_LABELS[l.unit]}`).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <ErrorText error={error} />
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          Done
        </button>
        <button className="btn btn-primary" disabled={!ok || busy} onClick={() => void save()}>
          {ok ? `Save ${parsed.recipes.length} recipe${parsed.recipes.length === 1 ? '' : 's'}` : 'Save recipes'}
        </button>
      </div>
    </Modal>
  );
}
