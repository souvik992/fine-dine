import { formatINR } from '@dinepos/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../app-context.js';

interface Card {
  key: string;
  label: string;
  hint: string;
  count: number;
  amountPaise: number;
}
interface Entry {
  seq: number;
  at: string;
  label: string;
  ref: string;
  amountPaise: number | null;
  reason: string | null;
  leakage: boolean;
  by: string | null;
  approvedBy: string | null;
  device: string | null;
}

/** Leakage dashboard (P4-01, docs/09 §5): counts and amounts for the dates; a card lists who, when and why. */
export function LeakageDashboard({ from, to }: { from: string; to: string }) {
  const { api } = useApp();
  const data = useQuery({
    queryKey: ['leakage', from, to],
    queryFn: () => api.get<{ cards: Card[]; unbilled: { orders: number; items: number; amountPaise: number } }>(`/v1/leakage?from=${from}&to=${to}`),
  });
  const [open, setOpen] = useState<string | null>(null);
  if (!data.data) return <p className="text-muted-foreground">Loading…</p>;
  const { cards, unbilled } = data.data;
  const card = cards.find((c) => c.key === open);

  return (
    <>
      <h2 className="font-display text-2xl font-semibold">Leakage dashboard</h2>
      <p className="mb-4 text-sm text-muted-foreground">Things that can hide lost money. Each is normal now and then; patterns are what matter. Click a card for who, when and why.</p>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3" role="list" aria-label="Leakage">
        {cards.map((c) => (
          <button
            key={c.key}
            role="listitem"
            onClick={() => setOpen(open === c.key ? null : c.key)}
            className={`rounded-xl border p-4 text-left transition-colors ${open === c.key ? 'border-foreground' : 'border-border hover:border-ring'} ${c.count ? 'bg-card' : 'bg-card/50 text-muted-foreground'}`}
            aria-pressed={open === c.key}
            aria-label={`${c.label}: ${c.count}`}
          >
            <span className="flex items-center justify-between text-sm font-semibold">
              {c.label}
              {c.count ? <ShieldAlert className="h-4 w-4 text-danger" /> : null}
            </span>
            <span className="mt-1 block text-3xl font-bold tabular-nums">{c.count}</span>
            <span className="block text-sm tabular-nums">{c.amountPaise ? formatINR(c.amountPaise) : ' '}</span>
            <span className="mt-1 block text-xs text-muted-foreground">{c.hint}</span>
          </button>
        ))}
        <div className="rounded-xl border border-border bg-card p-4" role="listitem" aria-label={`Unbilled food: ${unbilled.items}`}>
          <span className="text-sm font-semibold">Food made, never paid</span>
          <span className="mt-1 block text-3xl font-bold tabular-nums">{unbilled.items}</span>
          <span className="block text-sm tabular-nums">{unbilled.amountPaise ? formatINR(unbilled.amountPaise) : ' '}</span>
          <span className="mt-1 block text-xs text-muted-foreground">Sent to the kitchen on {unbilled.orders} order(s) that ended void.</span>
        </div>
      </div>
      {card ? <AuditList from={from} to={to} card={card.key} title={card.label} /> : null}
    </>
  );
}

/** The audit log (docs/03 `/v1/audit`), newest first, by pages; `card` narrows it to one leakage card. */
export function AuditList({ from, to, card, title }: { from: string; to: string; card?: string; title?: string }) {
  const { api } = useApp();
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const pages = useInfiniteQuery({
    queryKey: ['audit', from, to, card ?? '', flaggedOnly],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.get<{ entries: Entry[]; next: number | null }>(
        `/v1/audit?from=${from}&to=${to}&limit=100${card ? `&card=${card}` : ''}${flaggedOnly ? '&leakage=1' : ''}${pageParam ? `&before=${pageParam}` : ''}`,
      ),
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const entries = pages.data?.pages.flatMap((p) => p.entries) ?? [];

  return (
    <section aria-label={title ?? 'Audit log'}>
      <div className="mb-2 flex items-center gap-3">
        <h3 className="font-semibold">{title ?? 'Everything that happened'}</h3>
        {!card ? (
          <label className="ml-auto flex items-center gap-2 text-sm">
            <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} /> Flagged only
          </label>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm" data-testid="audit-table">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">What</th>
              <th className="px-3 py-2">Detail</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2">Why</th>
              <th className="px-3 py-2">By</th>
              <th className="px-3 py-2">Approved by</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.seq} className="border-b border-border last:border-0">
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{e.at}</td>
                <td className="px-3 py-1.5">
                  {e.leakage ? <span className="mr-1 inline-block h-2 w-2 rounded-full bg-danger" title="Flagged" /> : null}
                  {e.label}
                </td>
                <td className="px-3 py-1.5">{e.ref}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{e.amountPaise ? formatINR(e.amountPaise) : ''}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{e.reason ?? ''}</td>
                <td className="px-3 py-1.5">
                  {e.by ?? ''}
                  {e.device ? <span className="block text-xs text-muted-foreground">{e.device}</span> : null}
                </td>
                <td className="px-3 py-1.5">{e.approvedBy ?? ''}</td>
              </tr>
            ))}
            {pages.data && entries.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted-foreground">
                  Nothing in these dates.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {pages.hasNextPage ? (
        <button className="btn mt-3" onClick={() => void pages.fetchNextPage()} disabled={pages.isFetchingNextPage}>
          Show older
        </button>
      ) : null}
    </section>
  );
}
