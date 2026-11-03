// Building blocks shared by the Settings sections.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';

/** Mirror of the server's AdminCatalog (apps/server/src/queries/admin-catalog.ts). */
export interface AdminCatalog {
  areas: Array<{ id: string; name: string; sort: number; priceListId: string | null; taxProfileId: string | null }>;
  tables: Array<{ id: string; areaId: string; label: string; seats: number | null; layoutX: number | null; layoutY: number | null; status: 'active' | 'reserved' | 'blocked'; occupied: boolean }>;
  printers: Array<{
    id: string;
    name: string;
    transport: 'tcp' | 'usb' | 'fake';
    host: string | null;
    port: number;
    windowsName: string | null;
    widthMm: 58 | 80;
    bitmapText: boolean;
    copies: number;
    cutter: boolean;
    backupPrinterId: string | null;
    role: 'kot' | 'bill' | 'both';
  }>;
  stations: Array<{ id: string; name: string; hasKds: boolean; printerIds: string[] }>;
  categories: Array<{ id: string; name: string; parentId: string | null; stationId: string | null; sort: number }>;
  addonGroups: Array<{ id: string; name: string; minSelect: number; maxSelect: number; addons: Array<{ id: string; name: string; pricePaise: number }> }>;
  items: Array<{
    id: string;
    categoryId: string;
    name: string;
    shortCode: string | null;
    veg: boolean;
    basePricePaise: number;
    taxRateBp: number;
    hsnSac: string | null;
    stationId: string | null;
    available: boolean;
    active: boolean;
    sort: number;
    variants: Array<{ id: string; name: string; pricePaise: number; sort: number }>;
    addonGroupIds: string[];
  }>;
}

export function useCatalog() {
  const { api } = useApp();
  return useQuery({ queryKey: ['catalog'], queryFn: () => api.get<AdminCatalog>('/v1/admin/catalog') });
}

/**
 * Sends one settings command with busy/error state; refreshes the catalog and the screens that show it.
 * Returns true on success.
 */
export function useSave() {
  const { api } = useApp();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (type: string, payload: unknown): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await api.command(type, payload);
      await Promise.all(['catalog', 'menu', 'floor', 'config', 'staff', 'roles', 'printers', 'captain-sections'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { save, busy, error, setError };
}

export function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="font-display text-2xl font-semibold">{title}</h2>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-semibold">
      {label}
      <div className="mt-1 font-normal">{children}</div>
      {hint ? <span className="mt-1 block text-xs font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="font-semibold">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

export function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="mt-3 text-sm font-semibold text-danger">
      {error}
    </p>
  ) : null;
}

export function DialogButtons({ busy, onCancel, label = 'Save', disabled = false }: { busy: boolean; onCancel: () => void; label?: string; disabled?: boolean }) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <button type="button" className="btn" onClick={onCancel}>
        Cancel
      </button>
      <button type="submit" className="btn btn-primary" disabled={busy || disabled}>
        {busy ? 'Saving…' : label}
      </button>
    </div>
  );
}

/** Common GST rates for restaurants (basis points); any other rate can be typed. */
export const GST_RATES = [0, 500, 1200, 1800, 2800];

export const Empty = ({ children }: { children: ReactNode }) => <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{children}</p>;
