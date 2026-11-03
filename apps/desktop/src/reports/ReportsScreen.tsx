import { formatINR, reportToCsv, type ReportColumn, type ReportInfo, type ReportRow, type ReportTable } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../app-context.js';
import { UserBadge } from '../components/UserBadge.js';

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'custom';
const PRESETS: Array<[Preset, string]> = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['week', 'Last 7 days'],
  ['month', 'This month'],
  ['custom', 'Dates…'],
];

/** Business dates for a preset, counted back from today's business date (YYYY-MM-DD, calendar arithmetic in UTC). */
export function presetRange(p: Exclude<Preset, 'custom'>, today: string): { from: string; to: string } {
  const shift = (d: string, days: number) => new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  if (p === 'today') return { from: today, to: today };
  if (p === 'yesterday') return { from: shift(today, -1), to: shift(today, -1) };
  if (p === 'week') return { from: shift(today, -6), to: today };
  return { from: `${today.slice(0, 8)}01`, to: today };
}

function show(v: ReportRow[string] | undefined, c: ReportColumn): string {
  if (v === null || v === undefined || v === '') return c.type === 'text' ? '' : '—';
  if (c.type === 'money') return formatINR(Number(v));
  if (c.type === 'int') return Number(v).toLocaleString('en-IN');
  return String(v);
}

/** Reports (P4-03, docs/09 §6): pick a report and a range; figures come from the server; download as CSV for Excel. */
export function ReportsScreen({ onBack }: { onBack: () => void }) {
  const { api } = useApp();
  const list = useQuery({ queryKey: ['reports'], queryFn: () => api.get<{ reports: ReportInfo[]; businessDate: string }>('/v1/reports') });
  const [key, setKey] = useState('daily');
  const [preset, setPreset] = useState<Preset>('today');
  const today = list.data?.businessDate ?? '';
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const range = preset === 'custom' ? (custom ?? { from: today, to: today }) : presetRange(preset, today);
  const table = useQuery({
    queryKey: ['report', key, range.from, range.to],
    queryFn: () => api.get<ReportTable>(`/v1/reports/${key}?from=${range.from}&to=${range.to}`),
    enabled: !!today && range.from <= range.to,
  });
  const groups = [...new Set(list.data?.reports.map((r) => r.group) ?? [])];

  const download = () => {
    if (!table.data) return;
    const { filename, csv } = reportToCsv(table.data);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2.5">
        <button className="btn" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Floor
        </button>
        <h1 className="font-display text-xl font-semibold">Reports</h1>
        <div className="ml-auto">
          <UserBadge />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="w-64 shrink-0 overflow-y-auto border-r border-border bg-card p-3" aria-label="Reports">
          {groups.map((g) => (
            <div key={g} className="mb-4">
              <p className="mb-1 px-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{g}</p>
              {list.data!.reports
                .filter((r) => r.group === g)
                .map((r) => (
                  <button key={r.key} className={`block w-full rounded-lg px-2 py-1.5 text-left text-sm ${key === r.key ? 'bg-foreground font-semibold text-background' : 'hover:bg-secondary'}`} onClick={() => setKey(r.key)}>
                    {r.title}
                  </button>
                ))}
            </div>
          ))}
        </nav>
        <main className="min-w-0 flex-1 overflow-y-auto p-6">
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="flex gap-1" role="tablist" aria-label="Dates">
              {PRESETS.map(([p, label]) => (
                <button
                  key={p}
                  role="tab"
                  className="tab"
                  aria-selected={preset === p}
                  onClick={() => {
                    setPreset(p);
                    if (p === 'custom' && !custom) setCustom({ from: today, to: today });
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {preset === 'custom' ? (
              <>
                <input className="input w-40" type="date" aria-label="From" value={range.from} max={range.to} onChange={(e) => setCustom({ ...range, from: e.target.value })} />
                <input className="input w-40" type="date" aria-label="To" value={range.to} min={range.from} onChange={(e) => setCustom({ ...range, to: e.target.value })} />
              </>
            ) : (
              <span className="text-sm text-muted-foreground">{range.from === range.to ? range.from : `${range.from} to ${range.to}`} (business dates)</span>
            )}
            <button className="btn ml-auto" onClick={download} disabled={!table.data || table.data.rows.length === 0}>
              <Download className="h-4 w-4" /> Download CSV
            </button>
          </div>

          {table.data ? (
            <>
              <h2 className="font-display text-2xl font-semibold">{table.data.title}</h2>
              <p className="mb-4 text-sm text-muted-foreground">{table.data.description}</p>
              {table.data.summary.length ? (
                <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Headline figures">
                  {table.data.summary.map((s) => (
                    <div key={s.label} className="rounded-xl border border-border bg-card p-3">
                      <p className="truncate text-xs text-muted-foreground">{s.label}</p>
                      <p className="text-xl font-bold tabular-nums">{s.type === 'money' ? formatINR(Number(s.value)) : String(s.value)}</p>
                    </div>
                  ))}
                </div>
              ) : null}
              {table.data.rows.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nothing in these dates.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border bg-card">
                  <table className="w-full text-sm" aria-label={table.data.title} data-testid="report-table">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                        {table.data.columns.map((c) => (
                          <th key={c.key} className={`whitespace-nowrap px-3 py-2 ${c.type === 'text' ? 'text-left' : 'text-right'}`}>
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.data.rows.map((r, i) => (
                        <tr key={i} className="border-b border-border last:border-0">
                          {table.data.columns.map((c) => (
                            <td key={c.key} className={`px-3 py-1.5 ${c.type === 'text' ? '' : 'text-right tabular-nums'}`}>
                              {show(r[c.key], c)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    {table.data.totals ? (
                      <tfoot>
                        <tr className="border-t-2 border-border font-semibold">
                          {table.data.columns.map((c) => (
                            <td key={c.key} className={`px-3 py-2 ${c.type === 'text' ? '' : 'text-right tabular-nums'}`}>
                              {show(table.data.totals![c.key], c)}
                            </td>
                          ))}
                        </tr>
                      </tfoot>
                    ) : null}
                  </table>
                </div>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">{table.isError ? 'The report could not be made.' : 'Loading…'}</p>
          )}
        </main>
      </div>
    </div>
  );
}
