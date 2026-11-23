// DinePOS for Android: a USB receipt printer plugged into the device (USB-C cable, OTG adapter, a POS machine's USB
// port) is noticed on any screen. Not set up yet → "Use for bills" in one tap; set up → it says so; unplugged → its
// prints wait. The app sends the "dinepos-usb-printer" page event (apps/android/.../UsbPrinters.java).
import { useQueryClient } from '@tanstack/react-query';
import { Usb, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';
import { billPrinter, type UsbDevice } from '../settings/PrinterSettings.js';
import type { AdminCatalog } from '../settings/common.js';
import { androidApp, USB_PRINTER_EVENT, type UsbPrinterEvent } from './android-app.js';

type Notice =
  | { kind: 'new'; device: UsbDevice }
  | { kind: 'text'; text: string; tone: 'ok' | 'warn'; allow?: string }
  | { kind: 'done'; text: string };

export function UsbPrinterNotice({ onPrinters }: { onPrinters?: () => void }) {
  const { api, can } = useApp();
  const qc = useQueryClient();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const admin = can('admin');
  const latest = useRef(0);

  useEffect(() => {
    if (!androidApp()) return;
    const on = (ev: Event) => {
      const e = (ev as CustomEvent<UsbPrinterEvent>).detail;
      if (!e || typeof e.device !== 'string') return;
      const n = ++latest.current;
      setError(null);
      void qc.invalidateQueries({ queryKey: ['usb-printers'] });
      void qc.invalidateQueries({ queryKey: ['printers'] });
      if (e.event === 'needs-allow') return setNotice({ kind: 'text', tone: 'warn', text: `${e.name} plugged in. Tap OK on the screen to let DinePOS use it.` });
      if (e.event === 'not-allowed')
        return setNotice({ kind: 'text', tone: 'warn', text: `DinePOS was not allowed to use ${e.name}. It cannot print until you allow it.`, allow: e.device });
      if (e.event === 'unplugged') return setNotice({ kind: 'text', tone: 'warn', text: `${e.name} unplugged. Its prints wait in the print alarm until it is plugged in again.` });
      if (!admin) return setNotice({ kind: 'text', tone: 'ok', text: `${e.name} connected.` });
      // connected: is it set up already?
      void api
        .get<{ devices: UsbDevice[] }>('/v1/printers/usb-devices?refresh=1')
        .then((r) => {
          if (n !== latest.current) return;
          const d = r.devices.find((x) => x.device?.toLowerCase().startsWith(e.device.toLowerCase()));
          if (!d) return setNotice({ kind: 'text', tone: 'ok', text: `${e.name} connected.` });
          if (d.printerName) return setNotice({ kind: 'text', tone: 'ok', text: `${d.printerName} printer connected. It is ready to print.` });
          setNotice({ kind: 'new', device: d });
        })
        .catch(() => n === latest.current && setNotice({ kind: 'text', tone: 'ok', text: `${e.name} connected. Set it up in Settings › Printers.` }));
    };
    window.addEventListener(USB_PRINTER_EVENT, on);
    return () => window.removeEventListener(USB_PRINTER_EVENT, on);
  }, [api, qc, admin]);

  // short messages go by themselves; a printer to set up stays until answered
  useEffect(() => {
    if (!notice || notice.kind === 'new' || (notice.kind === 'text' && notice.allow)) return;
    const t = setTimeout(() => setNotice(null), notice.kind === 'text' && notice.tone === 'warn' ? 8_000 : 5_000);
    return () => clearTimeout(t);
  }, [notice]);

  if (!notice) return null;
  const useForBills = async (d: UsbDevice) => {
    setBusy(true);
    setError(null);
    try {
      const { printers } = await api.get<AdminCatalog>('/v1/admin/catalog');
      await api.command('UpsertPrinter', billPrinter(d, printers));
      await Promise.all(['catalog', 'printers', 'config', 'usb-printers'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      setNotice({ kind: 'done', text: `${d.name} prints the bills now. Test it in Settings › Printers.` });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not set it up. Try Settings › Printers.');
    } finally {
      setBusy(false);
    }
  };

  const tone = notice.kind === 'text' && notice.tone === 'warn' ? 'border-warn' : 'border-primary';
  return (
    <div role={notice.kind === 'new' ? 'dialog' : 'status'} aria-label="USB printer" className={`fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-xl border-2 ${tone} bg-card p-4 shadow-xl`}>
      <div className="flex items-start gap-3">
        <Usb className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1 text-sm">
          {notice.kind === 'new' ? (
            <>
              <p className="font-semibold">USB printer connected: {notice.device.name}</p>
              <p className="text-muted-foreground">Print the bills on it? You can add KOT stations and the cash drawer in Settings › Printers.</p>
            </>
          ) : (
            <p className="font-semibold">{notice.text}</p>
          )}
          {error ? <p className="mt-1 text-danger">{error}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {notice.kind === 'new' ? (
              <button className="btn btn-primary h-9" disabled={busy} onClick={() => void useForBills(notice.device)}>
                {busy ? 'Setting up…' : 'Use for bills'}
              </button>
            ) : null}
            {notice.kind === 'text' && notice.allow ? (
              <button className="btn btn-primary h-9" onClick={() => androidApp()?.allowUsbPrinter?.(notice.allow!)}>
                Allow
              </button>
            ) : null}
            {onPrinters && (notice.kind === 'new' || notice.kind === 'done') ? (
              <button
                className="btn h-9"
                onClick={() => {
                  setNotice(null);
                  onPrinters();
                }}
              >
                Printer settings
              </button>
            ) : null}
          </div>
        </div>
        <button className="btn h-8 w-8 p-0" aria-label="Close" onClick={() => setNotice(null)}>
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
