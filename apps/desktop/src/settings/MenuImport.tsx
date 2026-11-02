import { categoryKey, formatINR, MENU_CSV_TEMPLATE, newId, parseMenuCsv, type MenuCsvProblem } from '@dinepos/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Download, FileUp, RotateCcw } from 'lucide-react';
import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';
import { bpToPercentText } from '../billing/money-input.js';
import { VegMark } from '../components/VegMark.js';
import { ErrorText, type AdminCatalog } from './common.js';

const MAX_BYTES = 900_000; // the server accepts 1 MB per request

function saveText(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([String.fromCharCode(0xfeff) + text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Bulk upload (from TiffinPOS): check every row first, then add all of them in one go, or none. */
export function MenuImport({ catalog }: { catalog: AdminCatalog }) {
  const { api } = useApp();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [text, setText] = useState('');
  const [importId, setImportId] = useState(newId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Rows are checked here against the file and the current menu; the server checks again inside one transaction.
  const preview = useMemo(() => {
    if (!text) return null;
    const r = parseMenuCsv(text);
    const names = new Set(catalog.items.filter((i) => i.active).map((i) => i.name.toLowerCase()));
    const codes = new Map(catalog.items.filter((i) => i.shortCode).map((i) => [i.shortCode!, i.name]));
    const existing = new Set(catalog.categories.map((c) => categoryKey(c.name)));
    const errors: MenuCsvProblem[] = [...r.errors];
    for (const it of r.items) {
      if (names.has(it.name.toLowerCase())) errors.push({ row: it.row, message: `"${it.name}" is already on the menu. Edit it there instead.` });
      if (it.shortCode && codes.has(it.shortCode)) errors.push({ row: it.row, message: `Code ${it.shortCode} is already used by ${codes.get(it.shortCode)}.` });
    }
    errors.sort((a, b) => a.row - b.row);
    const newCategories = [...new Map(r.items.filter((i) => !existing.has(categoryKey(i.category))).map((i) => [categoryKey(i.category), i.category])).values()];
    return { items: r.items, errors, newCategories };
  }, [text, catalog]);

  const reset = () => {
    setText('');
    setFileName('');
    setError(null);
    setImportId(newId());
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // the same file can be chosen again after fixing it
    setDone(null);
    setError(null);
    if (!f) return;
    if (f.size > MAX_BYTES) return setError('That file is too large. Split it into files under 900 KB.');
    if (!/\.(csv|txt)$/i.test(f.name)) return setError('Choose a .csv file. In Excel use File › Save As › "CSV UTF-8".');
    f.text().then(
      (t) => {
        setFileName(f.name);
        setText(t);
        setImportId(newId());
      },
      () => setError('The file could not be read. Try saving it again.'),
    );
  };

  const doImport = async () => {
    if (!preview || preview.errors.length || !preview.items.length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.command<{ imported: number; categoriesCreated: number }>('ImportMenu', { importId, items: preview.items.map(({ row: _row, ...i }) => i) });
      const r = res.result;
      await Promise.all(['catalog', 'menu'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      reset();
      setDone(`${r.imported} item${r.imported === 1 ? '' : 's'} added${r.categoriesCreated ? `, ${r.categoriesCreated} new categor${r.categoriesCreated === 1 ? 'y' : 'ies'}` : ''}. Set kitchen stations for new categories in the Categories tab.`);
    } catch (e) {
      const problems = e instanceof ApiError ? (e.details as { problems?: Array<{ item: number; message: string }> } | undefined)?.problems : undefined;
      setError(problems?.length ? `${e instanceof ApiError ? e.message : ''} ${problems.map((p) => `Row ${preview.items[p.item - 1]?.row ?? '?'}: ${p.message}`).join(' ')}` : e instanceof ApiError ? e.message : 'Could not import. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-4 rounded-xl border border-border bg-card p-4 text-sm">
        <p className="font-semibold">Add many items at once from a spreadsheet.</p>
        <ol className="mt-1 list-decimal pl-5 text-muted-foreground">
          <li>Download the template and fill one item per line: name, category, price (₹), gst (0, 5, 12, 18 or 28), code, veg (veg / non-veg), hsn.</li>
          <li>Save as CSV (Excel: File › Save As › "CSV UTF-8") and choose it below.</li>
          <li>Check the preview. Nothing is added until every row is correct.</li>
        </ol>
        <div className="mt-3 flex gap-2">
          <button className="btn" onClick={() => saveText('dinepos-menu-template.csv', MENU_CSV_TEMPLATE)}>
            <Download className="h-4 w-4" /> Download template
          </button>
          <button className="btn btn-primary" onClick={() => fileInput.current?.click()}>
            <FileUp className="h-4 w-4" /> Choose CSV file
          </button>
          <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" aria-label="Menu CSV file" onChange={onFile} />
          {text ? (
            <button className="btn" onClick={reset}>
              <RotateCcw className="h-4 w-4" /> Start again
            </button>
          ) : null}
        </div>
      </div>

      {done ? (
        <p role="status" className="mb-3 rounded-lg bg-ok/15 p-3 text-sm font-semibold text-ok">
          {done}
        </p>
      ) : null}
      <ErrorText error={error} />

      {preview ? (
        <>
          <div className="mb-2 mt-3 flex items-center justify-between">
            <p className="text-sm">
              <span className="font-semibold">{fileName}</span>: {preview.items.length} item{preview.items.length === 1 ? '' : 's'} ready
              {preview.newCategories.length ? `, new categories: ${preview.newCategories.join(', ')}` : ''}
              {preview.errors.length ? <span className="font-semibold text-danger"> · {preview.errors.length} problem(s) to fix</span> : null}
            </p>
            <button className="btn btn-primary" disabled={busy || preview.errors.length > 0 || preview.items.length === 0} onClick={() => void doImport()}>
              {busy ? 'Importing…' : `Import ${preview.items.length} item${preview.items.length === 1 ? '' : 's'}`}
            </button>
          </div>
          {preview.errors.length ? (
            <ul className="mb-3 max-h-48 overflow-y-auto rounded-xl border border-danger/40 bg-danger/5 p-3 text-sm" aria-label="Problems">
              {preview.errors.map((e, i) => (
                <li key={i}>
                  <span className="font-semibold">Row {e.row}:</span> {e.message}
                </li>
              ))}
            </ul>
          ) : null}
          <table className="w-full rounded-xl border border-border bg-card text-sm" aria-label="Import preview">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Row</th>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">GST</th>
                <th className="px-3 py-2 text-right">Price</th>
              </tr>
            </thead>
            <tbody>
              {preview.items.slice(0, 200).map((i) => (
                <tr key={i.row} className="border-b border-border last:border-0">
                  <td className="px-3 py-1.5 text-muted-foreground">{i.row}</td>
                  <td className="px-3 py-1.5 font-semibold">
                    <span className="flex items-center gap-2">
                      <VegMark veg={i.veg} />
                      {i.name}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 font-mono">{i.shortCode ?? '—'}</td>
                  <td className="px-3 py-1.5">{i.category}</td>
                  <td className="px-3 py-1.5">{bpToPercentText(i.taxRateBp)}%</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatINR(i.pricePaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.items.length > 200 ? <p className="mt-2 text-xs text-muted-foreground">Showing the first 200 of {preview.items.length}.</p> : null}
        </>
      ) : null}
    </div>
  );
}
