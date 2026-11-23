import { newId, type FailedPrintJob } from '@dinepos/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bluetooth, CircleAlert, Monitor, Pencil, Plus, Power, Printer, RefreshCw, RotateCw, Search, Trash2, Usb, Wifi } from 'lucide-react';
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';
import { androidApp, printerHost, USB_PRINTER_EVENT } from '../components/android-app.js';
import { Modal } from '../components/Modal.js';
import { Empty, ErrorText, Field, SectionHeader, Toggle, useCatalog, useSave, type AdminCatalog } from './common.js';
import { PrintAgents, usePrintAgents } from './PrintAgents.js';

const BLUETOOTH_MAC = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;

type PrinterRow = AdminCatalog['printers'][number];
type Station = AdminCatalog['stations'][number];
type Transport = PrinterRow['transport'];
type Kind = 'usb' | 'wifi' | 'bluetooth' | 'screen';

interface PrinterStatus {
  id: string;
  status: 'ok' | 'retrying' | 'offline';
  queued: number;
  lastError?: string;
  agent?: { id: string; name: string };
}
/** A USB printer plugged into the outlet server PC, or the Android device DinePOS runs on (GET /v1/printers/usb-devices). */
export interface UsbDevice {
  key: string;
  transport: 'usbdirect' | 'usb';
  device: string | null;
  windowsName: string | null;
  name: string;
  detail: string;
  widthMm: 58 | 80;
  printerId: string | null;
  printerName: string | null;
  /** False: plugged into the Android device, but Android does not let DinePOS use it yet (Allow). */
  allowed: boolean;
}
interface WindowsPrinter {
  name: string;
  port: string;
  driver: string;
  offline: boolean;
  connection: 'usb' | 'serial' | 'bluetooth' | 'network' | 'virtual' | 'other';
}
interface SerialPortInfo {
  port: string;
  name: string;
  bluetooth: boolean;
}

const kinds = (): Array<{ kind: Kind; label: string; hint: string; icon: ComponentType<{ className?: string }> }> => [
  { kind: 'usb', label: 'USB', hint: androidApp() ? 'Plugged into this device with a USB or Type-C cable' : 'Plugged into the main PC with a USB cable', icon: Usb },
  { kind: 'wifi', label: 'Wi-Fi / network', hint: 'On the shop Wi-Fi or a network cable', icon: Wifi },
  { kind: 'bluetooth', label: 'Bluetooth', hint: `Paired with ${printerHost()} over Bluetooth`, icon: Bluetooth },
  { kind: 'screen', label: 'Screen only', hint: `No printer: prints are kept as text on ${printerHost()}`, icon: Monitor },
];
const kindOf = (t: Transport): Kind => (t === 'tcp' ? 'wifi' : t === 'serial' ? 'bluetooth' : t === 'fake' ? 'screen' : 'usb');

/** How the printer is reached, in words. */
export function connectionText(p: Pick<PrinterRow, 'transport' | 'host' | 'port' | 'windowsName' | 'device'>): string {
  switch (p.transport) {
    case 'tcp':
      return `Wi-Fi / network ${p.host ?? ''}${p.port && p.port !== 9100 ? `:${p.port}` : ''}`;
    case 'usb':
      return `USB, Windows printer “${p.windowsName ?? ''}”`;
    case 'usbdirect':
      return `USB, no driver (${p.device ?? ''})`;
    case 'serial':
      return `Bluetooth / ${p.device ?? ''}`;
    case 'fake':
      return 'Screen only (no paper)';
  }
}

/** What the printer prints, in words. */
function printsText(p: PrinterRow, stations: Station[]): string {
  const mine = stations.filter((s) => s.printerIds.includes(p.id)).map((s) => s.name);
  const kot = p.role !== 'bill' ? (mine.length ? `KOTs for ${mine.join(', ')}` : 'KOTs (no station yet)') : '';
  const bill = p.role !== 'kot' ? `Bills${p.drawer ? ' + cash drawer' : ''}` : '';
  return [bill, kot].filter(Boolean).join(' · ');
}

/**
 * Settings › Printers (quickPOS printer setup): the USB printers plugged into the main PC, every printer with its
 * status and tests, and Add printer in steps. Printers are on the main PC (or a print agent); a terminal elsewhere
 * sets them up through the outlet server.
 */
export function PrinterSettings() {
  const { api } = useApp();
  const qc = useQueryClient();
  const catalog = useCatalog();
  const status = useQuery({ queryKey: ['printers'], queryFn: () => api.get<{ printers: PrinterStatus[] }>('/v1/printers'), refetchInterval: 10_000 });
  const failed = useQuery({ queryKey: ['failed-prints'], queryFn: () => api.get<{ jobs: FailedPrintJob[] }>('/v1/print-jobs/failed'), refetchInterval: 10_000 });
  const agents = usePrintAgents();
  const { save, busy, error, setError } = useSave();
  const [editing, setEditing] = useState<{ printer: PrinterRow | null; prefill?: Partial<PrinterRow> } | null>(null);
  const [removing, setRemoving] = useState<PrinterRow | null>(null);
  const [note, setNote] = useState<string | null>(null);
  if (!catalog.data) return <p className="text-muted-foreground">Loading…</p>;
  const { printers, stations } = catalog.data;
  const live = (id: string) => status.data?.printers.find((p) => p.id === id);
  const failedOf = (id: string) => (failed.data?.jobs ?? []).filter((j) => j.printerId === id);
  const billReady = printers.some((p) => p.active && p.role !== 'kot');
  const done = (text: string) => {
    setNote(text);
    setError(null);
  };

  const testPrint = (p: PrinterRow) => void save('PrintTestPage', { printerId: p.id }).then((ok) => ok && done(`Test page sent to ${p.name}.`));
  const toggle = (p: PrinterRow) =>
    void save('UpsertPrinter', payloadOf(p, { active: !p.active })).then((ok) => ok && done(p.active ? `${p.name} turned off. Tickets waiting for it are in the print alarm.` : `${p.name} turned on.`));
  const retry = async (p: PrinterRow) => {
    const ids = failedOf(p.id).map((j) => j.id).slice(0, 50);
    if (!ids.length) return;
    const ok = await save('RetryPrintJobs', { jobIds: ids });
    if (ok) {
      await qc.invalidateQueries({ queryKey: ['failed-prints'] });
      done(`${ids.length} ticket(s) sent to ${p.name} again.`);
    }
  };
  const remove = async (p: PrinterRow) => {
    try {
      const r = await api.command<{ removed: boolean }>('RemovePrinter', { printerId: p.id });
      await Promise.all(['catalog', 'printers', 'config'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      done(r.result?.removed ? `${p.name} removed.` : `${p.name} has print history, so it was turned off instead.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not remove it. Try again.');
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="max-w-4xl">
      <SectionHeader
        title="Printers"
        subtitle="Bill and kitchen (KOT) printers: USB, Wi-Fi and Bluetooth. Stations choose their KOT printers here or in Kitchen."
        action={
          <button className="btn btn-primary" onClick={() => setEditing({ printer: null })}>
            <Plus className="h-4 w-4" /> Add printer
          </button>
        }
      />
      {!billReady ? (
        <p className="mb-4 flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/5 p-3 text-sm" role="status">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <span>
            <b>No printer prints the bills yet.</b> Plug in a USB printer below, or add a Wi-Fi or Bluetooth printer.
          </span>
        </p>
      ) : null}
      {note ? (
        <p className="mb-3 text-sm font-semibold text-ok" role="status">
          {note}
        </p>
      ) : null}
      <ErrorText error={error} />

      <PluggedIn
        printers={printers}
        onUseForBills={(d) => void save('UpsertPrinter', billPrinter(d, printers)).then((ok) => ok && done(`${d.name} set up for bills. Press Test print to check it.`))}
        onOptions={(d) => setEditing({ printer: null, prefill: { name: d.name, transport: d.transport, windowsName: d.windowsName, device: d.device, widthMm: d.widthMm } })}
        onTest={(id) => {
          const p = printers.find((x) => x.id === id);
          if (p) testPrint(p);
        }}
        busy={busy}
      />

      <h3 className="mb-2 mt-6 font-semibold">Your printers</h3>
      {printers.length === 0 ? <Empty>No printers yet.</Empty> : null}
      <ul className="space-y-2" aria-label="Printers">
        {printers.map((p) => {
          const s = live(p.id);
          const waiting = failedOf(p.id).length;
          return (
            <li key={p.id} className={`rounded-xl border border-border bg-card p-3 ${p.active ? '' : 'opacity-70'}`} data-printer={p.name}>
              <div className="flex flex-wrap items-center gap-2">
                <Printer className="h-5 w-5 text-muted-foreground" />
                <span className="font-semibold">{p.name}</span>
                {!p.active ? <span className="rounded bg-secondary px-1.5 py-0.5 text-xs font-bold">Off</span> : null}
                {p.active && s && s.status !== 'ok' ? (
                  <span className="rounded bg-danger px-1.5 py-0.5 text-xs font-bold text-white" title={s.lastError}>
                    {s.status === 'offline' ? 'Not printing' : 'Retrying'}
                  </span>
                ) : null}
                {waiting ? <span className="rounded bg-warn px-1.5 py-0.5 text-xs font-bold text-white">{waiting} failed</span> : null}
                <span className="ml-auto flex flex-wrap gap-1">
                  <button className="btn h-8" disabled={busy || !p.active} onClick={() => testPrint(p)}>
                    <Printer className="h-4 w-4" /> Test print
                  </button>
                  {waiting ? (
                    <button className="btn h-8" disabled={busy || !p.active} onClick={() => void retry(p)}>
                      <RotateCw className="h-4 w-4" /> Retry failed
                    </button>
                  ) : null}
                  <button className="btn h-8" disabled={busy} onClick={() => toggle(p)} aria-label={`${p.active ? 'Turn off' : 'Turn on'} ${p.name}`}>
                    <Power className="h-4 w-4" /> {p.active ? 'Turn off' : 'Turn on'}
                  </button>
                  <button className="btn h-8" onClick={() => setEditing({ printer: p })} aria-label={`Edit ${p.name}`}>
                    <Pencil className="h-4 w-4" /> Edit
                  </button>
                  <button className="btn h-8" onClick={() => setRemoving(p)} aria-label={`Remove ${p.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </span>
              </div>
              <p className="mt-1 pl-7 text-sm text-muted-foreground">
                {connectionText(p)} · {p.widthMm} mm · {printsText(p, stations)}
                {p.copies > 1 ? ` · ${p.copies} copies` : ''}
                {p.profile === 'slow_buffer' ? ' · slow data speed' : ''}
              </p>
              {agents.data?.agents.length || s?.agent ? (
                <label className="mt-1 flex items-center gap-1 pl-7 text-xs text-muted-foreground">
                  Printed by
                  <select
                    className="input h-8 w-44 text-xs"
                    aria-label={`Printed by (${p.name})`}
                    value={s?.agent?.id ?? ''}
                    disabled={busy}
                    onChange={(e) => void save('SetPrinterAgent', { printerId: p.id, agentId: e.target.value || null }).then(() => status.refetch())}
                  >
                    <option value="">{androidApp() ? 'This device' : 'The main PC'}</option>
                    {agents.data?.agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.online ? '' : ' (offline)'}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </li>
          );
        })}
      </ul>

      <PrintAgents />

      {editing ? (
        <PrinterDialog
          printer={editing.printer}
          prefill={editing.prefill}
          printers={printers}
          stations={stations}
          onClose={() => setEditing(null)}
          onSaved={(isNew) => {
            setEditing(null);
            done(isNew ? 'Printer added. Press Test print to check it.' : 'Printer saved.');
          }}
        />
      ) : null}
      {removing ? (
        <Modal title={`Remove ${removing.name}?`} onClose={() => setRemoving(null)}>
          <p className="text-sm">
            It stops printing and its stations no longer print on it. A printer that has printed before is turned off instead of removed, so its print
            history stays.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn" onClick={() => setRemoving(null)}>
              Cancel
            </button>
            <button className="btn bg-danger text-white" data-autofocus onClick={() => void remove(removing)}>
              Remove
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

/** UpsertPrinter for a plugged-in USB printer that prints the bills (and opens the drawer if no other printer does). */
export function billPrinter(d: UsbDevice, printers: PrinterRow[]) {
  return {
    id: newId(),
    name: d.name,
    transport: d.transport,
    windowsName: d.windowsName,
    device: d.device,
    widthMm: d.widthMm,
    role: 'bill' as const,
    drawer: !printers.some((p) => p.active && p.drawer),
    stationIds: [],
  };
}

/** The UpsertPrinter payload for an existing printer, with changes. */
function payloadOf(p: PrinterRow, patch: Partial<PrinterRow> = {}) {
  const x = { ...p, ...patch };
  return {
    id: x.id,
    name: x.name,
    transport: x.transport,
    host: x.transport === 'tcp' ? x.host : null,
    port: x.port || 9100,
    windowsName: x.transport === 'usb' ? x.windowsName : null,
    device: x.transport === 'usbdirect' || x.transport === 'serial' ? x.device : null,
    widthMm: x.widthMm,
    bitmapText: x.bitmapText,
    copies: x.copies,
    cutter: x.cutter,
    backupPrinterId: x.backupPrinterId,
    role: x.role,
    profile: x.profile,
    active: x.active,
    drawer: x.drawer,
  };
}

/** quickPOS plug and play: USB printers plugged into the main PC (or this Android device), set up in one tap. */
function PluggedIn({ printers, onUseForBills, onOptions, onTest, busy }: { printers: PrinterRow[]; onUseForBills: (d: UsbDevice) => void; onOptions: (d: UsbDevice) => void; onTest: (printerId: string) => void; busy: boolean }) {
  const { api } = useApp();
  const [refresh, setRefresh] = useState(0);
  const scan = useQuery({
    queryKey: ['usb-printers', refresh],
    queryFn: () => api.get<{ scannedAt: string; devices: UsbDevice[] }>(`/v1/printers/usb-devices${refresh ? '?refresh=1' : ''}`),
    refetchInterval: 6_000, // a newly plugged printer shows up within seconds
  });
  const devices = scan.data?.devices ?? [];
  const android = androidApp();
  // DinePOS for Android: the app says when a printer is plugged in, allowed or unplugged; look at once
  useEffect(() => {
    if (!android) return;
    const on = () => setRefresh((n) => n + 1);
    window.addEventListener(USB_PRINTER_EVENT, on);
    return () => window.removeEventListener(USB_PRINTER_EVENT, on);
  }, [android]);
  const title = `USB printers plugged into ${printerHost()}`;
  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-label={title}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Usb className="h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-[14rem] flex-1">
          <h3 className="font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">
            {android
              ? 'Plug the printer into this device’s USB or Type-C port (a USB-C printer cable, or an OTG adapter) and switch it on. When Android asks to open DinePOS or to allow the printer, tap OK. It shows here at once.'
              : 'Plug in the printer and switch it on. It shows here within a few seconds, with or without a Windows driver.'}
            {scan.data ? ` Last checked ${new Date(scan.data.scannedAt).toLocaleTimeString('en-IN')}.` : ''}
          </p>
        </div>
        <button className="btn ml-auto h-8" onClick={() => setRefresh((n) => n + 1)} disabled={scan.isFetching}>
          <RefreshCw className="h-4 w-4" /> {scan.isFetching ? 'Looking…' : 'Look again'}
        </button>
      </div>
      {scan.isError ? <p className="text-sm text-danger">{scan.error instanceof ApiError ? scan.error.message : 'Could not look for USB printers.'}</p> : null}
      {scan.data && devices.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          <p className="font-medium text-foreground">No USB printer found.</p>
          <ul className="ml-5 list-disc">
            <li>Check the USB cable at both ends and that the printer is switched on (its light is on).</li>
            {android ? <li>A phone or tablet needs a USB-C to USB printer cable, or an OTG adapter; a charging-only cable does not work.</li> : null}
            <li>Wi-Fi and Bluetooth printers are added with Add printer.</li>
          </ul>
        </div>
      ) : null}
      <ul className="divide-y divide-border">
        {devices.map((d) => {
          const set = d.printerId ? printers.find((p) => p.id === d.printerId) : undefined;
          return (
            <li key={d.key} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-usb={d.name}>
              <span className="min-w-[12rem] flex-1">
                <span className="font-semibold">{d.name}</span>
                <span className="block text-xs text-muted-foreground">{d.detail}</span>
              </span>
              {set ? (
                <>
                  <span className="text-xs text-muted-foreground">
                    Set up as <b>{set.name}</b>
                    {set.active ? '' : ' (off)'}
                  </span>
                  {set.active ? (
                    <button className="btn h-8" disabled={busy} onClick={() => onTest(set.id)}>
                      <Printer className="h-4 w-4" /> Test print
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  {!d.allowed && d.device ? (
                    <button className="btn h-8" onClick={() => android?.allowUsbPrinter?.(d.device!)} disabled={!android?.allowUsbPrinter} title={android ? undefined : 'Allow it on the DinePOS device'}>
                      Allow
                    </button>
                  ) : null}
                  <button className="btn btn-primary h-8" disabled={busy} onClick={() => onUseForBills(d)}>
                    Use for bills
                  </button>
                  <button className="btn h-8" onClick={() => onOptions(d)}>
                    Set up with options
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{n}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

const CONN_LABEL: Record<WindowsPrinter['connection'], string> = { usb: 'USB', serial: 'COM port', bluetooth: 'Bluetooth', network: 'Network', virtual: 'Not a printer (PDF / file)', other: 'Other' };
const BAUDS = ['', '19200', '38400', '57600', '115200'];

/** Add printer / Edit, in steps (quickPOS): connection → which printer → name and paper → what it prints → options. */
function PrinterDialog({
  printer,
  prefill,
  printers,
  stations,
  onClose,
  onSaved,
}: {
  printer: PrinterRow | null;
  prefill?: Partial<PrinterRow>;
  printers: PrinterRow[];
  stations: Station[];
  onClose: () => void;
  onSaved: (isNew: boolean) => void;
}) {
  const { save, busy, error, setError } = useSave();
  const start = { ...prefill, ...printer };
  const hasBill = printers.some((p) => p.active && p.role !== 'kot' && p.id !== printer?.id);
  const [kind, setKind] = useState<Kind>(kindOf(start.transport ?? 'usb'));
  const [transport, setTransport] = useState<Transport>(start.transport ?? 'usb');
  const [windowsName, setWindowsName] = useState(start.windowsName ?? '');
  const [device, setDevice] = useState(start.transport === 'usbdirect' ? (start.device ?? '') : '');
  const [host, setHost] = useState(start.host ?? '');
  const [port, setPort] = useState(String(start.port ?? 9100));
  // a COM port and speed ("COM5:9600"), or on Android a Bluetooth address ("AA:BB:CC:DD:EE:FF")
  const btMac = start.transport === 'serial' && BLUETOOTH_MAC.test(start.device ?? '');
  const [com, setCom] = useState(start.transport === 'serial' ? (btMac ? start.device! : (start.device ?? '').split(':')[0]!) : '');
  const [baud, setBaud] = useState(start.transport === 'serial' && !btMac ? ((start.device ?? '').split(':')[1] ?? '') : '');
  const [name, setName] = useState(start.name ?? '');
  const [width, setWidth] = useState<58 | 80>(start.widthMm ?? 80);
  const [bills, setBills] = useState(printer ? printer.role !== 'kot' : !hasBill);
  const [drawer, setDrawer] = useState(printer ? printer.drawer : !printers.some((p) => p.active && p.drawer));
  const [chosen, setChosen] = useState<Set<string>>(new Set(printer ? stations.filter((s) => s.printerIds.includes(printer.id)).map((s) => s.id) : []));
  const [copies, setCopies] = useState(String(start.copies ?? 1));
  const [cutter, setCutter] = useState(start.cutter ?? true);
  const [backup, setBackup] = useState(start.backupPrinterId ?? '');
  const [slow, setSlow] = useState(start.profile === 'slow_buffer');
  const [active, setActive] = useState(start.active ?? true);

  const pickKind = (k: Kind) => {
    if (k === kind) return;
    setKind(k);
    setTransport(k === 'wifi' ? 'tcp' : k === 'bluetooth' ? 'serial' : k === 'screen' ? 'fake' : 'usb');
    setError(null);
  };
  const toggleStation = (id: string) =>
    setChosen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const submit = async () => {
    if (!name.trim()) return setError('Give the printer a name, like "Counter" or "Kitchen".');
    if (transport === 'usb' && !windowsName.trim()) return setError('Choose the USB printer.');
    if (transport === 'usbdirect' && !device) return setError('Choose the USB printer.');
    if (transport === 'tcp' && !host.trim()) return setError('Enter or find the printer’s IP address.');
    const mac = BLUETOOTH_MAC.test(com.trim());
    if (transport === 'serial' && !mac && !/^COM\d{1,3}$/i.test(com.trim())) return setError(androidApp() ? 'Choose the Bluetooth printer.' : 'Choose the Bluetooth COM port, like COM5.');
    if (!bills && chosen.size === 0) return setError('Choose what this printer prints: bills, kitchen tickets, or both.');
    const ok = await save('UpsertPrinter', {
      id: printer?.id ?? newId(),
      name: name.trim(),
      transport,
      host: transport === 'tcp' ? host.trim() : null,
      port: Number(port) || 9100,
      windowsName: transport === 'usb' ? windowsName.trim() : null,
      device: transport === 'usbdirect' ? device : transport === 'serial' ? `${com.trim().toUpperCase()}${baud && !mac ? `:${baud}` : ''}` : null,
      widthMm: width,
      bitmapText: printer?.bitmapText ?? false,
      copies: Math.min(5, Math.max(1, Number(copies) || 1)),
      cutter,
      backupPrinterId: backup || null,
      role: bills ? (chosen.size ? 'both' : 'bill') : 'kot',
      profile: slow ? 'slow_buffer' : 'generic',
      active,
      drawer: bills && drawer,
      stationIds: [...chosen],
    });
    if (ok) onSaved(!printer);
  };

  return (
    <Modal title={printer ? `Edit ${printer.name}` : 'Add printer'} onClose={onClose} wide>
      <div className="max-h-[70vh] overflow-y-auto pr-1">
        <Step n={1} title="How is the printer connected?">
          <div className="grid-cols-2 gap-2 [display:grid] sm:grid-cols-4" role="radiogroup" aria-label="Connection">
            {kinds().map(({ kind: k, label, hint, icon: Icon }) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                title={hint}
                onClick={() => pickKind(k)}
                className={`flex flex-col items-center gap-1 rounded-xl border p-3 text-sm font-semibold ${kind === k ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card hover:border-ring'}`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </button>
            ))}
          </div>
        </Step>

        {kind !== 'screen' ? (
          <Step n={2} title={kind === 'usb' ? 'Which USB printer?' : kind === 'wifi' ? 'Which network printer?' : 'Which Bluetooth printer?'}>
            {kind === 'usb' ? (
              <UsbPicker
                transport={transport}
                windowsName={windowsName}
                device={device}
                onPick={(t, value, label) => {
                  setTransport(t);
                  if (t === 'usb') setWindowsName(value);
                  else setDevice(value);
                  if (!name.trim() && label) setName(label.slice(0, 80));
                }}
              />
            ) : null}
            {kind === 'wifi' ? <WifiPicker host={host} port={port} onHost={setHost} onPort={setPort} /> : null}
            {kind === 'bluetooth' ? <BluetoothPicker com={com} baud={baud} onCom={setCom} onBaud={setBaud} /> : null}
          </Step>
        ) : (
          <p className="mb-4 text-xs text-muted-foreground">Prints go to text files on {printerHost()} (data\prints). For trying DinePOS without a printer.</p>
        )}

        <Step n={kind === 'screen' ? 2 : 3} title="Name and paper">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <input className="input" maxLength={80} placeholder="Counter, Kitchen…" value={name} onChange={(e) => setName(e.target.value)} aria-label="Printer name" />
            </Field>
            <div className="text-sm">
              <span className="mb-1 block font-semibold">Paper roll width</span>
              <div className="flex gap-2" role="radiogroup" aria-label="Paper">
                {([80, 58] as const).map((w) => (
                  <button key={w} type="button" role="radio" aria-checked={width === w} className={`tab h-9 ${width === w ? '' : ''}`} onClick={() => setWidth(w)}>
                    {w} mm · {w === 80 ? 48 : 32} letters
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Step>

        <Step n={kind === 'screen' ? 3 : 4} title="What should it print?">
          <div className="space-y-2 text-sm">
            <Toggle checked={bills} onChange={setBills} label="Customer bills" />
            {bills ? (
              <div className="pl-6">
                <Toggle checked={drawer} onChange={setDrawer} label="Open the cash drawer on cash bills" hint="The drawer cable is plugged into this printer." />
              </div>
            ) : null}
            <div>
              <span className="font-semibold">Kitchen tickets (KOT) for</span>
              <div className="mt-1 flex flex-wrap gap-2" aria-label="Stations">
                {stations.map((s) => (
                  <button key={s.id} type="button" aria-pressed={chosen.has(s.id)} className={`rounded-full border px-3 py-1 text-sm font-semibold ${chosen.has(s.id) ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`} onClick={() => toggleStation(s.id)}>
                    {s.name}
                  </button>
                ))}
                {stations.length > 1 ? (
                  <button
                    type="button"
                    className="rounded-full border border-dashed border-border px-3 py-1 text-sm"
                    onClick={() => setChosen(chosen.size === stations.length ? new Set() : new Set(stations.map((s) => s.id)))}
                  >
                    {chosen.size === stations.length ? 'None' : 'All stations'}
                  </button>
                ) : null}
              </div>
              {stations.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">Add kitchen stations in Settings › Kitchen first.</p> : null}
            </div>
          </div>
        </Step>

        <Step n={kind === 'screen' ? 4 : 5} title="More options">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Copies">
              <input className="input" inputMode="numeric" value={copies} onChange={(e) => setCopies(e.target.value.replace(/\D/g, ''))} aria-label="Copies" />
            </Field>
            <Field label="If it stops printing, send to" hint="Its tickets are reprinted there after three failed tries.">
              <select className="input" value={backup} onChange={(e) => setBackup(e.target.value)} aria-label="Backup printer">
                <option value="">No backup printer</option>
                {printers
                  .filter((p) => p.id !== printer?.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          <div className="mt-2 space-y-2">
            <Toggle checked={cutter} onChange={setCutter} label="Has a paper cutter" />
            <Toggle checked={slow} onChange={setSlow} label="Slow data speed" hint="Turn on if long bills come out cut off or with missing lines (common on cheap or Bluetooth printers)." />
            <Toggle checked={active} onChange={setActive} label="Printer is on" hint="Turn off to stop sending prints to it without removing it." />
          </div>
        </Step>
      </div>
      <ErrorText error={error} />
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Saving…' : printer ? 'Save changes' : 'Add printer'}
        </button>
      </div>
    </Modal>
  );
}

function Picker({ title, loading, onRefresh, refreshLabel, children }: { title: string; loading: boolean; onRefresh: () => void; refreshLabel: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-semibold">{title}</span>
        <button type="button" className="btn ml-auto h-8 text-xs" disabled={loading} onClick={onRefresh}>
          {refreshLabel === 'Find printers' ? <Search className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {loading ? 'Looking…' : refreshLabel}
        </button>
      </div>
      {children}
    </div>
  );
}

const pickClass = (on: boolean, dim = false) => `flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ${on ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-secondary'} ${dim ? 'opacity-60' : ''}`;

/** USB: printers plugged in with no driver, and printers installed in Windows on the main PC (Android: plugged into this device). */
function UsbPicker({ transport, windowsName, device, onPick }: { transport: Transport; windowsName: string; device: string; onPick: (t: 'usb' | 'usbdirect', value: string, label?: string) => void }) {
  const { api } = useApp();
  const usb = useQuery({ queryKey: ['usb-printers', 'picker'], queryFn: () => api.get<{ devices: UsbDevice[] }>('/v1/printers/usb-devices') });
  const android = androidApp() !== null;
  const win = useQuery({ queryKey: ['windows-printers'], queryFn: () => api.get<{ printers: WindowsPrinter[] }>('/v1/printers/windows'), enabled: !android });
  const driverless = (usb.data?.devices ?? []).filter((d) => d.transport === 'usbdirect');
  const installed = (win.data?.printers ?? []).slice().sort((a, b) => Number(b.connection === 'usb') - Number(a.connection === 'usb'));
  return (
    <Picker title={`Printers on ${printerHost()}`} loading={usb.isFetching || win.isFetching} onRefresh={() => void Promise.all([usb.refetch(), android ? null : win.refetch()])} refreshLabel="Refresh">
      {win.isError ? <p className="text-sm text-danger">{win.error instanceof ApiError ? win.error.message : 'Windows could not list the printers.'}</p> : null}
      <ul className="max-h-52 space-y-1 overflow-y-auto" aria-label="USB printers">
        {driverless.map((d) => (
          <li key={d.key}>
            <button type="button" aria-pressed={transport === 'usbdirect' && device === d.device} className={pickClass(transport === 'usbdirect' && device === d.device)} onClick={() => onPick('usbdirect', d.device!, d.name)}>
              <span className="min-w-0 flex-1 truncate font-semibold">{d.name}</span>
              <span className="max-w-[55%] truncate text-xs text-muted-foreground">{d.detail}</span>
            </button>
          </li>
        ))}
        {installed.map((p) => (
          <li key={p.name}>
            <button type="button" aria-pressed={transport === 'usb' && windowsName === p.name} className={pickClass(transport === 'usb' && windowsName === p.name, p.connection === 'virtual')} onClick={() => onPick('usb', p.name, p.name)}>
              <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {CONN_LABEL[p.connection]} · {p.port}
                {p.offline ? ' · offline' : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {usb.data && (win.data || android) && !driverless.length && !installed.length ? (
        <p className="text-sm text-muted-foreground">
          No printers found. Check the cable{android ? ' (a USB-C printer cable or an OTG adapter)' : ''} and that it is switched on, then Refresh.
        </p>
      ) : null}
      {android ? null : (
      <label className="mt-2 block text-xs text-muted-foreground">
        Or type the Windows printer name
        <input className="input mt-1" value={transport === 'usb' ? windowsName : ''} placeholder="POS-80" onChange={(e) => onPick('usb', e.target.value)} aria-label="Windows printer name" />
      </label>
      )}
    </Picker>
  );
}

/** Wi-Fi / network: an IP address, or Find printers (port 9100 on the main PC's network). */
function WifiPicker({ host, port, onHost, onPort }: { host: string; port: string; onHost: (v: string) => void; onPort: (v: string) => void }) {
  const { api } = useApp();
  const [found, setFound] = useState<Array<{ host: string }> | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const find = async () => {
    setScanning(true);
    setError(null);
    try {
      const r = await api.get<{ scanned: number; found: Array<{ host: string }> }>(`/v1/printers/network-scan?port=${Number(port) || 9100}`);
      setFound(r.found);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not look on the network.');
    } finally {
      setScanning(false);
    }
  };
  return (
    <Picker title="Printers on the shop network" loading={scanning} onRefresh={() => void find()} refreshLabel="Find printers">
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <Field label="IP address" hint="Set a fixed IP for the printer in the router.">
            <input className="input" value={host} placeholder="192.168.1.50" onChange={(e) => onHost(e.target.value.trim())} aria-label="IP address" />
          </Field>
        </div>
        <Field label="Port">
          <input className="input" inputMode="numeric" value={port} onChange={(e) => onPort(e.target.value.replace(/\D/g, ''))} aria-label="Port" />
        </Field>
      </div>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      {found ? (
        found.length ? (
          <ul className="mt-2 space-y-1" aria-label="Network printers found">
            {found.map((f) => (
              <li key={f.host}>
                <button type="button" aria-pressed={host === f.host} className={pickClass(host === f.host)} onClick={() => onHost(f.host)}>
                  <Wifi className="h-4 w-4" /> <span className="font-semibold">{f.host}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No printer answered on the network. Check it is on the same Wi-Fi as {printerHost()}, or type its IP address (print its self-test page to see it).</p>
        )
      ) : null}
    </Picker>
  );
}

/** Bluetooth: the outgoing COM port of a printer paired in Windows (Settings › Bluetooth › More Bluetooth options › COM Ports). */
function BluetoothPicker({ com, baud, onCom, onBaud }: { com: string; baud: string; onCom: (v: string) => void; onBaud: (v: string) => void }) {
  const { api } = useApp();
  const ports = useQuery({ queryKey: ['serial-ports'], queryFn: () => api.get<{ ports: SerialPortInfo[] }>('/v1/printers/serial-ports') });
  const list = (ports.data?.ports ?? []).slice().sort((a, b) => Number(b.bluetooth) - Number(a.bluetooth));
  if (androidApp()) return <AndroidBluetoothPicker ports={ports} list={list} mac={com} onMac={onCom} />;
  return (
    <Picker title="COM ports on the main PC" loading={ports.isFetching} onRefresh={() => void ports.refetch()} refreshLabel="Refresh">
      <p className="mb-2 text-xs text-muted-foreground">Pair the printer in Windows Bluetooth settings first. Its Outgoing COM port appears here.</p>
      {ports.isError ? <p className="text-sm text-danger">{ports.error instanceof ApiError ? ports.error.message : 'Could not list the COM ports.'}</p> : null}
      <ul className="max-h-44 space-y-1 overflow-y-auto" aria-label="COM ports">
        {list.map((p) => (
          <li key={p.port}>
            <button type="button" aria-pressed={com.toUpperCase() === p.port} className={pickClass(com.toUpperCase() === p.port)} onClick={() => onCom(p.port)}>
              <span className="font-semibold">{p.port}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {p.name}
                {p.bluetooth ? ' · Bluetooth' : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {ports.data && !list.length ? <p className="text-sm text-muted-foreground">No COM ports. Pair the printer in Windows Bluetooth settings, then Refresh.</p> : null}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Field label="COM port">
          <input className="input uppercase" value={com} placeholder="COM5" onChange={(e) => onCom(e.target.value.trim())} aria-label="COM port" />
        </Field>
        <Field label="Speed" hint="Bluetooth ignores it; a cable serial printer may need it.">
          <select className="input" value={baud} onChange={(e) => onBaud(e.target.value)} aria-label="Speed">
            {BAUDS.map((b) => (
              <option key={b} value={b}>
                {b || '9600 (usual)'}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Picker>
  );
}

/** DinePOS for Android: Bluetooth printers paired with this device, incl. a POS machine's built-in printer. */
function AndroidBluetoothPicker({ ports, list, mac, onMac }: { ports: { isFetching: boolean; isError: boolean; error: unknown; data?: unknown; refetch: () => unknown }; list: SerialPortInfo[]; mac: string; onMac: (v: string) => void }) {
  return (
    <Picker title="Bluetooth printers paired with this device" loading={ports.isFetching} onRefresh={() => void ports.refetch()} refreshLabel="Refresh">
      <p className="mb-2 text-xs text-muted-foreground">Pair the printer in Android Settings › Bluetooth first. A POS machine’s built-in printer is already there.</p>
      {ports.isError ? <p className="text-sm text-danger">{ports.error instanceof ApiError ? ports.error.message : 'Could not list the Bluetooth printers.'}</p> : null}
      <ul className="max-h-44 space-y-1 overflow-y-auto" aria-label="Bluetooth printers">
        {list.map((p) => (
          <li key={p.port}>
            <button type="button" aria-pressed={mac.toUpperCase() === p.port} className={pickClass(mac.toUpperCase() === p.port)} onClick={() => onMac(p.port)}>
              <Bluetooth className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{p.port}</span>
            </button>
          </li>
        ))}
      </ul>
      {ports.data && !list.length ? <p className="text-sm text-muted-foreground">No paired Bluetooth printer. Turn on Bluetooth, pair the printer in Android Settings, then Refresh.</p> : null}
    </Picker>
  );
}
