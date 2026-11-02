// Building blocks shared by the Stock tabs (docs/09 §8).
import { formatStockQty, type MenuSnapshot, type StockItemView, type StockMovementKind } from '@dinepos/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApp } from '../app-context.js';

export const STOCK_QUERY_KEYS = ['stock', 'purchases', 'recipes', 'stock-usage', 'stock-moves'] as const;

export const KIND_LABEL: Record<StockMovementKind, string> = {
  opening: 'Opening stock',
  purchase: 'Purchase',
  purchase_void: 'Purchase voided',
  sale: 'Used (KOT)',
  wastage: 'Wastage',
  count: 'Physical count',
  adjust: 'Correction',
};

export function useStock() {
  const { api } = useApp();
  return useQuery({ queryKey: ['stock'], queryFn: () => api.get<{ items: StockItemView[] }>('/v1/stock') });
}

/** The menu as billing sees it (active items, variants and add-ons); recipes are set on these. */
export function useMenu() {
  const { api } = useApp();
  return useQuery({ queryKey: ['menu', 'default'], queryFn: () => api.get<MenuSnapshot>('/v1/menu') });
}

/** Sends one stock command with busy/error state, then refreshes every stock view. Returns true on success. */
export function useStockCommand() {
  const { api } = useApp();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (type: string, payload: unknown): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await api.command(type, payload);
      await Promise.all([...STOCK_QUERY_KEYS, 'menu'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { send, busy, error, setError };
}

export function StatusPill({ item }: { item: Pick<StockItemView, 'low' | 'negative' | 'active'> }) {
  if (!item.active) return <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-muted-foreground">Off</span>;
  if (item.negative)
    return (
      <span className="rounded-full bg-danger/15 px-2 py-0.5 text-xs font-semibold text-danger" title="More was used than recorded. Do a physical count.">
        Count needed
      </span>
    );
  if (item.low) return <span className="rounded-full bg-warn/30 px-2 py-0.5 text-xs font-semibold text-foreground">Low</span>;
  return <span className="rounded-full bg-ok/15 px-2 py-0.5 text-xs font-semibold text-ok">OK</span>;
}

export const qtyText = (milli: number, item: Pick<StockItemView, 'unit'>) => formatStockQty(milli, item.unit);

/** dd Mon, hh:mm in the terminal's time zone. */
export const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Today's date (YYYY-MM-DD) on this terminal. */
export function localToday(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
