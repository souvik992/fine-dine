import { ApiError } from '@dinepos/client';
import { formatINR, type FloorSnapshot, type FloorTable, type OrderSnapshot } from '@dinepos/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Minus, Plus, Users, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../app-context.js';
import { elapsedText, STATE_CLASS, STATE_LABEL, stateCounts, tablesOf } from '../tables-model.js';

/** My tables (docs/09 Captain): area tabs, live table states; a free table is seated from here. */
export function TablesScreen() {
  const { api, session, signOut, stream, can } = useApp();
  const floor = useQuery({ queryKey: ['floor'], queryFn: () => api.get<FloorSnapshot>('/v1/floor'), refetchInterval: 60_000 });
  const [areaId, setAreaId] = useState<string | null>(null);
  const [picked, setPicked] = useState<FloorTable | null>(null);
  const data = floor.data;
  const area = areaId ?? data?.areas[0]?.id ?? null;
  const tables = data ? tablesOf(data, area) : [];

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-card px-4 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-xl font-semibold">Tables</h1>
          <span className="ml-auto text-right text-sm leading-tight">
            {session?.user.name}
            <span className="block text-xs text-muted-foreground">{session?.user.roleName}</span>
          </span>
          <button className="btn h-10 w-10 px-0" onClick={signOut} aria-label="Lock">
            <Lock className="h-5 w-5" />
          </button>
        </div>
        <nav role="tablist" aria-label="Areas" className="-mx-1 mt-2 flex gap-1 overflow-x-auto px-1">
          {data?.areas.map((a) => (
            <button key={a.id} role="tab" className="tab" aria-selected={a.id === area} onClick={() => setAreaId(a.id)}>
              {a.name}
            </button>
          ))}
        </nav>
      </header>
      {stream !== 'live' ? (
        <p role="status" className="flex items-center gap-2 bg-warn/30 px-4 py-2 text-sm font-semibold">
          <WifiOff className="h-4 w-4" /> {stream === 'offline' ? 'Offline: reconnecting to the outlet server…' : 'Connecting…'}
        </p>
      ) : null}

      <main className="flex-1 px-3 py-3">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {stateCounts(tables).map(([s, n]) => (
            <span key={s} className="rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-semibold">
              {STATE_LABEL[s]}: {n}
            </span>
          ))}
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Tables">
          {tables.map((t) => (
            <li key={t.id}>
              <button className={`tile w-full ${STATE_CLASS[t.state]}`} data-table={t.label} data-state={t.state} disabled={t.state === 'BLOCKED'} onClick={() => setPicked(t)}>
                <span className="flex items-start justify-between">
                  <span className="font-display text-2xl font-bold">{t.label}</span>
                  {t.covers ? (
                    <span className="flex items-center gap-1 text-sm">
                      <Users className="h-4 w-4" /> {t.covers}
                    </span>
                  ) : t.seats ? (
                    <span className="text-xs opacity-70">{t.seats} seats</span>
                  ) : null}
                </span>
                <span className="text-sm font-semibold">{STATE_LABEL[t.state]}</span>
                {t.orderId ? (
                  <span className="flex justify-between text-xs">
                    <span>{elapsedText(t.elapsedMin)}</span>
                    <span className="tabular-nums">{t.amountPaise ? formatINR(t.amountPaise) : ''}</span>
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
        {data && tables.length === 0 ? <p className="mt-10 text-center text-muted-foreground">No tables in this area.</p> : null}
      </main>

      {picked ? (
        picked.orderId ? (
          <OrderSheet table={picked} onClose={() => setPicked(null)} />
        ) : can('order.create') ? (
          <SeatSheet table={picked} onClose={() => setPicked(null)} />
        ) : (
          <Sheet title={`Table ${picked.label}`} onClose={() => setPicked(null)}>
            <p>Your role cannot seat tables.</p>
          </Sheet>
        )
      ) : null}
    </div>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <section role="dialog" aria-label={title} className="max-h-[85%] overflow-y-auto rounded-t-2xl bg-card p-5 pb-8" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-border" />
        <h2 className="mb-4 font-display text-2xl font-semibold">{title}</h2>
        {children}
      </section>
    </div>
  );
}

function SeatSheet({ table, onClose }: { table: FloorTable; onClose: () => void }) {
  const { api } = useApp();
  const qc = useQueryClient();
  const [covers, setCovers] = useState(Math.min(table.seats ?? 2, 2));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seat = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.command('OpenTable', { tableId: table.id, covers });
      await qc.invalidateQueries({ queryKey: ['floor'] });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not seat the table.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={`Seat ${table.label}`} onClose={onClose}>
      <p className="mb-2 font-semibold">Guests</p>
      <div className="mb-5 flex items-center justify-center gap-6">
        <button className="btn h-16 w-16 px-0" onClick={() => setCovers(Math.max(1, covers - 1))} aria-label="One guest fewer" disabled={covers <= 1}>
          <Minus className="h-6 w-6" />
        </button>
        <span className="w-16 text-center text-5xl font-bold tabular-nums" data-testid="covers">
          {covers}
        </span>
        <button className="btn h-16 w-16 px-0" onClick={() => setCovers(Math.min(99, covers + 1))} aria-label="One more guest">
          <Plus className="h-6 w-6" />
        </button>
      </div>
      {error ? (
        <p role="alert" className="mb-3 font-semibold text-danger">
          {error}
        </p>
      ) : null}
      <button className="btn btn-primary w-full" onClick={() => void seat()} disabled={busy}>
        Seat {covers} guest{covers === 1 ? '' : 's'}
      </button>
    </Sheet>
  );
}

/** The table's order as it stands (read-only until order taking arrives on the phone, P3-02). */
function OrderSheet({ table, onClose }: { table: FloorTable; onClose: () => void }) {
  const { api } = useApp();
  const order = useQuery({ queryKey: ['order', table.orderId], queryFn: () => api.get<OrderSnapshot>(`/v1/orders/${table.orderId}`) });
  const lines = order.data?.items.filter((i) => i.status !== 'cancelled') ?? [];
  return (
    <Sheet title={`Table ${table.label}`} onClose={onClose}>
      <p className="mb-3 text-sm text-muted-foreground">
        {STATE_LABEL[table.state]} · {table.covers ?? 0} guests · {elapsedText(table.elapsedMin)}
      </p>
      {order.data ? (
        <>
          <ul className="divide-y divide-border" aria-label="Order">
            {lines.map((i) => (
              <li key={i.id} className="flex justify-between gap-3 py-2">
                <span>
                  <span className="font-semibold tabular-nums">{i.qty} ×</span> {i.name}
                  <span className="block text-xs text-muted-foreground">{i.status === 'held' ? 'not sent yet' : `KOT ${String(i.kotNo ?? 0).padStart(4, '0')}`}</span>
                </span>
              </li>
            ))}
            {lines.length === 0 ? <li className="py-3 text-muted-foreground">Nothing ordered yet.</li> : null}
          </ul>
          <p className="mt-3 flex justify-between text-lg font-bold">
            <span>Total</span>
            <span className="tabular-nums">{formatINR(order.data.totals.totalPaise)}</span>
          </p>
        </>
      ) : (
        <p className="text-muted-foreground">Loading…</p>
      )}
      <p className="mt-4 rounded-lg bg-secondary p-3 text-sm">Taking orders on the phone comes in the next update. Until then, add items at a billing terminal.</p>
    </Sheet>
  );
}
