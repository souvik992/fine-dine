import { matchPhotos, newId, type PhotoMatch } from '@dinepos/shared';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, ImagePlus, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';
import type { AdminCatalog } from './common.js';
import { preparePhoto, sizeText } from './photo.js';

const MAX_FILES = 300;
const PHOTO_FILE = /\.(jpe?g|png|webp)$/i;
interface Row extends PhotoMatch {
  f: File;
  url: string;
  chosen: string | null;
  state: 'ready' | 'done' | 'failed';
  error?: string;
}

const WHY: Record<PhotoMatch['how'], string> = {
  name: 'matched by name',
  code: 'matched by short code',
  none: 'no dish with this name: choose one',
  ambiguous: 'more than one dish has this name: choose one',
  duplicate: 'another photo is already for this dish',
};

/** Settings › Menu › Bulk photos (from TiffinPOS): many photos at once, matched to dishes by file name. */
export function BulkPhotos({ catalog }: { catalog: AdminCatalog }) {
  const { api } = useApp();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [keepExisting, setKeepExisting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const items = useMemo(() => catalog.items.filter((i) => i.active).sort((a, b) => a.name.localeCompare(b.name)), [catalog.items]);
  const byId = useMemo(() => new Map(catalog.items.map((i) => [i.id, i])), [catalog.items]);
  useEffect(() => () => rows.forEach((r) => URL.revokeObjectURL(r.url)), [rows]);

  const take = (list: FileList | null) => {
    if (!list) return;
    const all = [...list];
    const photos = all.filter((f) => PHOTO_FILE.test(f.name)).slice(0, MAX_FILES);
    const left = all.length - photos.length;
    setNote(left ? `${left} file(s) left out: only JPG, PNG and WebP photos, at most ${MAX_FILES} at a time.` : null);
    setSummary(null);
    rows.forEach((r) => URL.revokeObjectURL(r.url));
    const m = matchPhotos(photos.map((f) => f.name), items);
    setRows(m.map((x, i) => ({ ...x, f: photos[i]!, url: URL.createObjectURL(photos[i]!), chosen: x.itemId, state: 'ready' })));
  };
  const choose = (i: number, id: string | null) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, chosen: id } : r)));

  const taken = new Map<string, number>();
  rows.forEach((r) => r.chosen && taken.set(r.chosen, (taken.get(r.chosen) ?? 0) + 1));
  const clash = (r: Row) => Boolean(r.chosen && (taken.get(r.chosen) ?? 0) > 1);
  const hasPhoto = (r: Row) => Boolean(r.chosen && byId.get(r.chosen)?.image);
  const willUpload = (r: Row) => r.state === 'ready' && r.chosen !== null && !clash(r) && !(keepExisting && hasPhoto(r));
  const ready = rows.filter(willUpload).length;

  const upload = async () => {
    setBusy(true);
    setSummary(null);
    const todo = rows.map((r, i) => [r, i] as const).filter(([r]) => willUpload(r));
    setProgress({ done: 0, total: todo.length });
    let ok = 0;
    let failed = 0;
    let before = 0;
    let after = 0;
    for (const [r, i] of todo) {
      // one at a time: gentle on the outlet PC and the network
      try {
        const p = await preparePhoto(r.f);
        await api.command('SetItemImage', { itemId: r.chosen, dataBase64: p.dataBase64 }, { commandId: newId() });
        ok++;
        before += p.originalBytes;
        after += p.bytes;
        setRows((rs) => rs.map((x, j) => (j === i ? { ...x, state: 'done' } : x)));
      } catch (e) {
        failed++;
        const error = e instanceof ApiError || e instanceof Error ? e.message : 'Could not upload.';
        setRows((rs) => rs.map((x, j) => (j === i ? { ...x, state: 'failed', error } : x)));
      }
      setProgress({ done: ok + failed, total: todo.length });
    }
    await qc.invalidateQueries({ queryKey: ['catalog'] });
    await qc.invalidateQueries({ queryKey: ['menu'] });
    setSummary(`${ok} photo${ok === 1 ? '' : 's'} saved${ok ? ` (${sizeText(before)} → ${sizeText(after)})` : ''}${failed ? `, ${failed} failed (see below)` : ''}.`);
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <div
        className={`rounded-xl border-2 border-dashed p-6 text-center ${over ? 'border-ring bg-secondary' : 'border-border bg-card'}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files);
        }}
      >
        <ImagePlus className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-2 font-semibold">Drop dish photos here, or choose them</p>
        <p className="text-sm text-muted-foreground">
          Name each file after its dish or short code, e.g. <span className="font-mono">Paneer Tikka.jpg</span> or <span className="font-mono">PT.jpg</span>. Up to {MAX_FILES} at a time; each is resized
          here before it is sent.
        </p>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => take(e.target.files)} aria-label="Choose photos" />
        <button className="btn mt-3" onClick={() => input.current?.click()} disabled={busy}>
          Choose photos
        </button>
        {note ? <p className="mt-2 text-sm text-danger">{note}</p> : null}
      </div>

      {rows.length ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={keepExisting} onChange={(e) => setKeepExisting(e.target.checked)} /> Keep photos dishes already have
            </label>
            <span className="ml-auto text-sm text-muted-foreground">
              {ready} of {rows.length} ready to upload
            </span>
            <button className="btn btn-primary" onClick={() => void upload()} disabled={busy || ready === 0}>
              <Upload className="h-4 w-4" /> {busy && progress ? `Uploading ${progress.done} of ${progress.total}…` : `Upload ${ready} photo${ready === 1 ? '' : 's'}`}
            </button>
          </div>
          {summary ? (
            <p role="status" className="text-sm font-semibold text-ok">
              {summary}
            </p>
          ) : null}
          <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]" aria-label="Photos to upload">
            {rows.map((r, i) => (
              <li key={`${r.file}-${i}`} className="flex gap-3 rounded-xl border border-border bg-card p-2">
                <img src={r.url} alt="" className="h-20 w-24 shrink-0 rounded-lg object-cover" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate font-mono text-xs text-muted-foreground" title={r.file}>
                    {r.file}
                  </p>
                  <select className="input mt-1 h-9" value={r.chosen ?? ''} onChange={(e) => choose(i, e.target.value || null)} disabled={busy || r.state === 'done'} aria-label={`Dish for ${r.file}`}>
                    <option value="">Not used</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.name}
                        {it.shortCode ? ` (${it.shortCode})` : ''}
                        {it.image ? ' · has a photo' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs">
                    {r.state === 'done' ? (
                      <span className="flex items-center gap-1 font-semibold text-ok">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Saved
                      </span>
                    ) : r.state === 'failed' ? (
                      <span className="flex items-center gap-1 text-danger">
                        <CircleAlert className="h-3.5 w-3.5" /> {r.error}
                      </span>
                    ) : clash(r) ? (
                      <span className="text-danger">Two photos are for this dish: choose one.</span>
                    ) : r.chosen && keepExisting && hasPhoto(r) ? (
                      <span className="text-muted-foreground">Skipped: the dish already has a photo</span>
                    ) : r.chosen ? (
                      <span className="text-muted-foreground">{r.chosen === r.itemId ? WHY[r.how] : 'chosen by you'}</span>
                    ) : (
                      <span className="text-muted-foreground">{WHY[r.how]}</span>
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
