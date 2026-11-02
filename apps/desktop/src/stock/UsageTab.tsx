import { formatINR, formatQty, sumPaise, UNIT_LABELS, type StockUsageRow } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../app-context.js';
import { paiseToInput } from '../billing/money-input.js';
import { Empty } from '../settings/common.js';
import { localToday, qtyText } from './common.js';

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Consumption over business dates: what was received, used by KOTs, wasted and corrected, per material. */
export function UsageTab() {
  const { api } = useApp();
  const [from, setFrom] = useState(localToday);
  const [to, setTo] = useState(localToday);
  const valid = from && to && from <= to;
  const usage = useQuery({
    queryKey: ['stock-usage', from, to],
    queryFn: () => api.get<{ rows: StockUsageRow[] }>(`/v1/stock/usage?from=${from}&to=${to}`),
    enabled: !!valid,
  });
  const rows = usage.data?.rows ?? [];

  const download = () => {
    const head = ['Material', 'Unit', 'Opening', 'Received', 'Used', 'Wasted', 'Adjusted', 'Closing', 'Used value (Rs)', 'Wasted value (Rs)'];
    const lines = rows.map((r) =>
      [r.name, UNIT_LABELS[r.unit], ...[r.openingMilli, r.purchasedMilli, r.usedMilli, r.wastedMilli, r.adjustedMilli, r.closingMilli].map(formatQty), paiseToInput(r.usedValuePaise), paiseToInput(r.wastedValuePaise)]
        .map(csvCell)
        .join(','),
    );
    const blob = new Blob([`${String.fromCharCode(0xfeff)}${[head.join(','), ...lines].join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `stock-usage-${from}-to-${to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="text-sm font-semibold">
          From
          <input className="input mt-1 w-44" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm font-semibold">
          To
          <input className="input mt-1 w-44" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <p className="flex-1 text-sm text-muted-foreground">By business date. Values are at each material's last purchase cost.</p>
        <button className="btn" onClick={download} disabled={rows.length === 0}>
          <Download className="h-4 w-4" /> Download CSV
        </button>
      </div>
      {!valid ? <p className="text-sm text-danger">Choose a start date on or before the end date.</p> : null}
      {usage.data && rows.length === 0 ? <Empty>No materials yet.</Empty> : null}
      {rows.length ? (
        <table className="w-full rounded-xl border border-border bg-card text-sm" aria-label="Stock usage">
          <thead>
            <tr className="border-b border-border text-right text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 text-left">Material</th>
              <th className="px-3 py-2">Opening</th>
              <th className="px-3 py-2">Received</th>
              <th className="px-3 py-2">Used</th>
              <th className="px-3 py-2">Wasted</th>
              <th className="px-3 py-2">Adjusted</th>
              <th className="px-3 py-2">Closing</th>
              <th className="px-3 py-2">Used ₹</th>
              <th className="px-3 py-2">Wasted ₹</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.stockItemId} className="border-b border-border text-right tabular-nums last:border-0">
                <td className="px-3 py-2 text-left font-semibold">{r.name}</td>
                <td className="px-3 py-2">{qtyText(r.openingMilli, r)}</td>
                <td className="px-3 py-2">{r.purchasedMilli ? qtyText(r.purchasedMilli, r) : '—'}</td>
                <td className="px-3 py-2">{r.usedMilli ? qtyText(r.usedMilli, r) : '—'}</td>
                <td className={`px-3 py-2 ${r.wastedMilli ? 'text-danger' : ''}`}>{r.wastedMilli ? qtyText(r.wastedMilli, r) : '—'}</td>
                <td className="px-3 py-2">{r.adjustedMilli ? `${r.adjustedMilli > 0 ? '+' : ''}${qtyText(r.adjustedMilli, r)}` : '—'}</td>
                <td className={`px-3 py-2 font-semibold ${r.closingMilli < 0 ? 'text-danger' : ''}`}>{qtyText(r.closingMilli, r)}</td>
                <td className="px-3 py-2">{formatINR(r.usedValuePaise)}</td>
                <td className="px-3 py-2">{formatINR(r.wastedValuePaise)}</td>
              </tr>
            ))}
            <tr className="text-right font-semibold tabular-nums">
              <td className="px-3 py-2 text-left" colSpan={7}>
                Total
              </td>
              <td className="px-3 py-2">{formatINR(sumPaise(rows.map((r) => r.usedValuePaise)))}</td>
              <td className="px-3 py-2">{formatINR(sumPaise(rows.map((r) => r.wastedValuePaise)))}</td>
            </tr>
          </tbody>
        </table>
      ) : null}
    </>
  );
}
