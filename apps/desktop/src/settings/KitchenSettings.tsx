import { newId, type OutletConfig } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { ChefHat, MonitorPlay, Plus } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../app-context.js';
import { Modal } from '../components/Modal.js';
import { DialogButtons, Empty, ErrorText, Field, SectionHeader, Toggle, useCatalog, useSave, type AdminCatalog } from './common.js';

type Station = AdminCatalog['stations'][number];
type PrinterRow = AdminCatalog['printers'][number];

/** Settings › Kitchen (docs/06): stations receive KOTs and print them on their printers (set up in Settings › Printers); kitchen screens. */
export function KitchenSettings() {
  const catalog = useCatalog();
  const [station, setStation] = useState<Station | 'new' | null>(null);
  if (!catalog.data) return <p className="text-muted-foreground">Loading…</p>;
  const { stations, printers } = catalog.data;
  const nameOf = (id: string) => printers.find((p) => p.id === id)?.name ?? '?';

  return (
    <div className="max-w-4xl">
      <SectionHeader
        title="Kitchen stations"
        subtitle="Each category (or item) belongs to a station; its KOTs print on the station's printers. Printers are set up in Settings › Printers."
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
                <span className="block text-xs text-muted-foreground">
                  {s.printerIds.length ? `Prints on ${s.printerIds.map(nameOf).join(', ')}` : 'No printer (KOTs are not printed)'}
                  {s.hasKds ? ' · kitchen screen' : ''}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <KitchenScreens />

      {station ? <StationDialog station={station === 'new' ? null : station} printers={printers} onClose={() => setStation(null)} /> : null}
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
          <Toggle checked={hasKds} onChange={setHasKds} label="Has a kitchen screen (KDS)" hint="Its tickets show on a kitchen screen (Settings › Kitchen › Use kitchen screens)." />
        </div>
        <ErrorText error={error} />
        <DialogButtons busy={busy} onCancel={onClose} disabled={!name.trim()} />
      </form>
    </Modal>
  );
}

/** Kitchen screens (P4-02): where to open them, and when a ticket turns amber and red. */
function KitchenScreens() {
  const { api, serverUrl } = useApp();
  const config = useQuery({ queryKey: ['config'], queryFn: () => api.get<OutletConfig>('/v1/config') });
  // The master PC talks to itself on 127.0.0.1; a tablet needs one of its network addresses.
  const network = useQuery({ queryKey: ['network'], queryFn: () => api.get<{ urls: string[]; nameUrl?: string | null }>('/v1/network') });
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
      <div className="mb-3 space-y-3 rounded-xl border border-border bg-card p-4" aria-label="Kitchen screen use">
        <Toggle
          checked={config.data['kds.enabled']}
          onChange={(on) => void save('SetConfig', { values: { 'kds.enabled': on } })}
          label="Use kitchen screens (KDS)"
          hint="On: the order screen says Send to KDS. Off: it says KOT. Tick “Has a kitchen screen” on each station that has one."
        />
        {config.data['kds.enabled'] ? (
          <Toggle
            checked={config.data['kds.printPaper']}
            onChange={(on) => void save('SetConfig', { values: { 'kds.printPaper': on } })}
            label="Also print paper KOTs at stations with a screen"
            hint="Off: those stations get the ticket only on the screen (Reprint KOT on the order still prints it). Stations without a screen always print."
          />
        ) : null}
      </div>
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
        {network.data?.nameUrl ? (
          <p className="mt-2 pl-6 text-sm text-muted-foreground">
            The number address can change when this PC restarts or wakes up. In a browser, open{' '}
            <span className="font-mono font-semibold text-foreground" data-testid="kds-name-url">
              {network.data.nameUrl}/kds
            </span>{' '}
            instead: it keeps working (Windows PCs and iPhones; on Android, reserve this PC’s address in the Wi-Fi router). The DinePOS Kitchen app
            finds this PC by itself.
          </p>
        ) : null}
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
