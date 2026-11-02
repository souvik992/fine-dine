import { base64ToBytes, bytesToBase64, DEFAULT_BILL_DISPLAY, LOGO_MAX_WIDTH, type BillDisplay, type BillLogo, type OutletConfig } from '@dinepos/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ImageUp, Printer, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useApp } from '../app-context.js';
import { ErrorText, Field, SectionHeader, Toggle, useCatalog, useSave } from './common.js';
import { fitLogo, toMono, trimRows } from './logo.js';

const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);

const SHOW: Array<[keyof BillDisplay, string, string?]> = [
  ['showPhone', 'Phone number'],
  ['showTable', 'Table and area'],
  ['showCovers', 'Covers'],
  ['showCaptain', 'Captain'],
  ['showCashier', 'Cashier'],
  ['showGuest', 'Guest name and phone', 'A guest GSTIN always prints.'],
  ['showRate', 'Rate of each item', 'Off: only quantity and amount.'],
  ['showFreeChoices', 'Free choices', 'Spice level, no onion… (priced add-ons always print).'],
  ['showTaxableAmount', 'Taxable amount on GST lines', '80 mm paper only.'],
  ['showItemCount', 'Item and quantity count'],
];

const LOGO_SIZES: Array<[string, number]> = [
  ['Small', 192],
  ['Medium', 288],
  ['Large', LOGO_MAX_WIDTH],
];

interface Draft {
  display: BillDisplay;
  header: string;
  footer: string;
  logo: BillLogo | null;
}

function toDraft(c: OutletConfig): Draft {
  return { display: c['bill.display'], header: c['bill.display'].headerLines.join('\n'), footer: c['bill.footerLines'].join('\n'), logo: c['bill.logo'] };
}

/** The settings the draft would save (also what the live preview renders). */
function draftConfig(d: Draft): Pick<OutletConfig, 'bill.display' | 'bill.footerLines' | 'bill.logo'> {
  return { 'bill.display': { ...d.display, headerLines: lines(d.header).slice(0, 2) }, 'bill.footerLines': lines(d.footer).slice(0, 3), 'bill.logo': d.logo };
}

/** A 1-bit logo as a picture for the screen (black dots on white). */
function logoDataUrl(l: BillLogo): string {
  const bits = base64ToBytes(l.bits);
  const c = document.createElement('canvas');
  c.width = l.width;
  c.height = l.height;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(l.width, l.height);
  for (let i = 0; i < l.width * l.height; i++) {
    const on = (bits[i >> 3]! & (0x80 >> (i & 7))) !== 0;
    img.data.set(on ? [0, 0, 0, 255] : [255, 255, 255, 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

/** Bill design (from TiffinPOS): logo, header, what the bill shows, footer; live preview and a sample print. */
export function BillDesignSettings() {
  const { api } = useApp();
  const config = useQuery({ queryKey: ['config'], queryFn: () => api.get<OutletConfig>('/v1/config') });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);
  const { save, busy, error } = useSave();
  useEffect(() => {
    if (config.data && !draft) setDraft(toDraft(config.data));
  }, [config.data, draft]);
  if (!draft || !config.data) return <p className="text-muted-foreground">Loading…</p>;

  const set = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch });
    setSaved(false);
  };
  const show = (key: keyof BillDisplay, on: boolean) => set({ display: { ...draft.display, [key]: on } });
  const next = draftConfig(draft);
  const changed = Object.fromEntries(Object.entries(next).filter(([k, v]) => JSON.stringify(config.data[k as keyof OutletConfig]) !== JSON.stringify(v)));
  const dirty = Object.keys(changed).length > 0;

  return (
    <div className="grid max-w-6xl gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!dirty) return setSaved(true);
          void save('SetConfig', { values: changed }).then((ok) => setSaved(ok));
        }}
      >
        <SectionHeader title="Bill design" subtitle="How the customer bill looks. The GSTIN, FSSAI number, bill number, date and tax lines always print." />

        <LogoCard logo={draft.logo} onChange={(logo) => set({ logo })} />

        <fieldset className="mt-4 space-y-4 rounded-xl border border-border bg-card p-5">
          <legend className="px-1 text-sm font-bold">Header</legend>
          <div className="flex items-center gap-2" role="radiogroup" aria-label="Restaurant name size">
            <span className="mr-2 text-sm font-semibold">Restaurant name</span>
            {(['large', 'normal'] as const).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={draft.display.nameSize === s} className="tab" aria-selected={draft.display.nameSize === s} onClick={() => set({ display: { ...draft.display, nameSize: s } })}>
                {s === 'large' ? 'Large' : 'Normal'}
              </button>
            ))}
          </div>
          <Field label="Lines under the name" hint="Up to 2, e.g. “A unit of Spice Hospitality Pvt Ltd” or “Pure veg”. The address and GSTIN come from Outlet & bills.">
            <textarea className="input h-16 py-2" value={draft.header} onChange={(e) => set({ header: e.target.value })} />
          </Field>
        </fieldset>

        <fieldset className="mt-4 rounded-xl border border-border bg-card p-5">
          <legend className="px-1 text-sm font-bold">Show on the bill</legend>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            {SHOW.map(([key, label, hint]) => (
              <Toggle key={key} checked={draft.display[key] as boolean} onChange={(on) => show(key, on)} label={label} hint={hint} />
            ))}
          </div>
          <button type="button" className="mt-4 text-sm font-semibold text-primary hover:underline" onClick={() => set({ display: { ...DEFAULT_BILL_DISPLAY, headerLines: draft.display.headerLines } })}>
            Back to the standard choices
          </button>
        </fieldset>

        <fieldset className="mt-4 rounded-xl border border-border bg-card p-5">
          <legend className="px-1 text-sm font-bold">Footer</legend>
          <Field label="Footer lines" hint="Up to 3 lines at the bottom of every bill.">
            <textarea className="input h-20 py-2" value={draft.footer} onChange={(e) => set({ footer: e.target.value })} />
          </Field>
        </fieldset>

        <ErrorText error={error} />
        <div className="mt-5 flex items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          {saved && !dirty ? (
            <span className="text-sm font-semibold text-ok" role="status">
              Saved. New bills print like this.
            </span>
          ) : dirty ? (
            <span className="text-sm text-muted-foreground">Not saved yet: the preview shows your changes.</span>
          ) : null}
        </div>
      </form>

      <div className="xl:sticky xl:top-0 xl:self-start">
        <Preview config={next} logo={draft.logo} />
        <SamplePrint dirty={dirty} />
      </div>
    </div>
  );
}

function LogoCard({ logo, onChange }: { logo: BillLogo | null; onChange: (l: BillLogo | null) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [size, setSize] = useState(288);
  const [threshold, setThreshold] = useState(160);
  const [photo, setPhoto] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const shown = useMemo(() => (logo ? logoDataUrl(logo) : null), [logo]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Re-make the 1-bit logo whenever the picture or its settings change.
  useEffect(() => {
    if (!img) return;
    const { width, height } = fitLogo(img.naturalWidth, img.naturalHeight, size);
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0, width, height);
    const mono = trimRows(toMono(ctx.getImageData(0, 0, width, height).data, width, height, { threshold, dither: photo }));
    if (mono.bits.every((b) => b === 0)) {
      setProblem('Nothing would print. Increase the darkness or choose a darker picture.');
      return;
    }
    setProblem(null);
    onChangeRef.current({ width: mono.width, height: mono.height, bits: bytesToBase64(mono.bits) });
  }, [img, size, threshold, photo]);

  const choose = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/^image\/(png|jpeg|webp|gif|bmp)$/.test(f.type)) return setProblem('Choose a PNG, JPG, WebP, GIF or BMP picture.');
    if (f.size > 5_000_000) return setProblem('That picture is larger than 5 MB.');
    const reader = new FileReader();
    reader.onload = () => {
      const el = new Image();
      el.onload = () => setImg(el);
      el.onerror = () => setProblem('That picture could not be opened.');
      el.src = typeof reader.result === 'string' ? reader.result : '';
    };
    reader.readAsDataURL(f);
  };

  return (
    <fieldset className="rounded-xl border border-border bg-card p-5">
      <legend className="px-1 text-sm font-bold">Logo</legend>
      <div className="flex items-start gap-4">
        <div className="flex h-28 w-48 shrink-0 items-center justify-center rounded-lg border border-border bg-white p-2">
          {shown ? <img src={shown} alt="Logo as it will print" className="max-h-full max-w-full [image-rendering:pixelated]" /> : <span className="text-xs text-muted-foreground">No logo</span>}
        </div>
        <div className="min-w-0 flex-1 space-y-2 text-sm">
          <p className="text-xs text-muted-foreground">Printed in black and white at the top of every bill. A simple dark logo on a white background prints best.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn h-9" onClick={() => fileInput.current?.click()}>
              <ImageUp className="h-4 w-4" /> {logo ? 'Change picture' : 'Choose picture'}
            </button>
            {logo ? (
              <button
                type="button"
                className="btn h-9"
                onClick={() => {
                  setImg(null);
                  onChange(null);
                }}
              >
                <Trash2 className="h-4 w-4" /> Remove
              </button>
            ) : null}
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" className="hidden" aria-label="Logo picture" onChange={choose} />
          </div>
          {img ? (
            <>
              <div className="flex items-center gap-1" role="radiogroup" aria-label="Logo size">
                <span className="mr-2 font-semibold">Size</span>
                {LOGO_SIZES.map(([label, w]) => (
                  <button key={w} type="button" role="radio" aria-checked={size === w} className="tab h-8" aria-selected={size === w} onClick={() => setSize(w)}>
                    {label}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-3">
                <span className="font-semibold">Darkness</span>
                <input type="range" min={40} max={230} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="flex-1" aria-label="Darkness" />
              </label>
              <Toggle checked={photo} onChange={setPhoto} label="Photo or shaded logo" hint="Prints shades as dots." />
            </>
          ) : null}
          {problem ? (
            <p role="alert" className="text-xs font-semibold text-danger">
              {problem}
            </p>
          ) : null}
        </div>
      </div>
    </fieldset>
  );
}

function Preview({ config, logo }: { config: ReturnType<typeof draftConfig>; logo: BillLogo | null }) {
  const { api } = useApp();
  const [widthMm, setWidthMm] = useState<58 | 80>(80);
  // Debounced so typing in a text box does not render on every key.
  const body = JSON.stringify({ widthMm, config });
  const [sent, setSent] = useState(body);
  useEffect(() => {
    const t = setTimeout(() => setSent(body), 250);
    return () => clearTimeout(t);
  }, [body]);
  const preview = useQuery({
    queryKey: ['bill-preview', sent],
    queryFn: () => api.send<{ preview: string }>('POST', '/v1/bill-preview', JSON.parse(sent)),
    placeholderData: keepPreviousData,
  });
  const logoUrl = useMemo(() => (logo ? logoDataUrl(logo) : null), [logo]);
  const cols = widthMm === 80 ? 48 : 32;

  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-label="Bill preview">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="font-semibold">Preview</h3>
        <span className="text-xs text-muted-foreground">sample bill</span>
        <div className="ml-auto flex gap-1" role="radiogroup" aria-label="Paper width">
          {([80, 58] as const).map((w) => (
            <button key={w} type="button" role="radio" aria-checked={widthMm === w} className="tab h-8" aria-selected={widthMm === w} onClick={() => setWidthMm(w)}>
              {w} mm
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-white px-3 py-4 text-black">
        {preview.data ? (
          <pre data-testid="bill-preview" className="mx-auto font-mono text-[11px] leading-[1.35]" style={{ width: `${cols}ch` }}>
            {preview.data.preview.split('\n').map((l, i) =>
              l.trim() === '[logo]' && logoUrl && logo ? (
                <img key={i} src={logoUrl} alt="Logo" className="mx-auto my-1 block [image-rendering:pixelated]" style={{ width: `${(logo.width / (cols * 12)) * 100}%` }} />
              ) : (
                <div key={i}>{l || ' '}</div>
              ),
            )}
          </pre>
        ) : (
          <p className="text-sm text-gray-500">{preview.isError ? 'The preview could not be made.' : 'Loading…'}</p>
        )}
      </div>
    </section>
  );
}

function SamplePrint({ dirty }: { dirty: boolean }) {
  const catalog = useCatalog();
  const { save, busy, error } = useSave();
  const printers = (catalog.data?.printers ?? []).filter((p) => p.role !== 'kot');
  const [printerId, setPrinterId] = useState('');
  const [sent, setSent] = useState(false);
  const target = printerId || printers[0]?.id || '';
  return (
    <section className="mt-4 rounded-xl border border-border bg-card p-4" aria-label="Print a sample">
      <h3 className="font-semibold">Print a sample bill</h3>
      <p className="mb-2 text-xs text-muted-foreground">Checks paper width, logo and cutter. Marked “SAMPLE - NOT A BILL”; it takes no bill number.{dirty ? ' Save first: it prints the saved design.' : ''}</p>
      {printers.length === 0 ? (
        <p className="text-sm text-muted-foreground">Add a bill printer first (Kitchen & printers).</p>
      ) : (
        <div className="flex gap-2">
          <select className="input" value={target} onChange={(e) => setPrinterId(e.target.value)} aria-label="Printer for the sample">
            {printers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn shrink-0" disabled={busy || !target} onClick={() => void save('PrintSampleBill', { printerId: target }).then((ok) => setSent(ok))}>
            <Printer className="h-4 w-4" /> Print sample
          </button>
        </div>
      )}
      {sent ? (
        <p role="status" className="mt-2 text-xs font-semibold text-ok">
          Sample sent to the printer.
        </p>
      ) : null}
      <ErrorText error={error} />
    </section>
  );
}
