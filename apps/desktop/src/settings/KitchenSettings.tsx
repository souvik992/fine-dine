import { newId, type OutletConfig } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { ChefHat, MonitorPlay, Plus, Printer } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../app-context.js';
import { Modal } from '../components/Modal.js';
import { DialogButtons, Empty, ErrorText, Field, SectionHeader, Toggle, useCatalog, useSave, type AdminCatalog } from './common.js';

type Station = AdminCatalog['stations'][number];
type PrinterRow = AdminCatalog['printers'][number];

interface PrinterStatus {
  id: string;
  status: 'ok' | 'retrying' | 'offline';
  queued: number;
  lastError?: string;
}

/** Kitchen & printers (docs/06): stations receive KOTs; each prints on its printers; bills go to a bill printer. */
export function KitchenSettings() {
  const { api } = useApp();
  const catalog = useCatalog();
  const status = useQuery({ queryKey: ['printers'], queryFn: () => api.get<{ printers: PrinterStatus[] }>('/v1/printers'), refetchInterval: 10_000 });
  const { save, busy, error } = useSave();
  const [station, setStation] = useState<Station | 'new' | null>(null);
  const [printer, setPrinter] = useState<PrinterRow | 'new' | null>(null);
  const [tested, setTested] = useState<string | null>(null);
  if (!catalog.data) return <p className="text-muted-foreground">Loading…</p>;
  const { stations, printers } = catalog.data;
  const nameOf = (id: string) => printers.find((p) => p.id === id)?.name ?? '?';
  const live = (id: string) => status.data?.printers.find((p) => p.id === id);

  return (
    <div className="max-w-4xl">
      <SectionHeader
        title="Printers"
        subtitle="Kitchen (KOT) and bill printers. A network printer needs a fixed IP; a USB printer needs its Windows printer name."
        action={
          <button className="btn btn-primary" onClick={() => setPrinter('new')}>
            <Plus className="h-4 w-4" /> Add printer
          </button>
        }
      />
      {printers.length === 0 ? <Empty>No printers yet.</Empty> : null}
      <ul className="mb-10 divide-y divide-border rounded-xl border border-border bg-card" aria-label="Printers">
        {printers.map((p) => {
          const s = live(p.id);
          return (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3">
              <Printer className="h-5 w-5 text-muted-foreground" />
              <span className="flex-1">
                <span className="font-semibold">{p.name}</span>
                <span className="ml-2 text-sm text-muted-foreground">
                  {p.transport === 'tcp' ? `Network ${p.host}:${p.port}` : p.transport === 'usb' ? `USB “${p.windowsName}”` : 'Preview only (no paper)'} · {p.widthMm} mm · {p.role === 'kot' ? 'KOTs' : p.role === 'bill' ? 'Bills' : 'KOTs and bills'}
                </span>
                {s && s.status !== 'ok' ? <span className="ml-2 rounded bg-danger px-1.5 py-0.5 text-xs font-bold text-white" title={s.lastError}>{s.status === 'offline' ? 'Not printing' : 'Retrying'}</span> : null}
                {tested === p.id ? <span className="ml-2 text-xs font-semibold text-ok">Test page sent</span> : null}
              </span>
              <button className="btn h-8" disabled={busy} onClick={() => void save('PrintTestPage', { printerId: p.id }).then((ok) => ok && setTested(p.id))}>
                Test print
              </button>
              <button className="btn h-8" onClick={() => setPrinter(p)}>
                Edit
              </button>
            </li>
          );
        })}
      </ul>
      <ErrorText error={error} />

      <SectionHeader
        title="Kitchen stations"
        subtitle="Each category (or item) belongs to a station; its KOTs print on the station's printers."
        action={
          <button className="btn" onClick={() => setStation('new')}>
            <Plus className="h-4 w-4" /> Add station
          </button>
        }
      />
      {stations.length === 0 ? <Empty>No stations yet: Kitchen, Tandoor, Bar…</Empty> : null}
      <ul className="grid grid-cols-2 gap-3" aria-label="Stations">
        {stations.map((s) => (
          <li key={s.id}>
            <button className="flex w-full items-start gap-3 rounded-xl border border-border bg-card p-4 text-left hover:border-ring" onClick={() => setStation(s)}>
              <ChefHat className="mt-0.5 h-5 w-5 text-primary" />
              <span>
                <span className="block font-semibold">{s.name}</span>
                <span className="block text-xs text-muted-foreground">{s.printerIds.length ? `Prints on ${s.printerIds.map(nameOf).join(', ')}` : 'No printer (KOTs are not printed)'}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <KitchenScreens />

      {station ? <StationDialog station={station === 'new' ? null : station} printers={printers} onClose={() => setStation(null)} /> : null}
      {printer ? <PrinterDialog printer={printer === 'new' ? null : printer} printers={printers} onClose={() => setPrinter(null)} /> : null}
    </div>
  );
}

function StationDialog({ station, printers, onClose }: { station: Station | null; printers: PrinterRow[]; onClose: () => void }) {
  const { save, busy, error } = useSave();
  const [name, setName] = useState(station?.name ?? '');
  const [hasKds, setHasKds] = useState(station?.hasKds ?? false);
  const [chosen, setChosen] = useState<Set<string>>(new Set(station?.printerIds ?? []));
  return (
    <Modal title={station ? `Station: ${station.name}` : 'Add a kitchen station'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save('UpsertStation', { id: station?.id ?? newId(), name: name.trim(), hasKds, printerIds: [...chosen] }).then((ok) => ok && onClose());
        }}
      >
        <Field label="Name">
          <input data-autofocus className="input" value={name} maxLength={80} placeholder="Tandoor" onChange={(e) => setName(e.target.value)} />
        </Field>
        <p className="mb-1 mt-3 text-sm font-semibold">Print its KOTs on</p>
        <div className="space-y-1">
          {printers.filter((p) => p.role !== 'bill').map((p) => (
            <Toggle key={p.id} checked={chosen.has(p.id)} label={p.name} onChange={(on) => setChosen((s) => { const n = new Set(s); if (on) n.add(p.id); else n.delete(p.id); return n; })} />
          ))}
          {printers.every((p) => p.role === 'bill') ? <p className="text-xs text-muted-foreground">Add a KOT printer first.</p> : null}
        </div>
        <div className="mt-3">
          <Toggle checked={hasKds} onChange={setHasKds} label="Has a kitchen screen (KDS)" hint="Tickets also show on the screen (KDS arrives in a later update)." />
        </div>
        <ErrorText error={error} />
        <DialogButtons busy={busy} onCancel={onClose} disabled={!name.trim()} />
      </form>
    </Modal>
  );
}

function PrinterDialog({ printer, printers, onClose }: { printer: PrinterRow | null; printers: PrinterRow[]; onClose: () => void }) {
  const { save, busy, error } = useSave();
  const [f, setF] = useState({
    name: printer?.name ?? '',
    transport: printer?.transport ?? ('tcp'),
    host: printer?.host ?? '',
    port: String(printer?.port ?? 9100),
    windowsName: printer?.windowsName ?? '',
    widthMm: printer?.widthMm ?? (80),
    role: printer?.role ?? ('kot'),
    copies: String(printer?.copies ?? 1),
    cutter: printer?.cutter ?? true,
    backupPrinterId: printer?.backupPrinterId ?? '',
  });
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const valid = f.name.trim() && (f.transport !== 'tcp' || f.host.trim()) && (f.transport !== 'usb' || f.windowsName.trim());

  return (
    <Modal title={printer ? `Printer: ${printer.name}` : 'Add a printer'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save('UpsertPrinter', {
            id: printer?.id ?? newId(),
            name: f.name.trim(),
            transport: f.transport,
            host: f.transport === 'tcp' ? f.host.trim() : null,
            port: Number(f.port) || 9100,
            windowsName: f.transport === 'usb' ? f.windowsName.trim() : null,
            widthMm: f.widthMm,
            bitmapText: printer?.bitmapText ?? false,
            copies: Math.min(5, Math.max(1, Number(f.copies) || 1)),
            cutter: f.cutter,
            backupPrinterId: f.backupPrinterId || null,
            role: f.role,
          }).then((ok) => ok && onClose());
        }}
      >
        <div className="space-y-3">
          <Field label="Name">
            <input data-autofocus className="input" value={f.name} maxLength={80} placeholder="Kitchen printer" onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <fieldset>
            <legend className="mb-1 text-sm font-semibold">Connection</legend>
            <div className="grid grid-cols-3 gap-2" role="radiogroup">
              {(
                [
                  ['tcp', 'Network / Wi-Fi'],
                  ['usb', 'USB (Windows)'],
                  ['fake', 'Preview only'],
                ] as const
              ).map(([t, label]) => (
                <button key={t} type="button" role="radio" aria-checked={f.transport === t} onClick={() => set({ transport: t })} className={`h-10 rounded-md text-sm font-semibold ${f.transport === t ? 'bg-foreground text-background' : 'bg-secondary'}`}>
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          {f.transport === 'tcp' ? (
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Field label="IP address" hint="Set a fixed IP on the printer or router.">
                  <input className="input" value={f.host} placeholder="192.168.1.50" onChange={(e) => set({ host: e.target.value })} />
                </Field>
              </div>
              <Field label="Port">
                <input className="input" inputMode="numeric" value={f.port} onChange={(e) => set({ port: e.target.value.replace(/\D/g, '') })} />
              </Field>
            </div>
          ) : null}
          {f.transport === 'usb' ? (
            <Field label="Windows printer name" hint="Exactly as in Windows Settings › Printers, on the master PC.">
              <input className="input" value={f.windowsName} placeholder="POS-80" onChange={(e) => set({ windowsName: e.target.value })} />
            </Field>
          ) : null}
          {f.transport === 'fake' ? <p className="text-xs text-muted-foreground">Prints go to text files on the master PC (data\prints). For trying DinePOS without a printer.</p> : null}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Paper">
              <select className="input" value={f.widthMm} onChange={(e) => set({ widthMm: Number(e.target.value) as 58 | 80 })}>
                <option value={80}>80 mm</option>
                <option value={58}>58 mm</option>
              </select>
            </Field>
            <Field label="Prints">
              <select className="input" value={f.role} onChange={(e) => set({ role: e.target.value as PrinterRow['role'] })}>
                <option value="kot">KOTs</option>
                <option value="bill">Bills</option>
                <option value="both">KOTs and bills</option>
              </select>
            </Field>
            <Field label="Copies">
              <input className="input" inputMode="numeric" value={f.copies} onChange={(e) => set({ copies: e.target.value.replace(/\D/g, '') })} />
            </Field>
          </div>
          <Field label="If it stops printing, send to" hint="Its jobs are reprinted there after three failed tries.">
            <select className="input" value={f.backupPrinterId} onChange={(e) => set({ backupPrinterId: e.target.value })}>
              <option value="">No backup printer</option>
              {printers.filter((p) => p.id !== printer?.id).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Toggle checked={f.cutter} onChange={(cutter) => set({ cutter })} label="Has a paper cutter" />
        </div>
        <ErrorText error={error} />
        <DialogButtons busy={busy} onCancel={onClose} disabled={!valid} />
      </form>
    </Modal>
  );
}

/** Kitchen screens (P4-02): where to open them, and when a ticket turns amber and red. */
function KitchenScreens() {
  const { api, serverUrl } = useApp();
  const config = useQuery({ queryKey: ['config'], queryFn: () => api.get<OutletConfig>('/v1/config') });
  // The master PC talks to itself on 127.0.0.1; a tablet needs one of its network addresses.
  const network = useQuery({ queryKey: ['network'], queryFn: () => api.get<{ urls: string[] }>('/v1/network') });
  const { save, busy, error, setError } = useSave();
  const [amber, setAmber] = useState<string | null>(null);
  const [red, setRed] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  if (!config.data) return null;
  const a = amber ?? String(config.data['kds.amberMin']);
  const r = red ?? String(config.data['kds.redMin']);
  const bases = network.data?.urls.length ? network.data.urls : [serverUrl.replace(/\/$/, '')];
  const valid = /^\d+$/.test(a) && /^\d+$/.test(r) && Number(a) >= 1 && Number(r) > Number(a) && Number(r) <= 240;
  return (
    <div className="mt-10">
      <SectionHeader title="Kitchen screens" subtitle="A screen (tablet, TV or PC browser) at a station shows its tickets; cooks tap Ready, then Served." />
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="flex items-center gap-2 text-sm">
          <MonitorPlay className="h-4 w-4 shrink-0 text-primary" />
          <span>
            On the screen, open{' '}
            {bases.map((b, i) => (
              <span key={b}>
                {i ? ' or ' : ''}
                <span className="font-mono font-semibold" data-testid="kds-url">
                  {b}/kds
                </span>
              </span>
            ))}{' '}
            (on the shop network), pair it in Settings › Devices and choose the station. No sign-in is needed on the screen.
          </span>
        </p>
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return setError('Red must be after amber (1 to 240 minutes).');
            setSaved(false);
            void save('SetConfig', { values: { 'kds.amberMin': Number(a), 'kds.redMin': Number(r) } }).then((ok) => setSaved(ok));
          }}
        >
          <Field label="Amber after (minutes)">
            <input className="input w-32" inputMode="numeric" value={a} onChange={(e) => setAmber(e.target.value)} aria-label="Amber after (minutes)" />
          </Field>
          <Field label="Red after (minutes)">
            <input className="input w-32" inputMode="numeric" value={r} onChange={(e) => setRed(e.target.value)} aria-label="Red after (minutes)" />
          </Field>
          <button type="submit" className="btn btn-primary" disabled={busy || !valid}>
            Save
          </button>
          {saved ? <span className="text-sm font-semibold text-ok">Saved</span> : null}
        </form>
        <ErrorText error={error} />
      </div>
    </div>
  );
}
